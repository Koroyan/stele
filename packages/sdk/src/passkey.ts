/**
 * Walletless signing with a passkey-protected Stele key (browser only) — stele/1, kept for existing
 * signers. New signers use native passkeys (`NativePasskeySigner`, stele/2), whose private key
 * never leaves the authenticator.
 *
 * The Ed25519 signing key is generated here, in the user's browser, and leaves it only encrypted
 * under the passkey's WebAuthn PRF output (AES-256-GCM, key from HKDF-SHA256). To sign, one passkey
 * ceremony with user verification both approves the exact message and releases the PRF output that
 * unlocks the key for that single signature; the key is wiped from memory right after.
 *
 * Never persisted: the seed, the PRF output or anything derived from them — not in localStorage,
 * sessionStorage, cookies, IndexedDB, logs or API requests. The only thing stored locally is a
 * non-secret hint (public key + credential ID) so a returning visitor is recognized.
 *
 * Without the WebAuthn PRF extension there is NO fallback to a server-held or password-derived key:
 * registration fails with {@link PasskeyUnsupportedError} and the visitor can use a wallet instead.
 */
import {
  buildKeyStatement,
  decodeRecoveryKit,
  encodeRecoveryKit,
  fromBase58 as base58ToBytes,
  fromBase64Url,
  fromHex,
  generateSigningSeed,
  newRecoverySecret,
  passkeySignatureChallenge,
  passkeyStatementChallenge,
  publicKeyFromSeed,
  recoveryKitId,
  signWithSeed,
  toBase58,
  toBase64Url,
  unwrapSigningSeed,
  utf8,
  wrapSigningSeed,
  type PasskeyAssertion,
  type WrappedKey,
} from "@stelehq/protocol";
import type { SteleClient } from "./client";

export class PasskeyUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PasskeyUnsupportedError";
  }
}

const ALGORITHMS = [-8, -7, -257];

/** Whether this browser can do passkey-protected signing (WebAuthn + PRF). `null` = unknown. */
export async function passkeySigningSupport(): Promise<{
  supported: boolean | null;
  reason?: string;
}> {
  if (typeof window === "undefined" || !window.isSecureContext)
    return { supported: false, reason: "Passkeys need a secure (https) page." };
  if (typeof PublicKeyCredential === "undefined" || !navigator.credentials)
    return { supported: false, reason: "This browser does not support passkeys." };
  const caps = (
    PublicKeyCredential as unknown as {
      getClientCapabilities?: () => Promise<Record<string, boolean>>;
    }
  ).getClientCapabilities;
  if (caps) {
    try {
      const c = await caps.call(PublicKeyCredential);
      if (c["extension:prf"] === false)
        return {
          supported: false,
          reason:
            "This browser's passkeys cannot protect a signing key (no PRF support). Use a wallet instead.",
        };
      if (c["extension:prf"] === true) return { supported: true };
    } catch {
      // unknown
    }
  }
  return { supported: null };
}

/** Thrown when the user dismissed the passkey prompt. */
export function isPasskeyCancel(e: unknown): boolean {
  return e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "AbortError");
}

const toBuffer = (b: Uint8Array): ArrayBuffer => b.slice().buffer as ArrayBuffer;

interface PrfResults {
  prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } };
}

function prfOutput(credential: PublicKeyCredential): Uint8Array {
  const ext = credential.getClientExtensionResults() as PrfResults;
  const first = ext.prf?.results?.first;
  if (!first)
    throw new PasskeyUnsupportedError(
      "This passkey cannot protect a signing key (the WebAuthn PRF extension is unavailable). Use a wallet, or a passkey provider with PRF support.",
    );
  return new Uint8Array(first);
}

function assertionOf(credential: PublicKeyCredential): PasskeyAssertion {
  const r = credential.response as AuthenticatorAssertionResponse;
  return {
    credentialId: toBase64Url(new Uint8Array(credential.rawId)),
    authenticatorData: toBase64Url(new Uint8Array(r.authenticatorData)),
    clientDataJSON: toBase64Url(new Uint8Array(r.clientDataJSON)),
    signature: toBase64Url(new Uint8Array(r.signature)),
  };
}

