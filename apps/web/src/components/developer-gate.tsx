/**
 * Developers page: the Stele Gate quickstart and the questions developers ask. Code samples are the
 * real API (crates/stele-gate, packages/sdk, packages/protocol, programs/gate-demo).
 */
import Link from "next/link";
import { CodeBlock } from "@stele/ui";
import { Section, SectionHeading } from "@/components/marketing";

const STEPS: { title: string; body: string; code?: string; language?: string }[] = [
  {
    title: "Create a policy",
    body: "Dashboard → Gate → Policies: pick the document (e.g. your offering terms) and the version a protected action requires. Your organization's wallet signs create_policy. Raise the requirement later with “Require this version”.",
  },
  {
    title: "Add the SDK",
    body: "The SDK lives in the Stele repository (packages/sdk); publication to npm is on the roadmap. Or load /sdk/v1/stele.js and use Stele.createGate().",
    code: `import { createSteleGate } from "@stele/sdk";`,
    language: "ts",
  },
  {
    title: "Wrap the protected action",
    body: "The modal appears only when the wallet's AccessPass is missing or outdated.",
    code: `const stele = createSteleGate({ apiBaseUrl: "https://stele.example/api", wallet });

await stele.gate({
  policy: OFFERING_TERMS_POLICY,
  action: () => sendDepositTransaction(),
  acceptLabel: "Accept & Deposit",
});`,
    language: "ts",
  },
  {
    title: "Add the AccessPass and the policy to your instruction",
    body: "Pin the policy: store its address when you create the vault (or use a constant).",
    code: `#[derive(Accounts)]
pub struct Deposit<'info> {
    pub investor: Signer<'info>,
    #[account(mut, seeds = [b"vault", vault.policy.as_ref()], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    /// CHECK: pinned to the vault's policy; verified by require_current
    #[account(address = vault.policy)]
    pub policy: UncheckedAccount<'info>,
    /// CHECK: verified by require_current
    pub access_pass: UncheckedAccount<'info>,
}`,
    language: "rust",
  },
  {
    title: "Call require_current",
    body: "One call; it checks owners, canonical addresses, the wallet, the document, the organization and the required version.",
    code: `stele_gate::require_current(
    &ctx.accounts.access_pass,
    &ctx.accounts.policy,
    &ctx.accounts.investor,
)?;`,
    language: "rust",
  },
  {
    title: "Test: missing pass → rejected",
    body: "A fresh wallet calls your instruction: expect AccessPassMissing (7602).",
  },
  {
    title: "Test: current pass → succeeds",
    body: "Record an acceptance (the SDK, or the acceptance API) and call again.",
  },
  {
    title: "Test: outdated pass → rejected",
    body: "Publish v2 and require it: the v1 pass must fail with AccessPassOutdated (7605).",
  },
  {
    title: "Test: a direct CLI call → rejected",
    body: "No frontend, no SDK, no Stele API — straight to the RPC:",
    code: `STELE_RPC_URL=https://api.devnet.solana.com \\
  pnpm --filter @stele/localnet vault-deposit -- --policy <policy address>
✘ rejected on-chain by the vault program — AccessPassMissing`,
    language: "shell",
  },
];

