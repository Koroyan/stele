/**
 * Native passkey signing (stele/2, browser only): the passkey's own ES256 (P-256) key signs. The
 * private key never leaves the authenticator — there is no key to generate, wrap, unlock, store or
 * wipe in JavaScript, and no PRF extension is needed. Solana's secp256r1 precompile verifies every
 * signature on-chain.
 *
 * Each acceptance is one passkey prompt with user verification. Before prompting, the SDK rebuilds
 * the exact message from chain data and computes the WebAuthn challenge from it itself; it never
 * signs a challenge just because the server sent it.
 *
 * What a passkey shows the user is the site and the account, not the agreement text: the text is
 * what this page displayed (hash-checked against the chain). Receipts and verifiers say so.
 *
 * Stored locally: only a non-secret hint (signer key + credential ID) so a returning visitor is
 * recognized on this device.
 */
import {
  PASSKEY_ACCEPTANCE_TAG,
  PASSKEY_ENROLL_TAG,
  PASSKEY_ROTATE_TAG,
  compressP256PublicKey,
  concatBytes,
  fromBase64Url,
  p256KeyFromId,
  p256KeyId,
  p256SignatureFromDer,
  rpIdCovers,
  sha256,
  toBase64Url,
  toHex,
  verifyP256,
  webauthnChallenge,
  type PasskeyAssertion,
} from "@stelehq/protocol";
import type { NativeConfirmResult, SteleClient } from "./client";
import { PasskeySigner } from "./passkey";

/** Whether this browser can sign with a native passkey (WebAuthn in a secure context). */
export function nativePasskeySupport(): { supported: boolean; reason?: string } {
  if (typeof window === "undefined" || !window.isSecureContext)
    return { supported: false, reason: "Passkeys need a secure (https) page." };
  if (typeof PublicKeyCredential === "undefined" || !navigator.credentials)
    return { supported: false, reason: "This browser does not support passkeys." };
  return { supported: true };
}

const toBuffer = (b: Uint8Array): ArrayBuffer => b.slice().buffer as ArrayBuffer;

function assertionOf(credential: PublicKeyCredential): PasskeyAssertion {
  const r = credential.response as AuthenticatorAssertionResponse;
  return {
    credentialId: toBase64Url(new Uint8Array(credential.rawId)),
    authenticatorData: toBase64Url(new Uint8Array(r.authenticatorData)),
    clientDataJSON: toBase64Url(new Uint8Array(r.clientDataJSON)),
    signature: toBase64Url(new Uint8Array(r.signature)),
  };
}

async function assert(o: {
  challenge: Uint8Array;
  rpId: string;
  credentialIds: string[];
}): Promise<PasskeyAssertion> {
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
    },
  })) as PublicKeyCredential | null;
  if (!credential) throw new DOMException("No passkey was used", "NotAllowedError");
  return assertionOf(credential);
}

/** Checks locally that an assertion is a valid signature by `key` (before anything is sent). */
export function nativeAssertionVerifies(assertion: PasskeyAssertion, key: Uint8Array): boolean {
  try {
    const signed = concatBytes(
      fromBase64Url(assertion.authenticatorData),
      sha256(fromBase64Url(assertion.clientDataJSON)),
    );
    return verifyP256(key, p256SignatureFromDer(fromBase64Url(assertion.signature)), signed);
  } catch {
    return false;
  }
}

// ---- local hint (non-secret) --------------------------------------------------------------------------

interface Hint {
  publicKey: string;
  credentialId: string;
}

const hintKey = (client: SteleClient, organization: string) =>
  `stele:native-passkey:${client.apiBaseUrl}:${organization}:${location.hostname}`;

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

async function createCredential(
  client: SteleClient,
  input: Parameters<SteleClient["nativePasskeyOptions"]>[0],
) {
  const o = await client.nativePasskeyOptions(input);
  const created = (await navigator.credentials.create({
    publicKey: {
      challenge: toBuffer(fromBase64Url(o.challenge)),
      rp: { id: o.rpId, name: o.rpName },
      user: {
        id: toBuffer(fromBase64Url(o.user.id)),
        name: o.user.name,
        displayName: o.user.displayName,
      },
      pubKeyCredParams: o.algorithms.map((alg) => ({ type: "public-key" as const, alg })),
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
    },
  })) as PublicKeyCredential | null;
  if (!created) throw new DOMException("No passkey was created", "NotAllowedError");
  const att = created.response as AuthenticatorAttestationResponse;
  const spki = att.getPublicKey();
  if (!spki) throw new Error("This browser does not expose the passkey's public key.");
  if (att.getPublicKeyAlgorithm() !== -7)
    throw new Error("This passkey provider did not create an ES256 (P-256) passkey.");
  const credential = {
    credentialId: toBase64Url(new Uint8Array(created.rawId)),
    publicKey: toBase64Url(new Uint8Array(spki)),
    algorithm: -7,
    clientDataJSON: toBase64Url(new Uint8Array(att.clientDataJSON)),
    authenticatorData: toBase64Url(new Uint8Array(att.getAuthenticatorData())),
  };
  return { options: o, credential, key: compressP256PublicKey(new Uint8Array(spki)) };
}

