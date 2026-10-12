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
    "The stele-gate crate for your Solana program, the Policy and AccessPass accounts, reading them from TypeScript, the Stele program's instructions and every error code.",
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
    "record_gated_acceptance",
    "Any relayer allowed by the shard",
    "Records a wallet's signed acceptance and creates or advances its AccessPass. Refuses a version the pass already names (AccessPassAlreadyCurrent).",
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
          Add <code className="font-mono text-fg">stele-gate = &quot;1&quot;</code> to Cargo.toml (
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
          name: "require_current",
          kind: "fn",
          signatureLanguage: "rust",
          signature: `pub fn require_current(
    access_pass: &AccountInfo,
    policy: &AccountInfo,   // pin it: #[account(address = POLICY)]
    user: &AccountInfo,     // must sign
) -> Result<GrantedAccess, ProgramError>`,
          description:
            "Succeeds only if user signed and holds an AccessPass naming the policy's required version or a later one. Otherwise the transaction fails with a Gate error (below).",
          exampleLanguage: "rust",
          example: `pub const POLICY: Pubkey = pubkey!("YOUR_POLICY_ADDRESS");

pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    stele_gate::require_current(&ctx.accounts.access_pass, &ctx.accounts.policy, &ctx.accounts.user)?;
    // … the protected action
    Ok(())
}`,
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
          description:
            "Several documents for one action, any number. Fails if a required policy is missing from the accounts or not satisfied.",
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
          name: "access_pass_address · policy_address",
          kind: "fn",
          signatureLanguage: "rust",
          signature: `pub fn access_pass_address(document: &Pubkey, holder: &Pubkey) -> (Pubkey, u8)
pub fn policy_address(document: &Pubkey) -> (Pubkey, u8)`,
          description: "The PDAs, under the Stele program.",
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
          description: "Which acceptance allowed the action — useful in your own events.",
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
            "One per wallet and document. Created only from the wallet's own signature; never moves back to an older version; never closed.",
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
      importLine: `import { createRpc, fetchAccountData, decodeGatePolicy, decodeAccessPass, findAccessPassPda, findPolicyPda } from "@stelehq/protocol";`,
      entries: [
        {
          name: "findAccessPassPda(document, wallet)",
          kind: "function",
          signature: `findAccessPassPda(document: Address, holder: Address): Promise<[Address, number]>
findPolicyPda(document: Address): Promise<[Address, number]>`,
          description: "The addresses your instruction needs: pass them as access_pass and policy.",
        },
        {
          name: "decodeGatePolicy · decodeAccessPass",
          kind: "function",
          signature: `decodeGatePolicy(data: Uint8Array): GatePolicyAccount   // { document, requiredVersion, … }
decodeAccessPass(data: Uint8Array): AccessPassAccount   // { holder, versionNumber, … }`,
          description: "Decode the accounts.",
          example: `const rpc = createRpc("https://api.devnet.solana.com");
const policy = decodeGatePolicy((await fetchAccountData(rpc, POLICY))!);
const [pass] = await findAccessPassPda(policy.document, wallet);
const data = await fetchAccountData(rpc, pass);
const status = !data ? "MISSING"
  : decodeAccessPass(data).versionNumber >= policy.requiredVersion ? "VALID" : "OUTDATED";`,
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
          <code className="font-mono text-fg">recordGatedAcceptanceInstruction</code>). The demo
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
