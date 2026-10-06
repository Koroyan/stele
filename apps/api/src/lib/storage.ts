/**
 * Content-addressed storage for canonical document bytes. Objects are keyed by their SHA-256 and
 * every read is re-hashed: a corrupted or tampered store can cause unavailability, never wrong
 * content. Production uses S3-compatible object storage (AWS S3, Cloudflare R2, MinIO) with an
 * object-lock/retention policy; local development uses the filesystem.
 */
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { resolve } from "node:path";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { contentCid, fromHex, sha256, toHex } from "@stele/protocol";

export interface StoredLocation {
  provider: string;
  uri: string;
}

export interface ContentStore {
  readonly name: string;
  put(bytes: Uint8Array): Promise<{ contentHash: string; cid: string; location: StoredLocation }>;
  /** Returns bytes only if they hash to `contentHash`. */
  get(contentHash: string): Promise<Uint8Array | null>;
}

function assertHash(contentHash: string): void {
  if (!/^[0-9a-f]{64}$/.test(contentHash)) throw new Error("invalid content hash");
}

function verified(contentHash: string, bytes: Uint8Array | null): Uint8Array | null {
  if (!bytes) return null;
  return toHex(sha256(bytes)) === contentHash ? bytes : null;
}

export class FilesystemContentStore implements ContentStore {
  readonly name = "filesystem";
  constructor(private readonly root: string) {}

  private path(contentHash: string): string {
    assertHash(contentHash);
    return resolve(this.root, "sha256", contentHash);
  }

  async put(bytes: Uint8Array) {
    const contentHash = toHex(sha256(bytes));
    const path = this.path(contentHash);
    await mkdir(resolve(this.root, "sha256"), { recursive: true });
    try {
      await access(path);
    } catch {
      await writeFile(path, bytes, { flag: "wx" }).catch((e: NodeJS.ErrnoException) => {
        if (e.code !== "EEXIST") throw e;
      });
    }
    return {
      contentHash,
      cid: contentCid(fromHex(contentHash)),
      location: { provider: this.name, uri: `file://sha256/${contentHash}` },
    };
  }

  async get(contentHash: string) {
    try {
      return verified(contentHash, new Uint8Array(await readFile(this.path(contentHash))));
    } catch {
      return null;
    }
  }
}

export class S3ContentStore implements ContentStore {
  readonly name = "s3";
  private readonly client: S3Client;
  constructor(
    private readonly bucket: string,
    private readonly prefix: string,
    region?: string,
    endpoint?: string,
  ) {
    this.client = new S3Client({
      region: region ?? "auto",
      endpoint,
      forcePathStyle: Boolean(endpoint),
    });
  }

  async put(bytes: Uint8Array) {
    const contentHash = toHex(sha256(bytes));
    const key = `${this.prefix}${contentHash}`;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: bytes,
        ContentType: "application/json",
        CacheControl: "public, max-age=31536000, immutable",
        // Server-side integrity check of the upload.
        ChecksumSHA256: Buffer.from(fromHex(contentHash)).toString("base64"),
      }),
    );
    return {
      contentHash,
      cid: contentCid(fromHex(contentHash)),
      location: { provider: this.name, uri: `s3://${this.bucket}/${key}` },
    };
  }

  async get(contentHash: string) {
    assertHash(contentHash);
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: `${this.prefix}${contentHash}` }),
      );
      const body = res.Body ? new Uint8Array(await res.Body.transformToByteArray()) : null;
      return verified(contentHash, body);
    } catch {
      return null;
    }
  }
}