// ---- the signer ---------------------------------------------------------------------------------------

/** A native passkey signer. `approve` performs one passkey ceremony per message. */
export class NativePasskeySigner {
  readonly signerType = "passkey_p256" as const;
  readonly walletName = "Passkey";

  private constructor(
    private readonly client: SteleClient,
    readonly organization: string,
    /** `p256:<66 hex>` */
    readonly address: string,
    readonly credentialId: string,
  ) {}

  /** The compressed P-256 public key. */
  get publicKey(): Uint8Array {
    return p256KeyFromId(this.address);
  }

  /** The signer remembered on this device for this site, if any. */
  static remembered(client: SteleClient, organization: string): NativePasskeySigner | null {
    const hint = readHint(client, organization);
    try {
      return hint
        ? new NativePasskeySigner(client, organization, hint.publicKey, hint.credentialId)
        : null;
    } catch {
      return null;
    }
  }

  forget(): void {
    writeHint(this.client, this.organization, null);
  }

  /**
   * Creates a passkey and registers it as this visitor's signer: one prompt creates it, a second
   * proves possession by signing the enrollment statement (in account mode the relayer anchors that
   * enrollment on-chain; the visitor pays nothing).
   */
  static async register(opts: {
    client: SteleClient;
    organization: string;
    sessionToken?: string;
    label?: string;
  }): Promise<NativePasskeySigner> {
    const { client, organization } = opts;
    const { options, credential, key } = await createCredential(client, {
      organization,
      purpose: "register",
      sessionToken: opts.sessionToken,
    });
    const registered = await client.registerNativePasskey({
      challengeId: options.challengeId,
      credential,
      label: opts.label,
    });
    if (registered.identity !== p256KeyId(key))
      throw new Error("The server registered a different key than this passkey's");
    await NativePasskeySigner.confirm(client, registered.confirm, key, {
      organization,
      newKey: key,
    });
    writeHint(client, organization, {
      publicKey: registered.identity,
      credentialId: credential.credentialId,
    });
    return new NativePasskeySigner(
      client,
      organization,
      registered.identity,
      credential.credentialId,
    );
  }

  /**
   * Signs a confirmation statement after checking that it names the expected keys and that the
   * challenge is computed from exactly that statement.
   */
  private static async confirm(
    client: SteleClient,
    confirm: Awaited<ReturnType<SteleClient["registerNativePasskey"]>>["confirm"],
    signingKey: Uint8Array,
    expect: { organization: string; newKey: Uint8Array },
  ): Promise<NativeConfirmResult> {
    const lines = confirm.statement.split("\n");
    const named =
      lines.includes(`Organization: ${expect.organization}`) &&
      (confirm.kind === "rotate"
        ? lines.includes(`Previous signer: passkey-p256 ${toHex(signingKey)}`) &&
          lines.includes(`New signer: passkey-p256 ${toHex(expect.newKey)}`)
        : lines.includes(`Signer: passkey-p256 ${toHex(expect.newKey)}`) &&
          lines.includes(`Relying party: ${confirm.rpId}`));
    if (!named) throw new Error("The statement to sign does not name the expected passkey keys");
    const tag = confirm.kind === "rotate" ? PASSKEY_ROTATE_TAG : PASSKEY_ENROLL_TAG;
    const challenge = webauthnChallenge(tag, confirm.statement);
    if (toBase64Url(challenge) !== confirm.challenge)
      throw new Error("The server's challenge does not match the statement it asked to sign");
    if (!rpIdCovers(confirm.rpId, location.hostname))
      throw new Error(`The passkey belongs to ${confirm.rpId}, not this site`);
    const assertion = await assert({
      challenge,
      rpId: confirm.rpId,
      credentialIds: confirm.allowCredentials,
    });
    if (!nativeAssertionVerifies(assertion, signingKey))
      throw new Error("The passkey's signature does not verify for the expected key");
    return client.confirmNativePasskey({ challengeId: confirm.challengeId, assertion });
  }

