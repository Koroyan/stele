/**
 * Organizations, members, nonce shards and domain verification.
 *
 * Organizations are created ON-CHAIN by the customer's wallet. The API only mirrors what the chain
 * says (`/sync`) and refuses to attach a user to an organization they do not control on-chain.
 */
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { address } from "@solana/kit";
import {
  and,
  asc,
  desc,
  documents,
  domainVerifications,
  eq,
  inArray,
  nonceShards,
  organizationMembers,
  organizations,
  or,
  type OrganizationSettings,
  SIGNING_POLICIES,
} from "@stele/db";
import {
  attestDomainInstruction,
  domainHash,
  findConfigPda,
  findDomainRecordPda,
  revokeDomainInstruction,
  validateRequestDomain,
  validateVerifiedDomain,
  MAX_DOMAIN_ATTESTATION,
} from "@stele/protocol";
import type { Deps } from "../deps.js";
import { badRequest, conflict, forbidden, notFound } from "../errors.js";
import { appendAudit } from "../lib/audit.js";
import { hashIp } from "../lib/crypto.js";
import { checkDomainControl, txtRecordName, txtRecordValue } from "../lib/dns.js";
import { syncOrganization, syncShard } from "../lib/sync.js";
import { sponsorshipOverview } from "../services/sponsorship.js";
import { enqueueWebhook } from "../lib/webhooks.js";
import { requireOrgRole, requireRecentAuth, requireUser } from "../plugins/auth.js";
import { base58Address, orgParams, uuid } from "./schemas.js";

