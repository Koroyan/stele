/** The logger never throws on the errors it is given (a throw while logging crashes the process). */
import { describe, expect, it } from "vitest";
import { Writable } from "node:stream";
import { pino } from "pino";
import { loggerOptions } from "../src/logger.js";

function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, done) {
      lines.push(String(chunk));
      done();
    },
  });
  return { log: pino(loggerOptions("info"), stream), lines };
}

describe("logger", () => {
  it("logs a frozen error with a frozen cause (as @solana/kit RPC errors are)", () => {
    const cause = Object.freeze(new Error("429 Too Many Requests"));
    const err = Object.freeze(new Error("RPC request failed", { cause }));
    const { log, lines } = capture();
    expect(() => log.error({ err, worker: "indexer" }, "worker iteration failed")).not.toThrow();
    const entry = JSON.parse(lines[0]!) as {
      err: { message: string; cause?: { message: string } };
    };
    expect(entry.err.message).toContain("RPC request failed");
    expect(JSON.stringify(entry.err)).toContain("429 Too Many Requests");
  });

  it("logs a frozen error whose fields hold frozen errors (pino walks them too)", () => {
    const inner = Object.freeze(new Error("fetch failed"));
    const err = Object.freeze(Object.assign(new Error("indexer round failed"), { inner }));
    const { log, lines } = capture();
    expect(() => log.error({ err }, "indexer round failed")).not.toThrow();
    expect(lines[0]).toContain("fetch failed");
  });

  it("logs ordinary errors unchanged", () => {
    const { log, lines } = capture();
    log.error({ err: new TypeError("boom") }, "failed");
    expect(JSON.parse(lines[0]!).err).toMatchObject({ type: "TypeError", message: "boom" });
  });
});
