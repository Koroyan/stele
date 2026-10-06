#!/usr/bin/env node
/**
 * stele-verify — verify Stele evidence from the command line, without any Stele server.
 *
 *   stele-verify --rpc https://api.mainnet-beta.solana.com --tx <signature>
 *   stele-verify --rpc <url> --rpc <url2> --receipt receipt.json      (stele-receipt-v1 or /2)
 *   stele-verify --rpc <url> --tx <anchor signature> --batched leaf.json   (a batch manifest leaf)
 *   stele-verify --rpc <url> --version <address> | --fingerprint <hex>
 *
 * Every RPC given must agree, or the verdict is INCONCLUSIVE. Nothing here calls a Stele server.
 *
 * Options: --program <id>  --expect-chain <caip2>  --mirror <url>  --dns  --deep  --json
 * Exit code: 0 VALID, 1 VALID_WITH_WARNINGS, 2 INVALID, 3 INCONCLUSIVE, 64 usage error.
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { chainFromUrls } from "./index";
import type { VerificationReport } from "./report";
import { verifyAcceptance, verifyDocumentVersion } from "./verify";

const { values } = parseArgs({
  options: {
    rpc: { type: "string", multiple: true },
    tx: { type: "string" },
    receipt: { type: "string" },
    batched: { type: "string" },
    "acceptance-id": { type: "string" },
    "show-text": { type: "boolean", default: false },
    version: { type: "string" },
    fingerprint: { type: "string" },
    program: { type: "string" },
    "expect-chain": { type: "string" },
    mirror: { type: "string", multiple: true },
    dns: { type: "boolean", default: false },
    deep: { type: "boolean", default: false },
    json: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
  strict: true,
});

function usage(code: number): never {
  console.error(
    "usage: stele-verify --rpc <url> [--rpc <url>...] (--tx <sig> [--batched <leaf.json>] [--acceptance-id <hex>] | --receipt <file> | --version <address> | --fingerprint <hex>)\n" +
      "       [--program <id>] [--expect-chain <caip2>] [--mirror <url>] [--dns] [--deep] [--show-text] [--json]",
  );
  process.exit(code);
}

if (values.help) usage(0);
const rpcs = values.rpc ?? [];
if (
  rpcs.length === 0 ||
  [values.tx, values.receipt, values.version, values.fingerprint].filter(Boolean).length !== 1
)
  usage(64);

const opts = {
  chain: chainFromUrls(rpcs),
  programId: values.program,
  expectedChainId: values["expect-chain"],
  content: { mirrors: values.mirror },
  liveDnsCheck: values.dns,
  deepPublicationSearch: values.deep,
};

const ICON: Record<string, string> = { pass: "✔", fail: "✘", warn: "!", skip: "–", error: "?" };

function print(report: VerificationReport): void {
  if (values.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`\nStele verification — ${report.subject.kind} ${report.subject.reference}`);
  console.log(`Chain sources: ${report.sources.chain}\n`);
  for (const c of report.checks)
    console.log(`  ${ICON[c.status]} ${c.label.padEnd(30)} ${c.detail}`);
  console.log(`\nVerdict: ${report.verdict}\n${report.summary}\n`);
  const f = report.facts;
  if (f.organization)
    console.log(
      `Organization: ${f.organization.name} (${f.organization.verifiedDomain ?? "unverified"}) ${f.organization.address}`,
    );
  if (f.version)
    console.log(
      `Version:      ${f.version.title} ${f.version.label} (#${f.version.number}) fingerprint ${f.version.fingerprint}`,
    );
  if (f.acceptance) {
    console.log(
      `Accepted by:  ${f.acceptance.signer} in slot ${f.acceptance.slot} (tx ${f.acceptance.transaction})`,
    );
    console.log(
      `Evidence:     ${f.acceptance.protocol} · ${f.acceptance.evidenceMode}${f.batch ? ` · root ${f.batch.root} (leaf ${f.batch.leafIndex} of ${f.batch.leafCount})` : ""}`,
    );
  }
  if (f.signer)
    console.log(
      `Signer type:  ${f.signer.type === "NATIVE_PASSKEY" ? "PASSKEY_P256 (native WebAuthn, ES256)" : f.signer.type}${f.signer.native ? ` · user verification: ${f.signer.native.userVerified ? "yes" : "no"} · relying party ${f.signer.native.rpId}${f.signer.native.enrollment ? ` · enrollment ${f.signer.native.enrollment.address} (${f.signer.native.enrollment.kind}, ${f.signer.native.enrollment.status})` : ""}` : ""}`,
    );
  if (f.origin)
    console.log(
      `Origin:       ${f.origin.attestation === "BROWSER_ATTESTED" ? `${f.origin.origin} — browser-attested through WebAuthn` : `${f.origin.requestDomain} — merchant-claimed, not browser-attested`}`,
    );
  if (values["show-text"] && f.acceptance?.message)
    console.log(`\nSigned text:\n${f.acceptance.message}`);
  if (values["show-text"] && f.content)
    console.log(`\nDocument (canonical, from ${f.content.source}):\n${f.content.canonical}`);
  console.log(
    "\nNote: a valid signature proves that the signing credential (a wallet key, or a passkey with\nuser verification) accepted this exact version. It does not by itself prove the identity of the\nperson who controlled it, nor whether the agreement is legally enforceable.",
  );
}

const report =
  values.tx || values.receipt
    ? await verifyAcceptance(
        values.receipt
          ? { receipt: JSON.parse(readFileSync(values.receipt, "utf8")) }
          : {
              transactionSignature: values.tx!,
              acceptanceId: values["acceptance-id"],
              batched: values.batched
                ? (JSON.parse(readFileSync(values.batched, "utf8")) as unknown)
                : undefined,
            },
        opts,
      )
    : await verifyDocumentVersion(
        values.version ? { versionAddress: values.version } : { fingerprint: values.fingerprint! },
        opts,
      );

print(report);
process.exit({ VALID: 0, VALID_WITH_WARNINGS: 1, INVALID: 2, INCONCLUSIVE: 3 }[report.verdict]);
