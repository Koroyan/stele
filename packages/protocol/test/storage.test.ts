import { describe, expect, it } from "vitest";
import {
  base32Lower,
  contentCid,
  contentHashFromStorageUri,
  contentStorageUri,
  sha256,
  utf8,
  validateStorageUri,
} from "../src/index";

describe("content addressing", () => {
  it("base32 matches RFC 4648 test vectors (lowercase, unpadded)", () => {
    expect(base32Lower(utf8("f"))).toBe("my");
    expect(base32Lower(utf8("fo"))).toBe("mzxq");
    expect(base32Lower(utf8("foobar"))).toBe("mzxw6ytboi");
  });

  it("derives a raw-codec sha2-256 CIDv1 that round-trips", () => {
    const hash = sha256(utf8("hello"));
    const cid = contentCid(hash);
    expect(cid.startsWith("bafkrei")).toBe(true);
    expect(cid).toHaveLength(59);
    const uri = contentStorageUri(hash);
    expect(() => validateStorageUri(uri)).not.toThrow();
    expect(contentHashFromStorageUri(uri)).toEqual(hash);
    expect(contentHashFromStorageUri("ipfs://bafybeigdyrzt")).toBeNull();
  });

  it("matches the well-known CID of the bytes 'hello'", () => {
    // `ipfs add --cid-version 1 --raw-leaves` of "hello" (no newline).
    expect(contentCid(sha256(utf8("hello")))).toBe(
      "bafkreibm6jg3ux5qumhcn2b3flc3tyu6dmlb4xa7u5bf44yegnrjhc4yeq",
    );
  });
});
