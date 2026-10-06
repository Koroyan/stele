/**
 * Walletless signer endpoints.
 *
 * Browser (public, CORS without credentials; the WebAuthn relying party is the calling site):
 *   POST /v1/passkeys/options            → ceremony options (register | add_passkey | identify)
 *   POST /v1/passkeys/register           → register a passkey-protected key (or add a passkey)
 *   POST /v1/passkeys/identify           → returning signer on a new device (discoverable passkey)
 *   POST /v1/passkeys/key-material       → the encrypted key for a known passkey
 *   POST /v1/passkeys/recovery-kits      → add a recovery kit (statement signed by the key)
 *   POST /v1/passkeys/recovery-kits/lookup → the encrypted key for a recovery kit
 *   POST /v1/passkeys/revoke             → revoke a passkey (statement signed by the key)
 *   GET  /v1/public/signers/:publicKey   → public, self-authenticating key evidence
 *
 * Native passkeys (stele/2 — the passkey's own P-256 key signs; nothing is wrapped or stored):
 *   POST /v1/passkeys/native/options     → create() options (register | rotate | recover)
 *   POST /v1/passkeys/native/register    → register the new passkey (pending) → statement to sign
 *   POST /v1/passkeys/native/confirm     → possession proof; enrollment / rotation on-chain
 *   POST /v1/passkeys/native/identify    → which signer a discoverable passkey belongs to (any kind)
 *
 * Organization (API key or dashboard session):
 *   GET  /v1/signer-identities, POST /v1/signer-identities/:publicKey/revoke
 *   GET  /v1/organizations/:orgId/signer-identities
 *   GET  /v1/organizations/:orgId/passkey-recoveries            → recoveries awaiting the admin wallet
 *   POST /v1/organizations/:orgId/passkey-enrollments/:address/refresh → mirror an on-chain change
 */
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Deps } from "../deps.js";
import { requireApiKey, requireOrgRole, requireRecentAuth } from "../plugins/auth.js";
import { requestDomainFromOrigin } from "../services/acceptance.js";
import {
  confirmNativePasskey,
  identifySigner,
  nativeCreationOptions,
  pendingRecoveries,
  refreshEnrollment,
  registerNativePasskey,
} from "../services/native-passkeys.js";
import {
  addRecoveryKit,
  ceremonyOptions,
  getKeyMaterial,
  identify,
  listIdentities,
  lookupRecoveryKit,
  publicIdentityEvidence,
  registerPasskey,
  revokeIdentity,
  revokePasskey,
} from "../services/signers.js";
import {
  base58Address,
  base64url,
  orgParams,
  p256SignerId,
  passkeyAssertionBody,
  signerKey,
  uuid,
  wrappedKeyBody,
} from "./schemas.js";

const statement = z.string().min(40).max(2048);
const kitId = z.string().regex(/^[0-9a-f]{32}$/);
const externalUserRef = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[\x21-\x7e]+$/, "printable ASCII without spaces");

