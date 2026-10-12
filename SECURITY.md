# Security policy

Stele produces evidence that people may rely on in disputes. We treat any way to forge, alter, replay
or misattribute that evidence — or to make the verifier accept something it should not — as critical.

## Reporting a vulnerability

**Please do not open a public issue.** Report privately through the repository's private vulnerability
reporting ("Security" → "Report a vulnerability"). For a hosted Stele deployment, you may instead use
the security contact published by its operator.

Include what you need to reproduce the issue: affected component and version (commit), steps or a
proof of concept, the impact you observed, and any suggested fix. Use localnet or devnet; never test
against mainnet funds or other people's data.

## What to expect

| Step | Target |
|---|---|
| Acknowledgement | within 3 business days |
| Initial assessment and severity | within 7 days |
| Fix or mitigation for critical issues | as fast as possible; typically within 30 days |
| Coordinated disclosure | after a fix is available, normally within 90 days of the report |

We will keep you informed, credit you in the advisory if you wish, and not pursue legal action for
good-faith research that follows this policy.

## Scope and severity

| Severity | Examples |
|---|---|
| Critical | Recording an acceptance without the user's valid signature; replaying or re-binding a signed message; modifying or deleting a published version; two different contents with the same fingerprint (canonicalization ambiguity); publishing without authority; the verifier reporting `VALID` for invalid or forged evidence; extracting private keys or secrets |
| High | Authority bypass in organization management; acceptance on the wrong network; session hijacking, CSRF, XSS or IDOR exposing or changing another organization's data; SSRF from webhooks or DNS checks; misleading identity display (an unverified organization shown as verified) |
| Medium | Denial of service against the relayer or nonce capacity beyond the documented limits; information leaks of non-public metadata; webhook signature weaknesses |
| Low | Hardening gaps without a demonstrated impact |

In scope: the Solana program, the protocol specification and canonicalization, `@stelehq/protocol`,
`@stelehq/verifier`, `@stelehq/sdk`, the API, workers and indexer, the web app, and the deployment
configuration in this repository.

Out of scope: attacks requiring a compromised user device or wallet software, social engineering,
physical attacks, volumetric denial of service, and the throwaway keys generated for local development.

## Security design

- [Security architecture](docs/security.md) — controls at every layer
- [Threat model](docs/threat-model.md) — 84 scenarios with their defenses, and the residual risks
- [Protocol specification](PROTOCOL_SPEC.md) — the normative rules a verifier enforces
- [What a signature proves](docs/acceptance-signing.md#what-an-acceptance-proves)

## Supported versions

Security fixes are made on the main branch and in the latest release. Protocol `stele/1` evidence
remains verifiable indefinitely; future protocol versions will not invalidate it.