async function getAssertion(o: {
  challenge: Uint8Array;
  rpId: string;
  credentialIds: string[];
  prfSalt?: Uint8Array;
}): Promise<PublicKeyCredential> {
  const credential = (await navigator.credentials.get({
    publicKey: {
      challenge: toBuffer(o.challenge),
      rpId: o.rpId,
      allowCredentials: o.credentialIds.map((id) => ({
        type: "public-key" as const,
        id: toBuffer(fromBase64Url(id)),
      })),
      userVerification: "required",
      timeout: 120_000,
      ...(o.prfSalt
        ? {
            extensions: {
              prf: { eval: { first: toBuffer(o.prfSalt) } },
            } as AuthenticationExtensionsClientInputs,
          }
        : {}),
    },
  })) as PublicKeyCredential | null;
  if (!credential) throw new DOMException("No passkey was used", "NotAllowedError");
  return credential;
}

// ---- local hint (non-secret) --------------------------------------------------------------------------

interface Hint {
  publicKey: string;
  credentialId: string;
}

const hintKey = (client: SteleClient, organization: string) =>
  `stele:passkey-signer:${client.apiBaseUrl}:${organization}:${location.hostname}`;

function readHint(client: SteleClient, organization: string): Hint | null {
  try {
    const raw = localStorage.getItem(hintKey(client, organization));
    const h = raw ? (JSON.parse(raw) as Hint) : null;
    return h && typeof h.publicKey === "string" && typeof h.credentialId === "string" ? h : null;
  } catch {
    return null;
  }
}

function writeHint(client: SteleClient, organization: string, hint: Hint | null): void {
  try {
    if (hint) localStorage.setItem(hintKey(client, organization), JSON.stringify(hint));
    else localStorage.removeItem(hintKey(client, organization));
  } catch {
    // storage unavailable: the visitor identifies with the passkey instead
  }
}

// ---- the signer ---------------------------------------------------------------------------------------

export interface PasskeyRegistration {
  signer: PasskeySigner;
  /** Printable recovery kit (shown once; Stele never receives the secret). */
  recoveryKit: string | null;
}

/** A passkey-protected Stele key. `signWithAssertion` performs one passkey ceremony per message. */
export class PasskeySigner {
  readonly signerType = "passkey" as const;
  readonly walletName = "Passkey";

  private constructor(
    private readonly client: SteleClient,
    readonly organization: string,
    readonly address: string,
    /** The passkey to use first (others of the same signer are accepted too). */
    readonly credentialId: string,
  ) {}

  /** The signer remembered on this device for this site, if any. */
  static remembered(client: SteleClient, organization: string): PasskeySigner | null {
    const hint = readHint(client, organization);
    return hint ? new PasskeySigner(client, organization, hint.publicKey, hint.credentialId) : null;
  }

  forget(): void {
    writeHint(this.client, this.organization, null);
  }

  /** A signer named by a discoverable passkey (see `identifyPasskeySigner`); remembered locally. */
  static fromIdentity(
    client: SteleClient,
    organization: string,
    publicKey: string,
    credentialId: string,
  ): PasskeySigner {
    writeHint(client, organization, { publicKey, credentialId });
    return new PasskeySigner(client, organization, publicKey, credentialId);
  }