export function signerRoutes(deps: Deps): FastifyPluginAsyncZod {
  return async (app) => {
    const host = (origin: string | undefined) =>
      requestDomainFromOrigin(origin, deps.config.HOSTED_ACCEPT_DOMAIN);
    const limited = { rateLimit: { max: 20, timeWindow: "1 minute" } };

    app.post(
      "/v1/passkeys/options",
      {
        config: limited,
        schema: {
          body: z.object({
            organization: base58Address,
            purpose: z.enum(["register", "add_passkey", "identify"]),
            sessionToken: z.string().max(128).optional(),
            identity: base58Address.optional(),
          }),
        },
      },
      async (req) => ceremonyOptions(deps, { ...req.body, host: host(req.headers.origin) }),
    );

    app.post(
      "/v1/passkeys/register",
      {
        config: limited,
        schema: {
          body: z.object({
            challengeId: uuid,
            credential: z
              .object({
                credentialId: base64url(1366),
                publicKey: base64url(1024),
                algorithm: z.number().int(),
                clientDataJSON: base64url(4096),
                authenticatorData: base64url(4096),
              })
              .strict(),
            identity: base58Address,
            keyStatement: statement,
            keySignature: base64url(128),
            statementAssertion: passkeyAssertionBody,
            prfSalt: base64url(64),
            wrappedKey: wrappedKeyBody,
            label: z.string().max(60).optional(),
            recoveryKit: z
              .object({
                kitId,
                wrappedKey: wrappedKeyBody,
                keyStatement: statement,
                keySignature: base64url(128),
              })
              .optional(),
            previousKeySignature: base64url(128).optional(),
          }),
        },
      },
      async (req) => registerPasskey(deps, req.body, host(req.headers.origin)),
    );

    app.post(
      "/v1/passkeys/identify",
      {
        config: limited,
        schema: { body: z.object({ challengeId: uuid, assertion: passkeyAssertionBody }) },
      },
      async (req) => identify(deps, { ...req.body, host: host(req.headers.origin) }),
    );

    app.post(
      "/v1/passkeys/key-material",
      {
        config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
        schema: { body: z.object({ organization: base58Address, credentialId: base64url(1366) }) },
      },
      async (req) => getKeyMaterial(deps, { ...req.body, host: host(req.headers.origin) }),
    );

    app.post(
      "/v1/passkeys/recovery-kits",
      {
        config: limited,
        schema: {
          body: z.object({
            organization: base58Address,
            identity: base58Address,
            kitId,
            wrappedKey: wrappedKeyBody,
            keyStatement: statement,
            keySignature: base64url(128),
          }),
        },
      },
      async (req) => addRecoveryKit(deps, req.body),
    );

    app.post(
      "/v1/passkeys/recovery-kits/lookup",
      {
        config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
        schema: { body: z.object({ organization: base58Address, kitId }) },
      },
      async (req) => lookupRecoveryKit(deps, req.body),
    );

    app.post(
      "/v1/passkeys/revoke",
      {
        config: limited,
        schema: {
          body: z.object({
            organization: base58Address,
            identity: base58Address,
            credentialId: base64url(1366),
            keyStatement: statement,
            keySignature: base64url(128),
          }),
        },
      },
      async (req) => revokePasskey(deps, req.body),
    );

    // ---- native passkeys (stele/2) ---------------------------------------------------------------

    const registrationBody = z
      .object({
        credentialId: base64url(1366),
        publicKey: base64url(1024),
        algorithm: z.number().int(),
        clientDataJSON: base64url(4096),
        authenticatorData: base64url(4096),
      })
      .strict();

    app.post(
      "/v1/passkeys/native/options",
      {
        config: limited,
        schema: {
          body: z.object({
            organization: base58Address,
            purpose: z.enum(["register", "rotate", "recover"]),
            sessionToken: z.string().max(128).optional(),
            identity: p256SignerId.optional(),
          }),
        },
      },
      async (req) => nativeCreationOptions(deps, { ...req.body, host: host(req.headers.origin) }),
    );

    app.post(
      "/v1/passkeys/native/register",
      {
        config: limited,
        schema: {
          body: z.object({
            challengeId: uuid,
            credential: registrationBody,
            label: z.string().max(60).optional(),
          }),
        },
      },
      async (req) => registerNativePasskey(deps, req.body, host(req.headers.origin)),
    );

    app.post(
      "/v1/passkeys/native/confirm",
      {
        config: limited,
        schema: { body: z.object({ challengeId: uuid, assertion: passkeyAssertionBody }) },
      },
      async (req) => confirmNativePasskey(deps, req.body, host(req.headers.origin)),
    );

    app.post(
      "/v1/passkeys/native/identify",
      {
        config: limited,
        schema: { body: z.object({ challengeId: uuid, assertion: passkeyAssertionBody }) },
      },
      async (req) => identifySigner(deps, { ...req.body, host: host(req.headers.origin) }),
    );

    app.get(
      "/v1/public/signers/:publicKey",
      { schema: { params: z.object({ publicKey: signerKey }) } },
      async (req) => publicIdentityEvidence(deps, req.params.publicKey),
    );

    // ---- organization side ---------------------------------------------------------------------

    app.get(
      "/v1/signer-identities",
      { schema: { querystring: z.object({ externalUserRef: externalUserRef.optional() }) } },
      async (req) => {
        const key = requireApiKey(req, "signers:read");
        return {
          signers: await listIdentities(deps, key.organizationId, req.query.externalUserRef),
        };
      },
    );

    app.post(
      "/v1/signer-identities/:publicKey/revoke",
      {
        schema: {
          params: z.object({ publicKey: signerKey }),
          body: z.object({ reason: z.string().min(3).max(200) }),
        },
      },
      async (req) => {
        const key = requireApiKey(req, "signers:write");
        return revokeIdentity(deps, {
          organizationId: key.organizationId,
          identity: req.params.publicKey,
          reason: req.body.reason,
          actor: { type: "api_key", id: key.id },
        });
      },
    );

    app.get(
      "/v1/organizations/:orgId/signer-identities",
      {
        schema: {
          params: orgParams,
          querystring: z.object({ externalUserRef: externalUserRef.optional() }),
        },
      },
      async (req) => {
        const access = await requireOrgRole(deps, req, req.params.orgId, "member");
        return {
          signers: await listIdentities(deps, access.organizationId, req.query.externalUserRef),
        };
      },
    );

    app.post(
      "/v1/organizations/:orgId/signer-identities/:publicKey/revoke",
      {
        schema: {
          params: orgParams.extend({ publicKey: signerKey }),
          body: z.object({ reason: z.string().min(3).max(200) }),
        },
      },
      async (req) => {
        const user = requireRecentAuth(req, deps);
        const access = await requireOrgRole(deps, req, req.params.orgId, "admin");
        return revokeIdentity(deps, {
          organizationId: access.organizationId,
          identity: req.params.publicKey,
          reason: req.body.reason,
          actor: { type: "user", id: user.id },
        });
      },
    );

    app.get(
      "/v1/organizations/:orgId/passkey-recoveries",
      { schema: { params: orgParams } },
      async (req) => {
        const access = await requireOrgRole(deps, req, req.params.orgId, "admin");
        return { recoveries: await pendingRecoveries(deps, access.organizationId) };
      },
    );

    app.post(
      "/v1/organizations/:orgId/passkey-enrollments/:address/refresh",
      { schema: { params: orgParams.extend({ address: base58Address }) } },
      async (req) => {
        const access = await requireOrgRole(deps, req, req.params.orgId, "admin");
        return refreshEnrollment(deps, access.organizationId, req.params.address);
      },
    );
  };
}
