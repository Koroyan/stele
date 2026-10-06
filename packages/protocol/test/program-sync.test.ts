/**
 * The codecs in this package mirror the Rust program by hand. These checks read the program's sources
 * and fail when the two drift apart: error codes (their order is part of the public interface),
 * instruction names, account types and the events this package decodes.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ACCOUNT_NAMES, EVENT_NAMES, INSTRUCTION_NAMES, PROGRAM_ERRORS } from "../src";

function programSource(file: string): string {
  return readFileSync(new URL(`../../../programs/stele/src/${file}`, import.meta.url), "utf8");
}

function captures(source: string, pattern: RegExp): string[][] {
  return [...source.matchAll(pattern)].map((m) => m.slice(1));
}

describe("codecs match the program sources", () => {
  it("lists every program error in order, with the program's message", () => {
    const [, body = ""] = programSource("error.rs").split(/pub enum SteleError\s*\{/);
    const errors = captures(body, /#\[msg\("((?:[^"\\]|\\.)*)"\)\]\s*(\w+),/g).map(
      ([message, name]) => [name, message],
    );
    expect(errors.length).toBeGreaterThan(50);
    expect(PROGRAM_ERRORS.map(([name, message]) => [name, message])).toEqual(errors);
  });

  it("knows every instruction of the program", () => {
    const [, body = ""] = programSource("lib.rs").split(/pub mod stele\s*\{/);
    const names = captures(body, /^\s*pub fn (\w+)\s*\(/gm).map(([name]) => name);
    expect(names.length).toBeGreaterThan(0);
    expect([...INSTRUCTION_NAMES].sort()).toEqual(names.sort());
  });

  it("decodes every account type of the program", () => {
    const names = captures(
      programSource("state.rs"),
      /#\[account(?:\([^)]*\))?\]\s*(?:#\[[^\]]*\]\s*)*pub struct (\w+)/g,
    ).map(([name]) => name);
    expect([...ACCOUNT_NAMES].sort()).toEqual(names.sort());
  });

  it("decodes only events the program emits", () => {
    const emitted = captures(programSource("events.rs"), /#\[event\]\s*pub struct (\w+)/g).map(
      ([name]) => name,
    );
    expect(emitted.length).toBeGreaterThan(0);
    for (const name of EVENT_NAMES) expect(emitted).toContain(name);
  });
});
