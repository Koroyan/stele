# Stele Privacy Policy

This Privacy Policy explains what personal data Stele processes, why, and what your rights are. It applies to the website at stele.site, the dashboard, the API, the hosted acceptance and verification pages, the relayer, the AI assistant and the contact form (the "Services"). The Services are operated by [OPERATOR LEGAL NAME AND ADDRESS — to be completed before the Mainnet launch] ("Stele", "we", "us").

## 1. Two roles: our customers' users, and our own users

Stele processes personal data in two different roles.

When a person accepts a document of an organization that uses Stele (for example a shop's terms of service), the organization decides why and how that acceptance is recorded. The organization is the controller of that data, and Stele processes it on the organization's behalf as its processor. If you accepted an organization's document and want to exercise your rights, contact that organization; if you contact us, we will forward your request to it.

For the people who use Stele directly — organization owners and members who sign in to the dashboard, developers, visitors of stele.site, people who use the AI assistant or the contact form — Stele is the controller.

## 2. What is written to the blockchain

Stele records evidence on the Solana blockchain, which is public and permanent. Nobody, including Stele, can change or delete data once it is written there.

For an acceptance, the blockchain holds the signer's public key or wallet address, the document version accepted, an acceptance identifier and the time. For a published document version, it holds the organization's name and addresses, the version's title, label and fingerprints. A wallet address or a public key is a pseudonymous identifier: on its own it does not name a person, but it may become personal data when combined with other information.

The text of published documents is stored by Stele and is public. Organizations must not include personal data in it.

## 3. Data we process when someone accepts a document

On behalf of the organization, we process:

- the signer's wallet address or passkey public key, and the signature over the exact text that was accepted;
- the signed message itself, which names the organization, the document, the version, the signer, the network and the time;
- the identifier the organization chose to link to its own user account, if it provides one;
- for passkey signers, the WebAuthn data that proves the passkey approved the message (it contains no biometric data: biometrics never leave the person's device);
- an audit trail kept off-chain and never published: the signer's IP address, encrypted, and the time zone reported by the browser;
- the time, the requesting website and the transaction that recorded the acceptance.

Receipts and public verification pages show the acceptance and its blockchain evidence. They never show the signer's IP address.

## 4. Data we process about our own users

- Dashboard sign-in: your wallet address, and if you provide them, your display name and e-mail address; session records containing a keyed hash of your IP address (not the address itself) and your browser's user agent.
- Organization activity: an audit log of actions taken in your organization (who did what and when), with a keyed hash of the IP address.
- Billing: the payments you make, which are public blockchain transfers, and your credit balance.
- Contact form: your name, e-mail address, company, website, the subject and your message, and a keyed hash of your IP address to prevent abuse.
- AI assistant: the questions you ask, and in the dashboard a summary of your organization's configuration, are sent to our AI provider to generate an answer (see section 6). We do not keep the conversation; we keep only counters to limit abuse.
- Live demo: a keyed hash of your IP address, to limit the number of demo sessions.
- Website: technical logs kept by our servers for security and operations. We do not use advertising or tracking cookies; the dashboard uses cookies that are strictly necessary for sign-in and security.

## 5. Why we process it, and on what basis

- To provide the Services you or an organization requested, including recording and verifying evidence — performance of a contract.
- To keep the Services secure, prevent abuse and fraud, and fix problems — our legitimate interests.
- To answer your messages and partnership requests — our legitimate interests, or steps you ask us to take before a contract.
- To keep records required by law, such as accounting records — legal obligation.
- Where we process data as a processor, we do so only on the organization's instructions.

We do not sell personal data, and we do not use it for advertising.

## 6. Who we share it with

- Service providers that host and operate the Services for us, under contracts that require them to protect the data: cloud hosting, storage, RPC access to the Solana network, and the AI provider for the assistant (OpenAI). What you type in the assistant is sent to OpenAI under its API terms, which do not allow it to train its models on that data by default.
- The organization whose document you accepted, which can see your acceptance and its audit trail in its dashboard and API.
- Anyone, for data written to the public blockchain or published as documents.
- Authorities, when the law requires it, and a successor of the Services if they are transferred.

## 7. International transfers

Our service providers may process data in countries other than yours, including the United States. Where the law requires it, we rely on appropriate safeguards such as standard contractual clauses.

## 8. How long we keep it

- Blockchain records are permanent and cannot be deleted.
- Acceptance records and their off-chain audit trail are kept for as long as the organization keeps its account, so that acceptances remain provable, unless the organization asks us to delete them earlier.
- Session records expire with the session; audit logs are kept for the life of the organization's account.
- Contact form messages are kept for up to two years after the last exchange, unless they lead to an agreement.
- Server logs are kept for a short period for security purposes.

## 9. Your rights

Depending on where you live, you may have the right to access your personal data, correct it, delete it, restrict or object to its processing, receive it in a portable format, and withdraw consent where processing is based on consent. You may also complain to your data protection authority.

Some data cannot be deleted because it is written to a public blockchain. In that case we can delete what we hold off-chain, such as the audit trail and identifiers that link a wallet to you.

To exercise your rights about data for which Stele is the controller, use the contact form. For acceptances of an organization's documents, contact that organization.

## 10. Security

We protect personal data with technical and organizational measures, including encryption of signers' IP addresses and webhook secrets, keyed hashing of IP addresses in logs, signed sessions with CSRF protection, and access limited to the people who need it. No system is perfectly secure; we will inform you and the authorities of a breach where the law requires it.

## 11. Children

The Services are not intended for children under 16, and we do not knowingly collect their personal data.

## 12. Changes to this Policy

Each version of this Policy is published with Stele, so anyone can see what changed and when. We will tell dashboard users about material changes.

## 13. Contact

Questions and requests about privacy: use the contact form at stele.site/contact.
