/**
 * A software WebAuthn authenticator for tests (`@stelehq/protocol/testing`). It produces real
 * assertions (ES256, EdDSA or RS256 signatures over authenticatorData || SHA-256(clientDataJSON))
 * and a PRF output derived like CTAP2 `hmac-secret`. Never use it outside tests: its keys live in
 * memory and it performs no user verification of its own.
 */
import { buf } from "./internal";
import { ed25519 } from "@noble/curves/ed25519.js";
import { p256 } from "@noble/curves/nist.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 as nobleSha256 } from "@noble/hashes/sha2.js";
import { concatBytes, toBase64Url, utf8 } from "./encoding";
import { sha256 } from "./hash";
import {
  COSE_EDDSA,
  COSE_ES256,
  COSE_RS256,
  type PasskeyAssertion,
  type PasskeyCredential,
  type PasskeyRegistrationResponse,
} from "./webauthn";

const P256_SPKI_PREFIX = Uint8Array.from([
  0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a,
  0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00,
]);
const ED25519_SPKI_PREFIX = Uint8Array.from([
  0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
]);

export interface AssertOptions {
  challenge: Uint8Array;
  origin: string;
  userVerified?: boolean;
  userPresent?: boolean;
  crossOrigin?: boolean;
  type?: string;
  /** Override the RP ID hashed into authenticator data. */
  rpId?: string;
  /** WebAuthn PRF `eval.first` input; when given, the PRF output is returned. */
  prfSalt?: Uint8Array;
}

export class SoftPasskey {
  signCount = 0;
  /** Synced passkeys report a zero counter forever; set to emulate them. */
  zeroCounter = false;

  private constructor(
    readonly rpId: string,
    readonly algorithm: number,
    readonly credentialId: Uint8Array,
    readonly publicKey: Uint8Array,
    private readonly sign: (data: Uint8Array) => Promise<Uint8Array>,
    private readonly prfSecret: Uint8Array,
  ) {}

  static async create(rpId: string, algorithm: number = COSE_ES256): Promise<SoftPasskey> {
    const id = crypto.getRandomValues(new Uint8Array(16));
    const prf = crypto.getRandomValues(new Uint8Array(32));
    if (algorithm === COSE_ES256) {
      const sk = p256.utils.randomSecretKey();
      const spki = concatBytes(P256_SPKI_PREFIX, p256.getPublicKey(sk, false));
      return new SoftPasskey(
        rpId,
        algorithm,
        id,
        spki,
        async (d) => p256.sign(d, sk, { format: "der", prehash: true }),
        prf,
      );
    }
    if (algorithm === COSE_EDDSA) {
      const sk = ed25519.utils.randomSecretKey();
      const spki = concatBytes(ED25519_SPKI_PREFIX, ed25519.getPublicKey(sk));
      return new SoftPasskey(rpId, algorithm, id, spki, async (d) => ed25519.sign(d, sk), prf);
    }
    if (algorithm === COSE_RS256) {
      const pair = (await crypto.subtle.generateKey(
        {
          name: "RSASSA-PKCS1-v1_5",
          modulusLength: 2048,
          publicExponent: new Uint8Array([1, 0, 1]),
          hash: "SHA-256",
        },
        false,
        ["sign", "verify"],
      )) as {
        publicKey: Awaited<ReturnType<typeof crypto.subtle.importKey>>;
        privateKey: Awaited<ReturnType<typeof crypto.subtle.importKey>>;
      };
      const spki = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
      return new SoftPasskey(
        rpId,
        algorithm,
        id,
        spki,
        async (d) =>
          new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, buf(d))),
        prf,
      );
    }
    throw new Error(`unsupported algorithm ${algorithm}`);
  }

  get credential(): PasskeyCredential {
    return {
      credentialId: toBase64Url(this.credentialId),
      publicKey: toBase64Url(this.publicKey),
      algorithm: this.algorithm,
      rpId: this.rpId,
    };
  }

  /** PRF output for `salt`, as the WebAuthn PRF extension would return it. */
  prf(salt: Uint8Array): Uint8Array {
    return hmac(
      nobleSha256,
      this.prfSecret,
      nobleSha256(concatBytes(utf8("WebAuthn PRF\u0000"), salt)),
    );
  }

  /** A `navigator.credentials.create()` response (attestation "none") for this passkey. */
  register(o: {
    challenge: Uint8Array;
    origin: string;
    userVerified?: boolean;
  }): PasskeyRegistrationResponse {
    const flags = 0x01 | (o.userVerified === false ? 0 : 0x04) | 0x08 | 0x10 | 0x40;
    // rpIdHash | flags | signCount | aaguid(16) | credIdLen(2) | credId | (COSE key omitted: Stele
    // reads the SPKI from getPublicKey()).
    const credLen = new Uint8Array(2);
    new DataView(credLen.buffer).setUint16(0, this.credentialId.length, false);
    const authenticatorData = concatBytes(
      sha256(utf8(this.rpId)),
      Uint8Array.of(flags),
      new Uint8Array(4),
      new Uint8Array(16),
      credLen,
      this.credentialId,
    );
    const clientData = utf8(
      JSON.stringify({
        type: "webauthn.create",
        challenge: toBase64Url(o.challenge),
        origin: o.origin,
        crossOrigin: false,
      }),
    );
    return {
      credentialId: toBase64Url(this.credentialId),
      publicKey: toBase64Url(this.publicKey),
      algorithm: this.algorithm,
      clientDataJSON: toBase64Url(clientData),
      authenticatorData: toBase64Url(authenticatorData),
    };
  }

  async assert(o: AssertOptions): Promise<{ assertion: PasskeyAssertion; prf: Uint8Array | null }> {
    if (!this.zeroCounter) this.signCount++;
    const flags =
      (o.userPresent === false ? 0 : 0x01) | (o.userVerified === false ? 0 : 0x04) | 0x08 | 0x10;
    const counter = new Uint8Array(4);
    new DataView(counter.buffer).setUint32(0, this.zeroCounter ? 0 : this.signCount, false);
    const authenticatorData = concatBytes(
      sha256(utf8(o.rpId ?? this.rpId)),
      Uint8Array.of(flags),
      counter,
    );
    const clientData = utf8(
      JSON.stringify({
        type: o.type ?? "webauthn.get",
        challenge: toBase64Url(o.challenge),
        origin: o.origin,
        crossOrigin: o.crossOrigin ?? false,
      }),
    );
    const signature = await this.sign(concatBytes(authenticatorData, sha256(clientData)));
    return {
      assertion: {
        credentialId: toBase64Url(this.credentialId),
        authenticatorData: toBase64Url(authenticatorData),
        clientDataJSON: toBase64Url(clientData),
        signature: toBase64Url(signature),
      },
      prf: o.prfSalt ? this.prf(o.prfSalt) : null,
    };
  }
}