  /**
   * Hands this account's enrollment to a new passkey created now: the CURRENT passkey (this signer)
   * signs the rotation. Account-bound signers only.
   */
  async rotate(opts: { sessionToken: string; label?: string }): Promise<NativePasskeySigner> {
    const { options, credential, key } = await createCredential(this.client, {
      organization: this.organization,
      purpose: "rotate",
      sessionToken: opts.sessionToken,
      identity: this.address,
    });
    const registered = await this.client.registerNativePasskey({
      challengeId: options.challengeId,
      credential,
      label: opts.label,
    });
    if (registered.identity !== p256KeyId(key))
      throw new Error("The server registered a different key than this passkey's");
    await NativePasskeySigner.confirm(this.client, registered.confirm, this.publicKey, {
      organization: this.organization,
      newKey: key,
    });
    writeHint(this.client, this.organization, {
      publicKey: registered.identity,
      credentialId: credential.credentialId,
    });
    return new NativePasskeySigner(
      this.client,
      this.organization,
      registered.identity,
      credential.credentialId,
    );
  }

  /**
   * Every passkey of an account-bound signer was lost: creates a new passkey that proves possession;
   * the organization's admin wallet must then authorize it on-chain (a visibly different,
   * NOT key-endorsed event). Resolves with what the organization must sign.
   */
  static async requestRecovery(opts: {
    client: SteleClient;
    organization: string;
    sessionToken: string;
    label?: string;
  }): Promise<{ signer: NativePasskeySigner; recovery: NativeConfirmResult["recovery"] }> {
    const { client, organization } = opts;
    const { options, credential, key } = await createCredential(client, {
      organization,
      purpose: "recover",
      sessionToken: opts.sessionToken,
    });
    const registered = await client.registerNativePasskey({
      challengeId: options.challengeId,
      credential,
      label: opts.label,
    });
    if (registered.identity !== p256KeyId(key))
      throw new Error("The server registered a different key than this passkey's");
    const result = await NativePasskeySigner.confirm(client, registered.confirm, key, {
      organization,
      newKey: key,
    });
    writeHint(client, organization, {
      publicKey: registered.identity,
      credentialId: credential.credentialId,
    });
    return {
      signer: new NativePasskeySigner(
        client,
        organization,
        registered.identity,
        credential.credentialId,
      ),
      recovery: result.recovery,
    };
  }

  /**
   * One user-verified passkey prompt over `challenge` (= SHA-256(tag ‖ message), computed by the
   * caller from the message it verified). Returns the assertion after checking it locally.
   */
  async approve(challenge: Uint8Array, rpId: string): Promise<PasskeyAssertion> {
    if (!rpIdCovers(rpId, location.hostname))
      throw new Error(`The passkey belongs to ${rpId}, not this site`);
    const assertion = await assert({ challenge, rpId, credentialIds: [this.credentialId] });
    if (!nativeAssertionVerifies(assertion, this.publicKey))
      throw new Error("The passkey's signature does not verify for this signer");
    return assertion;
  }

  /** The challenge a native acceptance of `message` signs. */
  static acceptanceChallenge(message: string): Uint8Array {
    return webauthnChallenge(PASSKEY_ACCEPTANCE_TAG, message);
  }

  /** Native passkeys cannot produce Ed25519 signatures; Stele uses {@link approve}. */
  async signMessage(): Promise<Uint8Array> {
    throw new Error("Native passkeys approve Stele messages with approve(), not signMessage()");
  }
}

/**
 * A returning visitor on a device without the local hint (e.g. a synced passkey): one discoverable
 * passkey prompt names the signer — native, or a legacy PRF-protected key.
 */
export async function identifyPasskeySigner(opts: {
  client: SteleClient;
  organization: string;
}): Promise<NativePasskeySigner | PasskeySigner> {
  const { client, organization } = opts;
  const o = await client.passkeyOptions({ organization, purpose: "identify" });
  const assertion = await assert({
    challenge: fromBase64Url(o.challenge),
    rpId: o.rpId,
    credentialIds: [],
  });
  const found = await client.identifySigner({ challengeId: o.challengeId, assertion });
  if (found.algorithm !== "p256-native")
    return PasskeySigner.fromIdentity(client, organization, found.identity, found.credentialId);
  writeHint(client, organization, { publicKey: found.identity, credentialId: found.credentialId });
  return NativePasskeySigner.remembered(client, organization)!;
}