const FAQ: { q: string; a: React.ReactNode }[] = [
  {
    q: "What is Stele Proof?",
    a: "Evidence of which exact version of a document a user accepted: the text's fingerprint on Solana, the user's passkey or wallet signature over it, a time, and a receipt anyone can verify later.",
  },
  {
    q: "What is Stele Gate?",
    a: "Proof plus enforcement for Solana apps: an AccessPass records each wallet's latest accepted version, a policy states which version is required, and your program checks both with require_current() before a protected action.",
  },
  {
    q: "When should I use Gate?",
    a: "When a Solana action must not happen without the current terms — deposits into an RWA vault, a token offering, permissioned credit. If you only need to prove what was accepted, use Proof.",
  },
  {
    q: "How does an AccessPass work?",
    a: "It is an account of the Stele program at [access-pass, document, wallet]. Only a verified acceptance can create or advance it; it records the accepted version, its fingerprint and the acceptance ID.",
  },
  {
    q: "How does policy versioning work?",
    a: "The policy ([policy, document]) names the lowest version that satisfies it. Publishing v2 changes nothing until the organization requires v2; from then on, passes for v1 fail and holders must accept v2.",
  },
  {
    q: "How does program-level enforcement work — and why isn't a frontend check enough?",
    a: "Anyone can send a transaction to your program from a script, the CLI or another frontend, skipping your UI. require_current() runs inside your program, so the requirement holds whatever client sent the transaction.",
  },
  {
    q: "How does Accept & Continue work?",
    a: "If the pass is missing or outdated, the SDK shows the modal, records the acceptance (transaction 1, paid by Stele), waits until Solana shows the pass, then runs your action (transaction 2). It is one step for the user, not one atomic transaction.",
  },
  {
    q: "What happens after a policy update?",
    a: "Existing passes keep naming the version their holders accepted — that evidence stays verifiable forever. They just stop satisfying the policy; the next action shows the modal for the new version.",
  },
  {
    q: "How do I test a direct bypass?",
    a: (
      <>
        Call your instruction without the SDK from a wallet with no pass, with someone else&apos;s
        pass, and with an outdated pass — all must fail. The repository&apos;s{" "}
        <code className="font-mono text-[12.5px]">programs/stele/tests/gate.rs</code> and{" "}
        <code className="font-mono text-[12.5px]">vault-deposit</code> tool show how.
      </>
    ),
  },
  {
    q: "Does Stele custody funds?",
    a: "No. Stele is not in your action's execution path: your program reads the pass and the policy itself. Stele's relayer only pays the fee for recording acceptances.",
  },
  {
    q: "Does Stele do KYC?",
    a: "No. A wallet or passkey proves control of a key — Face ID is not KYC. Stele answers “which exact document version did you accept?”, not “who are you?”. KYC, jurisdiction and accreditation checks are future integrations.",
  },
  {
    q: "What is implemented, and what is roadmap?",
    a: (
      <>
        Implemented (Devnet): policies, AccessPasses, require_current, the SDK and modal, the demo
        vault, dashboard pages and tests. Roadmap: Mainnet, a multisig upgrade authority, an
        external audit, npm/crates publication, eligibility integrations (KYC, Token ACL, SAS). See
        the{" "}
        <Link href="/docs/gate" className="text-accent hover:underline">
          Gate guide
        </Link>
        .
      </>
    ),
  },
];

export function GateQuickstart() {
  return (
    <Section id="gate" className="border-t border-line bg-bg-raised">
      <SectionHeading
        eyebrow="Stele Gate quickstart"
        title="Require current acceptance in nine steps."
        lead="For Solana programs. The frontend part is user experience; the program part is the enforcement."
      />
      <ol className="mt-10 space-y-4">
        {STEPS.map((s, i) => (
          <li
            key={s.title}
            className="grid gap-4 rounded-2xl border border-line bg-surface p-5 lg:grid-cols-[0.8fr_1.2fr]"
          >
            <div>
              <p className="font-mono text-[12px] text-accent">{String(i + 1).padStart(2, "0")}</p>
              <p className="mt-1 text-[15.5px] font-semibold text-fg">{s.title}</p>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-fg-muted">{s.body}</p>
            </div>
            {s.code ? (
              <CodeBlock code={s.code} language={s.language} />
            ) : (
              <div aria-hidden="true" />
            )}
          </li>
        ))}
      </ol>
    </Section>
  );
}

export function DeveloperFaq() {
  return (
    <Section className="border-t border-line">
      <SectionHeading eyebrow="Questions" title="What developers ask." />
      <div className="mt-10 divide-y divide-line rounded-2xl border border-line bg-surface">
        {FAQ.map((f) => (
          <details key={f.q} className="group px-5 py-4">
            <summary className="cursor-pointer list-none text-[15px] font-medium text-fg marker:hidden">
              <span className="mr-2 inline-block text-accent transition-transform group-open:rotate-90">
                ›
              </span>
              {f.q}
            </summary>
            <div className="mt-2 pl-5 text-[14px] leading-relaxed text-fg-muted">{f.a}</div>
          </details>
        ))}
      </div>
    </Section>
  );
}
