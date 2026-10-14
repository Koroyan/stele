import type { Metadata } from "next";
import Link from "next/link";
import {
  DEFAULT_PROGRAM_ADDRESS,
  GATE_DEMO_PROGRAM_ADDRESS,
  GATE_ERRORS,
  PROGRAM_ERRORS,
  PROGRAM_ERROR_OFFSET,
} from "@stelehq/protocol";
import { Reference, type RefGroup } from "@/components/developers/reference";

export const metadata: Metadata = {
  title: "On-chain reference",
  description:
    "The stele-gate crate for your Solana program, the Policy, Passport and AccessPass accounts, reading them from TypeScript, the Stele program's instructions and every error code.",
};

function Table({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-line">
      <table className="w-full min-w-[620px] border-collapse text-left text-[13px]">
        <thead>
          <tr className="bg-surface-2 text-[11.5px] uppercase tracking-[0.06em] text-fg-subtle">
            {head.map((h) => (
              <th key={h} scope="col" className="px-4 py-2.5 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={String(r[0]) + String(r[1])} className="border-t border-line align-top">
              {r.map((c, i) => (
                <td
                  key={i}
                  className={
                    i < 2
                      ? "px-4 py-2.5 font-mono text-[12px] text-fg"
                      : "px-4 py-2.5 text-fg-muted"
                  }
                >
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const INSTRUCTIONS: [string, string, string][] = [
  [
    "create_policy",
    "Organization (owner, admin, publisher)",
    "Creates a document's Gate policy: the version a protected action requires.",
  ],
  [
    "set_policy_requirement",
    "Organization",
    "Requires another published version (higher or lower). Emits PolicyChanged.",
  ],
  [
    "record_passport_acceptance",
    "Any relayer allowed by the shard",
    "Records a wallet's signed acceptance and adds or advances the document in the signer's passport. The rent payer (the investor or the organization) deposits only the new bytes and gets them back. Refuses a version already recorded (AccessPassAlreadyCurrent).",
  ],
  [
    "remove_passport_entry · close_passport",
    "The holder, or whoever paid the deposit",
    "Removes one document, or closes the passport, and refunds each deposit to whoever paid it. Receipts still verify.",
  ],
  [
    "record_gated_acceptance",
    "Any relayer allowed by the shard",
    "Per-document storage: records the acceptance and creates or advances an AccessPass (paid by the relayer, never closed).",
  ],
  ["record_acceptance", "Relayer", "Records a signed acceptance (Stele Proof)."],
  ["record_passkey_acceptance", "Relayer", "Records a native-passkey (P-256) acceptance."],
  [
    "anchor_acceptance_batch",
    "Relayer",
    "Anchors many verified acceptances under one Merkle root.",
  ],
  ["record_proof", "Relayer", "Records a customer-confirmed proof (purchase, refund, consent)."],
  ["create_organization", "Creator wallet", "Creates an organization."],
  ["create_document", "Organization", "Creates a document."],
  ["publish_version", "Organization", "Publishes an immutable version with its fingerprint."],
  [
    "create_nonce_shard / set_shard_relayer",
    "Organization",
    "Replay protection; sets who may submit acceptances — your relayer, or the zero key for anyone.",
  ],
  [
    "add_member · propose_owner · propose_recovery",
    "Organization",
    "Roles, ownership and recovery.",
  ],
];

function groups(): RefGroup[] {
  return [
    {
      id: "crate",
      title: "stele-gate (your program)",
      intro: (
        <>
          Add <code className="font-mono text-fg">stele-gate = &quot;1.1&quot;</code> to Cargo.toml
          (
          <a href="https://crates.io/crates/stele-gate" className="text-accent">
            crates.io
          </a>
          , needs anchor-lang 1.2+). Your program reads two Stele accounts and decides — no CPI, no
          Stele server in the transaction. On Solana Playground, copy the check from the{" "}
          <Link
            href="/docs/gate-guide#step-2-add-the-check-to-your-program-5-minutes"
            className="text-accent"
          >
            Gate guide
          </Link>
          .
        </>
      ),
      entries: [
        {
          name: "require_current_passport",
          kind: "fn",
          signatureLanguage: "rust",
          signature: `pub fn require_current_passport(
    passport: &AccountInfo, // passport_address(user).0
    policy: &AccountInfo,   // pin it: #[account(address = POLICY)]
    user: &AccountInfo,     // must sign
) -> Result<PassportAccess, ProgramError>`,
          description:
            "Succeeds only if user signed and their passport names the policy's document at the required version or a later one. Otherwise the transaction fails with a Gate error (below). No fee; about 10k compute units whether the wallet accepted one document or ten thousand.",
          exampleLanguage: "rust",
          example: `pub const POLICY: Pubkey = pubkey!("YOUR_POLICY_ADDRESS");

pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    stele_gate::require_current_passport(&ctx.accounts.passport, &ctx.accounts.policy, &ctx.accounts.user)?;
    // … the protected action
    Ok(())
}`,
        },
        {
          name: "require_passport_policies",
          kind: "fn",
          signatureLanguage: "rust",
          signature: `pub fn require_passport_policies(
    required: &[Pubkey],        // YOUR pinned list
    policies: &[AccountInfo],   // the policies — e.g. ctx.remaining_accounts
    passport: &AccountInfo,
    user: &AccountInfo,
) -> Result<Vec<PassportAccess>, ProgramError>`,
          description:
            "Several documents for one action: one passport, N policies (N + 1 accounts). Fails if a required policy is missing from the accounts or not satisfied.",
        },
        {
          name: "require_current",
          kind: "fn",
          signatureLanguage: "rust",
          signature: `pub fn require_current(
    access_pass: &AccountInfo,
    policy: &AccountInfo,
    user: &AccountInfo,
) -> Result<GrantedAccess, ProgramError>`,
          description:
            "The same check for organizations that use per-document access passes (Gate settings → storage).",
        },
        {
          name: "require_policies",
          kind: "fn",
          signatureLanguage: "rust",
          signature: `pub fn require_policies(
    required: &[Pubkey],        // YOUR pinned list
    accounts: &[AccountInfo],   // [policy, access_pass, …] — e.g. ctx.remaining_accounts
    user: &AccountInfo,
) -> Result<Vec<GrantedAccess>, ProgramError>`,
          description: "Several documents with access passes, any number.",
        },
        {
          name: "require_all_current",
          kind: "fn",
          signatureLanguage: "rust",
          signature: `pub fn require_all_current(
    requirements: &[(&AccountInfo, &AccountInfo)],   // (access_pass, policy)
    user: &AccountInfo,
) -> Result<Vec<GrantedAccess>, ProgramError>`,
          description: "The same with named accounts.",
        },
        {
          name: "passport_address · policy_address · access_pass_address",
          kind: "fn",
          signatureLanguage: "rust",
          signature: `pub fn passport_address(holder: &Pubkey) -> (Pubkey, u8)
pub fn policy_address(document: &Pubkey) -> (Pubkey, u8)
pub fn access_pass_address(document: &Pubkey, holder: &Pubkey) -> (Pubkey, u8)`,
          description: "The PDAs, under the Stele program.",
        },
        {
          name: "PassportAccess",
          kind: "struct",
          signatureLanguage: "rust",
          signature: `pub struct PassportAccess {
    pub organization: Pubkey, pub document: Pubkey,
    pub version_number: u32, pub required_version: u32,
    pub accepted_at: i64,
}`,
          description: "Which accepted version allowed the action — useful in your own events.",
        },
        {
          name: "GrantedAccess",
          kind: "struct",
          signatureLanguage: "rust",
          signature: `pub struct GrantedAccess {
    pub organization: Pubkey, pub document: Pubkey, pub version: Pubkey,
    pub version_number: u32, pub version_hash: [u8; 32], pub required_version: u32,
    pub acceptance_id: [u8; 32],   // the Proof receipt of this acceptance
    pub accepted_at: i64,
}`,
          description: "The same for an access pass, with the acceptance identifier.",
        },
      ],
      after: (
        <>
          <p className="mb-3 text-[14px] font-semibold text-fg">Gate errors</p>
          <Table
            head={["Code", "Name", "Meaning"]}
            rows={GATE_ERRORS.map(([code, name, msg]) => [code, name, msg])}
          />
        </>
      ),
    },
    {
      id: "accounts",
      title: "Accounts",
      intro: (
        <>
          Owned by the Stele program{" "}
          <code className="font-mono text-fg">{DEFAULT_PROGRAM_ADDRESS}</code> (same address on
          Devnet and Localnet). Offsets include Anchor&apos;s 8-byte discriminator.
        </>
      ),
      entries: [
        {
          name: "Policy",
          kind: "PDA",
          signatureLanguage: "text",
          signature: `seeds: ["policy", document]                 157 bytes
8   organization            40  document
72  required version hash   104 updated_by
152 required version (u32) 156 bump`,
          description:
            "One per document. Created and changed only by the organization; publishing a version does not change it.",
        },
        {
          name: "Passport",
          kind: "PDA",
          signatureLanguage: "text",
          signature: `seeds: ["passport", wallet]      77 + 76 × entries bytes
8   holder (the wallet)     40  entry count (u32)
44  bump                    45  base payer
77  entries, sorted by document — each 76 bytes:
    +0 document  +32 version number (u32)  +36 accepted_at (i64)  +44 payer`,
          description:
            "One per wallet, an entry for every document it accepted. Entries are added only from the wallet's own signature and never move back to an older version. Each deposit belongs to whoever paid it (about $0.29 for the first document, $0.08 for each further one) and is refunded when the entry is removed.",
        },
        {
          name: "AccessPass",
          kind: "PDA",
          signatureLanguage: "text",
          signature: `seeds: ["access-pass", document, wallet]      233 bytes
8   organization            40  document
72  holder (the wallet)     104 accepted version
136 version hash            168 acceptance_id
200 accepted_at (i64)       224 version number (u32)
232 bump`,
          description:
            "Per-document storage: one per wallet and document. Created only from the wallet's own signature; never moves back to an older version; never closed.",
        },
      ],
    },
    {
      id: "typescript",
      title: "Read them from TypeScript",
      intro: (
        <>
          <code className="font-mono text-fg">npm install @stelehq/protocol</code> — no Stele server
          involved.
        </>
      ),
      importLine: `import { createRpc, fetchAccountData, decodeGatePolicy, decodePassport, passportEntry, findPassportPda, findPolicyPda } from "@stelehq/protocol";`,
      entries: [
        {
          name: "findPassportPda(wallet)",
          kind: "function",
          signature: `findPassportPda(holder: Address): Promise<[Address, number]>
findPolicyPda(document: Address): Promise<[Address, number]>
findAccessPassPda(document: Address, holder: Address): Promise<[Address, number]>`,
          description: "The addresses your instruction needs: pass them as passport and policy.",
        },
        {
          name: "decodeGatePolicy · decodePassport · passportEntry",
          kind: "function",
          signature: `decodeGatePolicy(data: Uint8Array): GatePolicyAccount   // { document, requiredVersion, … }
decodePassport(data: Uint8Array): PassportAccount       // { holder, basePayer, entries }
passportEntry(passport, document): PassportEntry | null  // { versionNumber, acceptedAt, payer }
decodeAccessPass(data: Uint8Array): AccessPassAccount   // { holder, versionNumber, … }`,
          description:
            "Decode the accounts. readAccess(rpc, { policy, holder }) does all of this and reads both storages.",
          example: `const rpc = createRpc("https://api.devnet.solana.com");
const policy = decodeGatePolicy((await fetchAccountData(rpc, POLICY))!);
const [passport] = await findPassportPda(wallet);
const data = await fetchAccountData(rpc, passport);
const entry = data ? passportEntry(decodePassport(data), policy.document) : null;
const status = !entry ? "MISSING"
  : entry.versionNumber >= policy.requiredVersion ? "VALID" : "OUTDATED";`,
        },
      ],
    },
    {
      id: "program",
      title: "The Stele program",
      intro: (
        <>
          You call these through the SDK, the dashboard or a relayer — integrators rarely build them
          by hand. Builders for each are in{" "}
          <code className="font-mono text-fg">@stelehq/protocol</code> (e.g.{" "}
          <code className="font-mono text-fg">recordPassportAcceptanceInstruction</code>). The demo
          vault program is <code className="font-mono text-fg">{GATE_DEMO_PROGRAM_ADDRESS}</code>.
        </>
      ),
      entries: [],
      after: (
        <>
          <Table head={["Instruction", "Signed by", "What it does"]} rows={INSTRUCTIONS} />
          <p className="mb-3 mt-8 text-[14px] font-semibold text-fg">Program errors</p>
          <Table
            head={["Code", "Name", "Meaning"]}
            rows={PROGRAM_ERRORS.map(([name, msg], i) => [PROGRAM_ERROR_OFFSET + i, name, msg])}
          />
        </>
      ),
    },
  ];
}

export default function OnchainPage() {
  return (
    <Reference
      title="On-chain reference"
      lead={
        <>
          For your Solana program: the <code className="font-mono text-fg">stele-gate</code> crate,
          the two accounts it reads, and every error code. Step by step:{" "}
          <Link href="/docs/gate-guide" className="text-accent">
            Gate guide
          </Link>
          .
        </>
      }
      groups={groups()}
    />
  );
}