  /**
   * Creates a passkey and a new signing key protected by it (two passkey prompts: create, then
   * approve the key statement). Optionally creates a recovery kit for the same key.
   */
  static async register(opts: {
    client: SteleClient;
    organization: string;
    sessionToken?: string;
    recoveryKit?: boolean;
    label?: string;
  }): Promise<PasskeyRegistration> {
    const { client, organization } = opts;
    const o = await client.passkeyOptions({
      organization,
      purpose: "register",
      sessionToken: opts.sessionToken,
    });
    const prfSalt = crypto.getRandomValues(new Uint8Array(32));
    const created = (await navigator.credentials.create({
      publicKey: {
        challenge: toBuffer(fromBase64Url(o.challenge)),
        rp: { id: o.rpId, name: o.rpName },
        user: {
          id: toBuffer(fromBase64Url(o.user.id)),
          name: o.user.name,
          displayName: o.user.displayName,
        },
        pubKeyCredParams: ALGORITHMS.map((alg) => ({ type: "public-key" as const, alg })),
        authenticatorSelection: {
          residentKey: "required",
          requireResidentKey: true,
          userVerification: "required",
        },
        attestation: "none",
        timeout: 120_000,
        extensions: {
          prf: { eval: { first: toBuffer(prfSalt) } },
        } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null;
    if (!created) throw new DOMException("No passkey was created", "NotAllowedError");
    const ext = created.getClientExtensionResults() as PrfResults;
    if (ext.prf?.enabled === false)
      throw new PasskeyUnsupportedError(
        "This passkey provider cannot protect a signing key (no WebAuthn PRF). Nothing was registered; use a wallet instead.",
      );
    const att = created.response as AuthenticatorAttestationResponse;
    const spki = att.getPublicKey();
    if (!spki)
      throw new PasskeyUnsupportedError("This browser does not expose the passkey's public key.");
    const credential = {
      credentialId: toBase64Url(new Uint8Array(created.rawId)),
      publicKey: toBase64Url(new Uint8Array(spki)),
      algorithm: att.getPublicKeyAlgorithm(),
      clientDataJSON: toBase64Url(new Uint8Array(att.clientDataJSON)),
      authenticatorData: toBase64Url(new Uint8Array(att.getAuthenticatorData())),
    };

    const seed = generateSigningSeed();
    try {
      const publicKeyBytes = publicKeyFromSeed(seed);
      const publicKey = toBase58(publicKeyBytes);
      const issuedAt = Math.floor(Date.now() / 1000);
      const keyStatement = buildKeyStatement({
        action: "REGISTER",
        organization,
        key: publicKey,
        passkey: {
          credentialId: credential.credentialId,
          publicKey: credential.publicKey,
          rpId: o.rpId,
        },
        chainId: o.chainId,
        issuedAt,
      });
      // Second prompt: the passkey approves the key statement and releases its PRF output.
      const endorsement = await getAssertion({
        challenge: passkeyStatementChallenge(keyStatement),
        rpId: o.rpId,
        credentialIds: [credential.credentialId],
        prfSalt,
      });
      const prf = prfOutput(endorsement);
      const wrappedKey = await wrapSigningSeed(prf, seed, {
        purpose: "passkey",
        publicKey: publicKeyBytes,
        bindingId: fromBase64Url(credential.credentialId),
      });
      prf.fill(0);
      let recoveryKit: string | null = null;
      let kitBody;
      if (opts.recoveryKit) {
        const secret = newRecoverySecret();
        const kitId = recoveryKitId(secret);
        const kitStatement = buildKeyStatement({
          action: "ADD_RECOVERY_KIT",
          organization,
          key: publicKey,
          recoveryKitId: kitId,
          chainId: o.chainId,
          issuedAt,
        });
        kitBody = {
          kitId,
          wrappedKey: await wrapSigningSeed(secret, seed, {
            purpose: "recovery",
            publicKey: publicKeyBytes,
            bindingId: fromHex(kitId, 16),
          }),
          keyStatement: kitStatement,
          keySignature: toBase64Url(signWithSeed(utf8(kitStatement), seed)),
        };
        recoveryKit = encodeRecoveryKit(secret);
        secret.fill(0);
      }
      await client.registerPasskey({
        challengeId: o.challengeId,
        credential,
        identity: publicKey,
        keyStatement,
        keySignature: toBase64Url(signWithSeed(utf8(keyStatement), seed)),
        statementAssertion: assertionOf(endorsement),
        prfSalt: toBase64Url(prfSalt),
        wrappedKey,
        label: opts.label,
        recoveryKit: kitBody,
      });
      writeHint(client, organization, { publicKey, credentialId: credential.credentialId });
      return {
        signer: new PasskeySigner(client, organization, publicKey, credential.credentialId),
        recoveryKit,
      };
    } finally {
      seed.fill(0);
    }
  }

  /** A returning signer on a device without the local hint (synced passkey). One prompt. */
  static async identify(opts: {
    client: SteleClient;
    organization: string;
  }): Promise<PasskeySigner> {
    const o = await opts.client.passkeyOptions({
      organization: opts.organization,
      purpose: "identify",
    });
    const credential = await getAssertion({
      challenge: fromBase64Url(o.challenge),
      rpId: o.rpId,
      credentialIds: [],
    });
    const material = await opts.client.identifyPasskey({
      challengeId: o.challengeId,
      assertion: assertionOf(credential),
    });
    writeHint(opts.client, opts.organization, {
      publicKey: material.identity,
      credentialId: material.credentialId,
    });
    return new PasskeySigner(
      opts.client,
      opts.organization,
      material.identity,
      material.credentialId,
    );
  }

  /**
   * Signs `message`: one passkey prompt approves exactly this message (user verification required)
   * and unlocks the key for this signature only. Returns the signature and the passkey's assertion,
   * which Stele requires before recording and which receipts carry as evidence.
   */
  async signWithAssertion(
    message: Uint8Array,
  ): Promise<{ signature: Uint8Array; passkeyAssertion: PasskeyAssertion }> {
    const material = await this.client.passkeyKeyMaterial({
      organization: this.organization,
      credentialId: this.credentialId,
    });
    if (material.identity !== this.address)
      throw new Error("The passkey belongs to another signer");
    const salts = new Map(material.credentials.map((c) => [c.credentialId, c.prfSalt]));
    const credential = await getAssertion({
      challenge: passkeySignatureChallenge(message),
      rpId: material.rpId,
      credentialIds: [material.credentialId],
      prfSalt: fromBase64Url(salts.get(material.credentialId) ?? material.prfSalt),
    });
    const prf = prfOutput(credential);
    const publicKey = publicKeyFromSeedless(this.address);
    const seed = await unwrapSigningSeed(prf, material.wrappedKey, {
      purpose: "passkey",
      publicKey,
      bindingId: fromBase64Url(material.credentialId),
    });
    prf.fill(0);
    try {
      return { signature: signWithSeed(message, seed), passkeyAssertion: assertionOf(credential) };
    } finally {
      seed.fill(0);
    }
  }

  /** Wallet-compatible signing (prefer `signWithAssertion`; Stele requires the assertion). */
  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    return (await this.signWithAssertion(message)).signature;
  }

  /**
   * Restores signing on a new device with a recovery kit: the kit unlocks the same key, which then
   * authorizes a new passkey on this device. Stele never receives the kit secret.
   */
  static async recover(opts: {
    client: SteleClient;
    organization: string;
    recoveryKit: string;
    label?: string;
  }): Promise<PasskeySigner> {
    const { client, organization } = opts;
    const secret = decodeRecoveryKit(opts.recoveryKit);
    try {
      const kit = await client.lookupRecoveryKit({ organization, kitId: recoveryKitId(secret) });
      const seed = await unwrapSigningSeed(secret, kit.wrappedKey, {
        purpose: "recovery",
        publicKey: publicKeyFromSeedless(kit.identity),
        bindingId: fromHex(recoveryKitId(secret), 16),
      });
      try {
        return await PasskeySigner.addPasskeyWithSeed({
          client,
          organization,
          identity: kit.identity,
          seed,
          label: opts.label,
        });
      } finally {
        seed.fill(0);
      }
    } finally {
      secret.fill(0);
    }
  }

  /** Adds another passkey (e.g. a security key) to this signer; the current passkey unlocks the key. */
  async addPasskey(label?: string): Promise<PasskeySigner> {
    // Unlock once with the current passkey (user verification), then authorize the new passkey.
    // The challenge is random: this assertion unlocks the key locally and is never sent anywhere.
    const material = await this.client.passkeyKeyMaterial({
      organization: this.organization,
      credentialId: this.credentialId,
    });
    const credential = await getAssertion({
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rpId: material.rpId,
      credentialIds: [material.credentialId],
      prfSalt: fromBase64Url(material.prfSalt),
    });
    const prf = prfOutput(credential);
    const seed = await unwrapSigningSeed(prf, material.wrappedKey, {
      purpose: "passkey",
      publicKey: publicKeyFromSeedless(this.address),
      bindingId: fromBase64Url(material.credentialId),
    });
    prf.fill(0);
    try {
      return await PasskeySigner.addPasskeyWithSeed({
        client: this.client,
        organization: this.organization,
        identity: this.address,
        seed,
        label,
      });
    } finally {
      seed.fill(0);
    }
  }

  private static async addPasskeyWithSeed(opts: {
    client: SteleClient;
    organization: string;
    identity: string;
    seed: Uint8Array;
    label?: string;
  }): Promise<PasskeySigner> {
    const { client, organization, identity, seed } = opts;
    const o = await client.passkeyOptions({ organization, purpose: "add_passkey", identity });
    const prfSalt = crypto.getRandomValues(new Uint8Array(32));
    const created = (await navigator.credentials.create({
      publicKey: {
        challenge: toBuffer(fromBase64Url(o.challenge)),
        rp: { id: o.rpId, name: o.rpName },
        user: {
          id: toBuffer(fromBase64Url(o.user.id)),
          name: o.user.name,
          displayName: o.user.displayName,
        },
        pubKeyCredParams: ALGORITHMS.map((alg) => ({ type: "public-key" as const, alg })),
        authenticatorSelection: {
          residentKey: "required",
          requireResidentKey: true,
          userVerification: "required",
        },
        excludeCredentials: o.excludeCredentials.map((id) => ({
          type: "public-key" as const,
          id: toBuffer(fromBase64Url(id)),
        })),
        attestation: "none",
        timeout: 120_000,
        extensions: {
          prf: { eval: { first: toBuffer(prfSalt) } },
        } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null;
    if (!created) throw new DOMException("No passkey was created", "NotAllowedError");
    const att = created.response as AuthenticatorAttestationResponse;
    const spki = att.getPublicKey();
    if (!spki)
      throw new PasskeyUnsupportedError("This browser does not expose the passkey's public key.");
    const credential = {
      credentialId: toBase64Url(new Uint8Array(created.rawId)),
      publicKey: toBase64Url(new Uint8Array(spki)),
      algorithm: att.getPublicKeyAlgorithm(),
      clientDataJSON: toBase64Url(new Uint8Array(att.clientDataJSON)),
      authenticatorData: toBase64Url(new Uint8Array(att.getAuthenticatorData())),
    };
    const keyStatement = buildKeyStatement({
      action: "ADD_PASSKEY",
      organization,
      key: identity,
      passkey: {
        credentialId: credential.credentialId,
        publicKey: credential.publicKey,
        rpId: o.rpId,
      },
      chainId: o.chainId,
      issuedAt: Math.floor(Date.now() / 1000),
    });
    const endorsement = await getAssertion({
      challenge: passkeyStatementChallenge(keyStatement),
      rpId: o.rpId,
      credentialIds: [credential.credentialId],
      prfSalt,
    });
    const prf = prfOutput(endorsement);
    const wrappedKey: WrappedKey = await wrapSigningSeed(prf, seed, {
      purpose: "passkey",
      publicKey: publicKeyFromSeedless(identity),
      bindingId: fromBase64Url(credential.credentialId),
    });
    prf.fill(0);
    await client.registerPasskey({
      challengeId: o.challengeId,
      credential,
      identity,
      keyStatement,
      keySignature: toBase64Url(signWithSeed(utf8(keyStatement), seed)),
      statementAssertion: assertionOf(endorsement),
      prfSalt: toBase64Url(prfSalt),
      wrappedKey,
      label: opts.label,
    });
    writeHint(client, organization, { publicKey: identity, credentialId: credential.credentialId });
    return new PasskeySigner(client, organization, identity, credential.credentialId);
  }
}

/** Decodes a base58 public key (no seed involved). */
function publicKeyFromSeedless(address: string): Uint8Array {
  const bytes = base58ToBytes(address);
  if (bytes.length !== 32) throw new Error("invalid signer address");
  return bytes;
}
