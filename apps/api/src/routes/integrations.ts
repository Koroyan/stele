/**
 * API keys, webhooks, audit log and dashboard statistics.
 * Creating credentials requires a recent wallet signature (step-up) and is audit-logged.
 */
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import {
  acceptanceChallenges,
  acceptances,
  and,
  apiKeys,
  auditLog,
  count,
  desc,
  documents,
  documentVersions,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  sql,
  webhookDeliveries,
  webhookEndpoints,
} from "@stele/db";
import type { Deps } from "../deps.js";
import { badRequest, notFound } from "../errors.js";
import { appendAudit, verifyAuditChain } from "../lib/audit.js";
import { encrypt, hashIp, randomToken, sha256Hex } from "../lib/crypto.js";
import { validateOutboundUrl } from "../lib/ssrf.js";
import { WEBHOOK_EVENTS, newWebhookSecret } from "../lib/webhooks.js";
import { API_KEY_SCOPES, requireOrgRole, requireRecentAuth, requireUser } from "../plugins/auth.js";
import { orgParams, uuid } from "./schemas.js";

export function integrationRoutes(deps: Deps): FastifyPluginAsyncZod {
  const urlPolicy = { allowInsecureLoopback: !deps.config.isProduction };
  const env = deps.config.network.cluster === "mainnet" ? "live" : "test";

  return async (app) => {
    // ---- API keys -----------------------------------------------------------------------------

    app.get("/v1/organizations/:orgId/api-keys", { schema: { params: orgParams } }, async (req) => {
      const access = await requireOrgRole(deps, req, req.params.orgId, "admin");
      const keys = await deps.db
        .select({
          id: apiKeys.id,
          name: apiKeys.name,
          prefix: apiKeys.prefix,
          scopes: apiKeys.scopes,
          createdAt: apiKeys.createdAt,
          lastUsedAt: apiKeys.lastUsedAt,
          expiresAt: apiKeys.expiresAt,
          revokedAt: apiKeys.revokedAt,
        })
        .from(apiKeys)
        .where(eq(apiKeys.organizationId, access.organizationId))
        .orderBy(desc(apiKeys.createdAt));
      return { apiKeys: keys };
    });

    app.post(
      "/v1/organizations/:orgId/api-keys",
      {
        schema: {
          params: orgParams,
          body: z.object({
            name: z.string().min(1).max(80),
            scopes: z.array(z.enum(API_KEY_SCOPES)).min(1),
            expiresInDays: z.number().int().min(1).max(730).optional(),
          }),
        },
      },
      async (req) => {
        const user = requireRecentAuth(req, deps);
        const access = await requireOrgRole(deps, req, req.params.orgId, "admin");
        const prefix = `stl_${env}_${randomBytes(4).toString("hex")}`;
        const key = `${prefix}_${randomToken(32)}`;
        const [row] = await deps.db
          .insert(apiKeys)
          .values({
            organizationId: access.organizationId,
            name: req.body.name,
            prefix,
            secretHash: sha256Hex(key),
            scopes: req.body.scopes,
            createdBy: user.id,
            expiresAt: req.body.expiresInDays
              ? new Date(Date.now() + req.body.expiresInDays * 86_400_000)
              : null,
          })
          .returning({
            id: apiKeys.id,
            name: apiKeys.name,
            prefix: apiKeys.prefix,
            scopes: apiKeys.scopes,
            createdAt: apiKeys.createdAt,
            expiresAt: apiKeys.expiresAt,
          });
        await appendAudit(deps.db, {
          organizationId: access.organizationId,
          actorType: "user",
          actorId: user.id,
          action: "api_key.created",
          targetType: "api_key",
          targetId: prefix,
          metadata: { scopes: req.body.scopes },
          ipHash: hashIp(req.ip, deps.config.IP_HASH_SECRET),
        });
        // The full key is shown exactly once; only its hash is stored.
        return { apiKey: row, key };
      },
    );

    app.delete(
      "/v1/organizations/:orgId/api-keys/:keyId",
      { schema: { params: orgParams.extend({ keyId: uuid }) } },
      async (req) => {
        const user = requireUser(req);
        const access = await requireOrgRole(deps, req, req.params.orgId, "admin");
        const [row] = await deps.db
          .update(apiKeys)
          .set({ revokedAt: new Date() })
          .where(
            and(
              eq(apiKeys.id, req.params.keyId),
              eq(apiKeys.organizationId, access.organizationId),
              isNull(apiKeys.revokedAt),
            ),
          )
          .returning({ prefix: apiKeys.prefix });
        if (!row) throw notFound("Active API key");
        await appendAudit(deps.db, {
          organizationId: access.organizationId,
          actorType: "user",
          actorId: user.id,
          action: "api_key.revoked",
          targetType: "api_key",
          targetId: row.prefix,
        });
        return { ok: true };
      },
    );

    // ---- webhooks -------------------------------------------------------------------------------

    app.get("/v1/organizations/:orgId/webhooks", { schema: { params: orgParams } }, async (req) => {
      const access = await requireOrgRole(deps, req, req.params.orgId, "admin");
      const rows = await deps.db
        .select({
          id: webhookEndpoints.id,
          url: webhookEndpoints.url,
          description: webhookEndpoints.description,
          events: webhookEndpoints.events,
          status: webhookEndpoints.status,
          consecutiveFailures: webhookEndpoints.consecutiveFailures,
          createdAt: webhookEndpoints.createdAt,
        })
        .from(webhookEndpoints)
        .where(eq(webhookEndpoints.organizationId, access.organizationId));
      return { webhooks: rows, events: WEBHOOK_EVENTS };
    });

    app.post(
      "/v1/organizations/:orgId/webhooks",
      {
        schema: {
          params: orgParams,
          body: z.object({
            url: z.string().max(2048),
            description: z.string().max(200).optional(),
            events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
          }),
        },
      },
      async (req) => {
        const user = requireRecentAuth(req, deps);
        const access = await requireOrgRole(deps, req, req.params.orgId, "admin");
        try {
          validateOutboundUrl(req.body.url, urlPolicy);
        } catch (e) {
          throw badRequest("invalid_url", e instanceof Error ? e.message : "Invalid URL");
        }
        const secret = newWebhookSecret();
        const [row] = await deps.db
          .insert(webhookEndpoints)
          .values({
            organizationId: access.organizationId,
            url: req.body.url,
            description: req.body.description ?? null,
            events: req.body.events,
            secretCiphertext: encrypt(secret, deps.encryptionKey),
            createdBy: user.id,
          })
          .returning({
            id: webhookEndpoints.id,
            url: webhookEndpoints.url,
            events: webhookEndpoints.events,
            status: webhookEndpoints.status,
          });
        await appendAudit(deps.db, {
          organizationId: access.organizationId,
          actorType: "user",
          actorId: user.id,
          action: "webhook.created",
          targetType: "webhook",
          targetId: row!.id,
          metadata: { url: req.body.url, events: req.body.events },
        });
        return { webhook: row, secret };
      },
    );

    app.patch(
      "/v1/organizations/:orgId/webhooks/:webhookId",
      {
        schema: {
          params: orgParams.extend({ webhookId: uuid }),
          body: z.object({
            status: z.enum(["active", "disabled"]).optional(),
            events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).optional(),
          }),
        },
      },
      async (req) => {
        const user = requireUser(req);
        const access = await requireOrgRole(deps, req, req.params.orgId, "admin");
        const [row] = await deps.db
          .update(webhookEndpoints)
          .set({
            ...req.body,
            ...(req.body.status === "active" ? { consecutiveFailures: 0 } : {}),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(webhookEndpoints.id, req.params.webhookId),
              eq(webhookEndpoints.organizationId, access.organizationId),
            ),
          )
          .returning({
            id: webhookEndpoints.id,
            status: webhookEndpoints.status,
            events: webhookEndpoints.events,
          });
        if (!row) throw notFound("Webhook");
        await appendAudit(deps.db, {
          organizationId: access.organizationId,
          actorType: "user",
          actorId: user.id,
          action: "webhook.updated",
          targetType: "webhook",
          targetId: row.id,
          metadata: req.body,
        });
        return { webhook: row };
      },
    );

    app.post(
      "/v1/organizations/:orgId/webhooks/:webhookId/rotate-secret",
      { schema: { params: orgParams.extend({ webhookId: uuid }) } },
      async (req) => {
        const user = requireRecentAuth(req, deps);
        const access = await requireOrgRole(deps, req, req.params.orgId, "admin");
        const secret = newWebhookSecret();
        const [row] = await deps.db
          .update(webhookEndpoints)
          .set({ secretCiphertext: encrypt(secret, deps.encryptionKey), updatedAt: new Date() })
          .where(
            and(
              eq(webhookEndpoints.id, req.params.webhookId),
              eq(webhookEndpoints.organizationId, access.organizationId),
            ),
          )
          .returning({ id: webhookEndpoints.id });
        if (!row) throw notFound("Webhook");
        await appendAudit(deps.db, {
          organizationId: access.organizationId,
          actorType: "user",
          actorId: user.id,
          action: "webhook.secret_rotated",
          targetType: "webhook",
          targetId: row.id,
        });
        return { secret };
      },
    );

    app.delete(
      "/v1/organizations/:orgId/webhooks/:webhookId",
      { schema: { params: orgParams.extend({ webhookId: uuid }) } },
      async (req) => {
        const user = requireUser(req);
        const access = await requireOrgRole(deps, req, req.params.orgId, "admin");
        const [row] = await deps.db
          .delete(webhookEndpoints)
          .where(
            and(
              eq(webhookEndpoints.id, req.params.webhookId),
              eq(webhookEndpoints.organizationId, access.organizationId),
            ),
          )
          .returning({ id: webhookEndpoints.id });
        if (!row) throw notFound("Webhook");
        await appendAudit(deps.db, {
          organizationId: access.organizationId,
          actorType: "user",
          actorId: user.id,
          action: "webhook.deleted",
          targetType: "webhook",
          targetId: row.id,
        });
        return { ok: true };
      },
    );

    app.post(
      "/v1/organizations/:orgId/webhooks/:webhookId/test",
      { schema: { params: orgParams.extend({ webhookId: uuid }) } },
      async (req) => {
        const access = await requireOrgRole(deps, req, req.params.orgId, "admin");
        const [endpoint] = await deps.db
          .select({ id: webhookEndpoints.id })
          .from(webhookEndpoints)
          .where(
            and(
              eq(webhookEndpoints.id, req.params.webhookId),
              eq(webhookEndpoints.organizationId, access.organizationId),
            ),
          );
        if (!endpoint) throw notFound("Webhook");
        const eventId = `evt_test_${randomToken(12)}`;
        await deps.db.insert(webhookDeliveries).values({
          endpointId: endpoint.id,
          eventId,
          eventType: "webhook.test",
          payload: {
            id: eventId,
            type: "webhook.test",
            createdAt: new Date().toISOString(),
            organizationId: access.organizationId,
            data: { message: "Test delivery from Stele. Verify the Stele-Signature header." },
          },
        });
        return { eventId };
      },
    );

    app.get(
      "/v1/organizations/:orgId/webhooks/:webhookId/deliveries",
      { schema: { params: orgParams.extend({ webhookId: uuid }) } },
      async (req) => {
        const access = await requireOrgRole(deps, req, req.params.orgId, "admin");
        const [endpoint] = await deps.db
          .select({ id: webhookEndpoints.id })
          .from(webhookEndpoints)
          .where(
            and(
              eq(webhookEndpoints.id, req.params.webhookId),
              eq(webhookEndpoints.organizationId, access.organizationId),
            ),
          );
        if (!endpoint) throw notFound("Webhook");
        const rows = await deps.db
          .select({
            id: webhookDeliveries.id,
            eventId: webhookDeliveries.eventId,
            eventType: webhookDeliveries.eventType,
            status: webhookDeliveries.status,
            attempts: webhookDeliveries.attempts,
            lastResponseStatus: webhookDeliveries.lastResponseStatus,
            lastError: webhookDeliveries.lastError,
            createdAt: webhookDeliveries.createdAt,
            deliveredAt: webhookDeliveries.deliveredAt,
          })
          .from(webhookDeliveries)
          .where(eq(webhookDeliveries.endpointId, endpoint.id))
          .orderBy(desc(webhookDeliveries.createdAt))
          .limit(50);
        return { deliveries: rows };
      },
    );

    // ---- audit log ------------------------------------------------------------------------------

    app.get(
      "/v1/organizations/:orgId/audit-log",
      {
        schema: {
          params: orgParams,
          querystring: z.object({
            beforeSequence: z.coerce.number().int().positive().optional(),
            limit: z.coerce.number().int().min(1).max(200).default(50),
          }),
        },
      },
      async (req) => {
        const access = await requireOrgRole(deps, req, req.params.orgId, "member");
        const conditions = [eq(auditLog.organizationId, access.organizationId)];
        if (req.query.beforeSequence)
          conditions.push(lt(auditLog.sequence, req.query.beforeSequence));
        const rows = await deps.db
          .select()
          .from(auditLog)
          .where(and(...conditions))
          .orderBy(desc(auditLog.sequence))
          .limit(req.query.limit);
        return { entries: rows.map(({ ipHash: _ip, ...r }) => r) };
      },
    );

    app.get(
      "/v1/organizations/:orgId/audit-log/verify",
      { schema: { params: orgParams } },
      async (req) => {
        const access = await requireOrgRole(deps, req, req.params.orgId, "member");
        return verifyAuditChain(deps.db, access.organizationId);
      },
    );

    // ---- dashboard statistics -----------------------------------------------------------------

    app.get("/v1/organizations/:orgId/stats", { schema: { params: orgParams } }, async (req) => {
      const access = await requireOrgRole(deps, req, req.params.orgId, "member");
      const orgId = access.organizationId;
      const since = new Date(Date.now() - 30 * 86_400_000);
      const [docCount] = await deps.db
        .select({ n: count() })
        .from(documents)
        .where(eq(documents.organizationId, orgId));
      const [versionCount] = await deps.db
        .select({ n: count() })
        .from(documentVersions)
        .where(eq(documentVersions.organizationId, orgId));
      const [acceptTotal] = await deps.db
        .select({ n: count() })
        .from(acceptances)
        .where(eq(acceptances.organizationId, orgId));
      const [accept30] = await deps.db
        .select({ n: count() })
        .from(acceptances)
        .where(and(eq(acceptances.organizationId, orgId), gte(acceptances.blockTime, since)));
      const [issued30] = await deps.db
        .select({ n: count() })
        .from(acceptanceChallenges)
        .where(
          and(
            eq(acceptanceChallenges.organizationId, orgId),
            gte(acceptanceChallenges.createdAt, since),
          ),
        );
      const [confirmed30] = await deps.db
        .select({ n: count() })
        .from(acceptanceChallenges)
        .where(
          and(
            eq(acceptanceChallenges.organizationId, orgId),
            gte(acceptanceChallenges.createdAt, since),
            inArray(acceptanceChallenges.status, ["confirmed", "finalized"]),
          ),
        );
      const recentAcceptances = await deps.db
        .select({
          acceptanceId: acceptances.acceptanceId,
          signer: acceptances.signerAddress,
          blockTime: acceptances.blockTime,
          versionNumber: acceptances.versionNumber,
          documentSlug: documents.slug,
          transactionSignature: acceptances.txSignature,
          commitment: acceptances.commitment,
        })
        .from(acceptances)
        .innerJoin(documents, eq(documents.id, acceptances.documentId))
        .where(eq(acceptances.organizationId, orgId))
        .orderBy(desc(acceptances.blockTime))
        .limit(8);
      const daily = await deps.db
        .select({ day: sqlDay(), n: count() })
        .from(acceptances)
        .where(and(eq(acceptances.organizationId, orgId), gte(acceptances.blockTime, since)))
        .groupBy(sqlDay())
        .orderBy(sqlDay());
      const activity = await deps.db
        .select({
          action: auditLog.action,
          targetId: auditLog.targetId,
          txSignature: auditLog.txSignature,
          createdAt: auditLog.createdAt,
          metadata: auditLog.metadata,
        })
        .from(auditLog)
        .where(eq(auditLog.organizationId, orgId))
        .orderBy(desc(auditLog.sequence))
        .limit(8);
      return {
        documents: docCount?.n ?? 0,
        versions: versionCount?.n ?? 0,
        acceptancesTotal: acceptTotal?.n ?? 0,
        acceptances30d: accept30?.n ?? 0,
        challenges30d: issued30?.n ?? 0,
        completionRate30d: issued30 && issued30.n > 0 ? (confirmed30?.n ?? 0) / issued30.n : null,
        daily,
        recentAcceptances,
        activity,
      };
    });
  };
}

// Calendar days in UTC, whatever the database session's time zone (the dashboard labels them UTC).
const sqlDay = () =>
  sql<string>`to_char(date_trunc('day', ${acceptances.blockTime} AT TIME ZONE 'UTC'), 'YYYY-MM-DD')`;