export function organizationRoutes(deps: Deps): FastifyPluginAsyncZod {
  return async (app) => {
    app.get("/v1/organizations", async (req) => {
      const user = requireUser(req);
      const memberOf = await deps.db
        .select({ id: organizationMembers.organizationId })
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.memberAddress, user.walletAddress),
            eq(organizationMembers.active, true),
          ),
        );
      const ids = memberOf.map((m) => m.id);
      const rows = await deps.db
        .select()
        .from(organizations)
        .where(
          ids.length > 0
            ? or(eq(organizations.ownerAddress, user.walletAddress), inArray(organizations.id, ids))
            : eq(organizations.ownerAddress, user.walletAddress),
        )
        // Newest first: a deterministic order, and the dashboard's default is the latest one.
        .orderBy(desc(organizations.createdAt), asc(organizations.address));
      return {
        organizations: rows.map((o) => ({
          id: o.id,
          address: o.address,
          name: o.name,
          verifiedDomain: o.verifiedDomain,
          role: o.ownerAddress === user.walletAddress ? "owner" : "member",
          frozen: o.frozen,
        })),
      };
    });

    /** Mirrors an on-chain organization; the caller must be its owner or an active member. */
    app.post(
      "/v1/organizations/sync",
      { schema: { body: z.object({ address: base58Address }) } },
      async (req) => {
        const user = requireUser(req);
        const synced = await syncOrganization(deps.db, deps.chain, req.body.address);
        if (!synced) throw notFound("On-chain organization");
        const access = await requireOrgRole(deps, req, synced.id, "member").catch(() => null);
        if (!access)
          throw forbidden("Your wallet is not the owner or a member of this organization on-chain");
        await appendAudit(deps.db, {
          organizationId: synced.id,
          actorType: "user",
          actorId: user.id,
          action: "organization.synced",
          targetType: "organization",
          targetId: req.body.address,
          ipHash: hashIp(req.ip, deps.config.IP_HASH_SECRET),
        });
        const [org] = await deps.db
          .select()
          .from(organizations)
          .where(eq(organizations.id, synced.id));
        return { organization: org, role: access.role };
      },
    );

    app.get("/v1/organizations/:orgId", { schema: { params: orgParams } }, async (req) => {
      const access = await requireOrgRole(deps, req, req.params.orgId, "member");
      const [org] = await deps.db
        .select()
        .from(organizations)
        .where(eq(organizations.id, access.organizationId));
      const members = await deps.db
        .select()
        .from(organizationMembers)
        .where(eq(organizationMembers.organizationId, access.organizationId));
      const shards = await deps.db
        .select()
        .from(nonceShards)
        .where(eq(nonceShards.organizationId, access.organizationId));
      const domains = await deps.db
        .select()
        .from(domainVerifications)
        .where(eq(domainVerifications.organizationId, access.organizationId))
        .orderBy(desc(domainVerifications.createdAt));
      const docs = await deps.db
        .select({ id: documents.id })
        .from(documents)
        .where(eq(documents.organizationId, access.organizationId));
      return {
        organization: org,
        role: access.role,
        members,
        shards: shards.map((s) => ({
          ...s,
          relayerIsStele: s.relayerAddress === deps.chain.relayer.address,
        })),
        domainVerifications: domains,
        documentCount: docs.length,
        relayer: deps.chain.relayer.address,
      };
    });

    app.post("/v1/organizations/:orgId/refresh", { schema: { params: orgParams } }, async (req) => {
      const access = await requireOrgRole(deps, req, req.params.orgId, "member");
      await syncOrganization(deps.db, deps.chain, access.organizationAddress);
      return { ok: true };
    });

    app.patch(
      "/v1/organizations/:orgId/settings",
      {
        schema: {
          params: orgParams,
          body: z.object({
            requireAcceptanceSessions: z.boolean().optional(),
            allowedRequestDomains: z.array(z.string().max(48)).max(20).optional(),
            signingPolicy: z.enum(SIGNING_POLICIES).optional(),
            feeSponsor: z.enum(["stele", "organization"]).optional(),
            sponsorFallbackToStele: z.boolean().optional(),
            sponsorLowBalanceLamports: z.number().int().min(0).max(1_000_000_000_000).optional(),
            evidenceMode: z.enum(["DIRECT_ONCHAIN", "MERKLE_BATCHED"]).optional(),
            products: z.object({ gate: z.boolean() }).optional(),
          }),
        },
      },
      async (req) => {
        const user = requireRecentAuth(req, deps);
        const access = await requireOrgRole(deps, req, req.params.orgId, "admin");
        for (const d of req.body.allowedRequestDomains ?? []) {
          try {
            validateRequestDomain(d);
          } catch {
            throw badRequest("invalid_domain", `Invalid domain: ${d}`);
          }
        }
        const [org] = await deps.db
          .select()
          .from(organizations)
          .where(eq(organizations.id, access.organizationId));
        const settings: OrganizationSettings = { ...org!.settings, ...req.body };
        await deps.db
          .update(organizations)
          .set({ settings, updatedAt: new Date() })
          .where(eq(organizations.id, access.organizationId));
        await appendAudit(deps.db, {
          organizationId: access.organizationId,
          actorType: "user",
          actorId: user.id,
          action: "organization.settings_updated",
          metadata: req.body,
          ipHash: hashIp(req.ip, deps.config.IP_HASH_SECRET),
        });
        return { settings };
      },
    );

    /** Fee sponsorship: mode, sponsored shards (deposit addresses, balances, limits), history. */
    app.get(
      "/v1/organizations/:orgId/sponsorship",
      { schema: { params: orgParams } },
      async (req) => {
        const access = await requireOrgRole(deps, req, req.params.orgId, "member");
        const [org] = await deps.db
          .select()
          .from(organizations)
          .where(eq(organizations.id, access.organizationId));
        return sponsorshipOverview(deps, org!);
      },
    );

    app.patch(
      "/v1/organizations/:orgId/members/:memberAddress",
      {
        schema: {
          params: orgParams.extend({ memberAddress: base58Address }),
          body: z.object({ label: z.string().max(80).nullable() }),
        },
      },
      async (req) => {
        const user = requireUser(req);
        const access = await requireOrgRole(deps, req, req.params.orgId, "admin");
        await deps.db
          .update(organizationMembers)
          .set({ label: req.body.label })
          .where(
            and(
              eq(organizationMembers.organizationId, access.organizationId),
              eq(organizationMembers.memberAddress, req.params.memberAddress),
            ),
          );
        await appendAudit(deps.db, {
          organizationId: access.organizationId,
          actorType: "user",
          actorId: user.id,
          action: "member.labelled",
          targetType: "member",
          targetId: req.params.memberAddress,
        });
        return { ok: true };
      },
    );

    /** Mirrors a nonce shard the organization created on-chain. */
    app.post(
      "/v1/organizations/:orgId/shards/sync",
      { schema: { params: orgParams, body: z.object({ address: base58Address }) } },
      async (req) => {
        const user = requireUser(req);
        const access = await requireOrgRole(deps, req, req.params.orgId, "admin");
        await syncShard(deps.db, deps.chain, req.body.address);
        const [shard] = await deps.db
          .select()
          .from(nonceShards)
          .where(eq(nonceShards.address, req.body.address));
        if (!shard || shard.organizationId !== access.organizationId) throw notFound("Nonce shard");
        await appendAudit(deps.db, {
          organizationId: access.organizationId,
          actorType: "user",
          actorId: user.id,
          action: "shard.created",
          targetType: "nonce_shard",
          targetId: req.body.address,
        });
        return { shard };
      },
    );

    // ---- domain verification ------------------------------------------------------------------

    app.post(
      "/v1/organizations/:orgId/domains",
      { schema: { params: orgParams, body: z.object({ domain: z.string().max(48) }) } },
      async (req) => {
        const user = requireUser(req);
        const access = await requireOrgRole(deps, req, req.params.orgId, "admin");
        const domain = req.body.domain.trim().toLowerCase();
        try {
          validateVerifiedDomain(domain);
        } catch (e) {
          throw badRequest("invalid_domain", e instanceof Error ? e.message : "Invalid domain");
        }
        const [row] = await deps.db
          .insert(domainVerifications)
          .values({
            organizationId: access.organizationId,
            domain,
            txtName: txtRecordName(domain),
            txtValue: txtRecordValue(access.organizationAddress),
            requestedBy: user.id,
          })
          .returning();
        await appendAudit(deps.db, {
          organizationId: access.organizationId,
          actorType: "user",
          actorId: user.id,
          action: "domain.verification_requested",
          targetType: "domain",
          targetId: domain,
        });
        return { verification: row };
      },
    );

    app.post(
      "/v1/organizations/:orgId/domains/:verificationId/check",
      {
        config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
        schema: { params: orgParams.extend({ verificationId: uuid }) },
      },
      async (req) => {
        const user = requireUser(req);
        const access = await requireOrgRole(deps, req, req.params.orgId, "admin");
        const [v] = await deps.db
          .select()
          .from(domainVerifications)
          .where(
            and(
              eq(domainVerifications.id, req.params.verificationId),
              eq(domainVerifications.organizationId, access.organizationId),
            ),
          );
        if (!v) throw notFound("Domain verification");
        if (v.status === "verified") return { verification: v };
        const result = await checkDomainControl(
          v.domain,
          access.organizationAddress,
          deps.config.DOH_RESOLVERS,
        );
        if (!result.verified) {
          const [updated] = await deps.db
            .update(domainVerifications)
            .set({
              status: "pending",
              lastCheckedAt: new Date(),
              lastError: result.perResolver
                .map((r) => `${r.resolver}: ${r.found ? "found" : (r.error ?? "record not found")}`)
                .join("; "),
            })
            .where(eq(domainVerifications.id, v.id))
            .returning();
          return { verification: updated, dns: result };
        }
        const [org] = await deps.db
          .select()
          .from(organizations)
          .where(eq(organizations.id, access.organizationId));
        if (org!.verifiedDomain && org!.verifiedDomain !== v.domain) {
          throw conflict(
            "domain_already_verified",
            `This organization already has the verified domain ${org!.verifiedDomain}; revoke it first`,
          );
        }
        const now = await deps.chain.clusterTime();
        const expiresAt = now + Math.min(365 * 86_400, MAX_DOMAIN_ATTESTATION);
        const [config] = await findConfigPda(deps.chain.programAddress);
        const [domainRecord] = await findDomainRecordPda(v.domain, deps.chain.programAddress);
        const tx = await deps.chain.send(deps.chain.attestor, [
          attestDomainInstruction({
            programAddress: deps.chain.programAddress,
            attestor: deps.chain.attestor,
            payer: deps.chain.attestor,
            config,
            organization: address(access.organizationAddress),
            domainRecord,
            domain: v.domain,
            domainHash: domainHash(v.domain),
            expiresAt,
          }),
        ]);
        const [updated] = await deps.db
          .update(domainVerifications)
          .set({
            status: "verified",
            lastCheckedAt: new Date(),
            lastError: null,
            attestationTx: tx,
            verifiedAt: new Date(),
            expiresAt: new Date(expiresAt * 1000),
          })
          .where(eq(domainVerifications.id, v.id))
          .returning();
        await syncOrganization(deps.db, deps.chain, access.organizationAddress);
        await appendAudit(deps.db, {
          organizationId: access.organizationId,
          actorType: "user",
          actorId: user.id,
          action: "domain.verified",
          targetType: "domain",
          targetId: v.domain,
          txSignature: tx,
        });
        await enqueueWebhook(deps.db, access.organizationId, "organization.domain_verified", {
          domain: v.domain,
          attestationTransaction: tx,
          expiresAt,
        });
        return { verification: updated, dns: result };
      },
    );

    app.post(
      "/v1/organizations/:orgId/domains/:verificationId/revoke",
      { schema: { params: orgParams.extend({ verificationId: uuid }) } },
      async (req) => {
        const user = requireRecentAuth(req, deps);
        const access = await requireOrgRole(deps, req, req.params.orgId, "owner");
        const [v] = await deps.db
          .select()
          .from(domainVerifications)
          .where(
            and(
              eq(domainVerifications.id, req.params.verificationId),
              eq(domainVerifications.organizationId, access.organizationId),
            ),
          );
        if (!v || v.status !== "verified") throw notFound("Verified domain");
        const [config] = await findConfigPda(deps.chain.programAddress);
        const [domainRecord] = await findDomainRecordPda(v.domain, deps.chain.programAddress);
        const tx = await deps.chain.send(deps.chain.attestor, [
          revokeDomainInstruction({
            programAddress: deps.chain.programAddress,
            authority: deps.chain.attestor,
            config,
            organization: address(access.organizationAddress),
            domainRecord,
            rentPayer: deps.chain.attestor.address,
          }),
        ]);
        await deps.db
          .update(domainVerifications)
          .set({ status: "revoked" })
          .where(eq(domainVerifications.id, v.id));
        await syncOrganization(deps.db, deps.chain, access.organizationAddress);
        await appendAudit(deps.db, {
          organizationId: access.organizationId,
          actorType: "user",
          actorId: user.id,
          action: "domain.revoked",
          targetType: "domain",
          targetId: v.domain,
          txSignature: tx,
        });
        return { ok: true, transactionSignature: tx };
      },
    );
  };
}
