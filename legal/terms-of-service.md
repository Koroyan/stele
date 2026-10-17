# Stele Terms of Service

These Terms of Service ("Terms") govern your use of Stele: the website at stele.site, the Stele dashboard, the Stele API, the software development kits, the hosted acceptance and verification pages, the relayer, the AI assistant and every other service we offer under the Stele name (together, the "Services"). They are an agreement between you and the operator of Stele, [OPERATOR LEGAL NAME AND ADDRESS — to be completed before the Mainnet launch] ("Stele", "we", "us").

You accept these Terms when you sign them with your wallet in the Stele dashboard. That acceptance is itself recorded with Stele: your wallet signs the exact text of this version, and the record is kept on the Solana blockchain. If you use the Services for an organization, you confirm that you are authorized to accept these Terms on its behalf, and "you" means both you and that organization.

If you do not agree to these Terms, do not use the Services.

## 1. Who may use the Services

The Services are intended for businesses, developers and other professional users. You must be at least 18 years old and able to enter into a binding contract.

You may not use the Services if you are subject to sanctions administered by the United Nations, the European Union, the United Kingdom or the United States, if you act on behalf of a sanctioned person, or if using the Services would be unlawful where you are.

The Services are not intended for consumers acting for purposes outside their trade or profession. Your own users — the people who accept your documents — are not parties to these Terms; your relationship with them is governed by your own documents.

## 2. What Stele does

Stele lets an organization publish versions of its documents (for example terms of service, privacy policies, offering terms or consent forms) and lets people accept a specific version by signing it. Stele records cryptographic evidence of both on the Solana blockchain, so that anyone can later check, without relying on Stele, which version was published and who accepted it.

The Services include, among others:

- Stele Proof: publishing document versions, recording acceptances and proofs, receipts in JSON and PDF, and public verification pages.
- Stele Gate: policies that name the version a protected action requires, passports and access passes that record a wallet's acceptance on-chain, and a library your own Solana program can use to refuse users who have not accepted the required version.
- Stele Verified: an automated check of your deployed Solana program, and a badge that shows the result.
- The dashboard, the API, the SDKs, webhooks, the relayer that pays network fees for recordings, passkey signing, the live demo and the AI assistant.

Parts of Stele are open-source software published under the Apache License 2.0, including the protocol library, the SDK and the independent verifier. Your use of that software is governed by its license; these Terms govern the hosted Services.

## 3. Networks: Devnet and Mainnet

Stele currently runs on Solana Devnet. Devnet is a public test network: tokens on it have no value, and its data may be erased or become unavailable at any time by its operators, not by Stele. Records made on Devnet are test records. They are not evidence of anything, and you must not rely on them for any real-world purpose.

When Stele becomes available on Solana Mainnet, records made there are intended to be durable evidence. We will say clearly in the Services which network you are using. These Terms apply on every network.

## 4. Your account, your keys

You sign in to the dashboard with a Solana wallet. Your organization exists on-chain and is controlled by the keys of its owner and members, not by Stele.

Stele is non-custodial. We never hold, see or control the private keys of your wallets, and we cannot sign on your behalf, recover lost keys, reverse transactions, or restore access to an organization whose keys are lost. If you configure a recovery key for your organization, keeping it safe is your responsibility.

You are responsible for everything done with your keys and your API keys, for keeping them secret, for the people you add as members of your organization and the roles you give them, and for revoking access that is no longer needed. Tell us promptly through the contact page if you believe your account or API keys have been compromised.

Passkeys that your users create to sign documents are kept by their devices and their passkey providers. Stele cannot recover a passkey that a user has lost.

## 5. The blockchain is public and permanent

When you publish a version or an acceptance is recorded, data is written to a public blockchain that Stele does not control. Anyone can read it, and no one — not you, not Stele — can modify or delete it.

What is written on-chain includes: your organization's name and on-chain addresses, the slug, type, title and version label of each document version, the fingerprints (cryptographic hashes) of its content, the address of the content, and for each acceptance the signer's public key or wallet address, the version accepted and the time.

The full text of the documents you publish is stored by Stele and is publicly available to anyone, so that acceptances can be verified. Publish only documents that are meant to be public. Never put personal data, confidential information or secrets in a document's text, title, version label or slug.

Network fees, rent and the availability of the Solana network are outside our control. A blockchain transaction may be delayed, fail or, once confirmed, be irreversible.

## 6. What a Stele record proves — and what it does not

A Stele acceptance record proves that the holder of a specific key signed a specific message that names a specific, unchanged version of a document, at or before a point in time established by the blockchain. A publication record proves that your organization's authorized key published that exact content as that version.

A Stele record does not, by itself, prove:

- who the person behind a key is, or that they are who they claim to be (unless you verify their identity yourself, for example by linking the signer to your own user account);
- that the person read or understood the document, had legal capacity, or acted freely;
- that the document is lawful, fair, enforceable or appropriate for its purpose;
- that an electronic acceptance satisfies the formal requirements of a given jurisdiction for a given kind of agreement.

Laws on electronic signatures and on the formation of contracts differ between countries and between kinds of agreements. Some agreements (for example wills, certain real-estate, family-law, employment or consumer contracts) may require other formalities. You alone decide whether Stele's evidence is sufficient for your purposes, and you should take legal advice where needed.

Stele does not provide legal advice. Templates, examples, documentation and answers from the AI assistant are not legal advice.

## 7. Your responsibilities toward your own users

You are solely responsible for:

- the content of the documents you publish, and for having the right to publish them;
- obtaining any consent, and having any legal basis, required to ask people to sign, to record their acceptance and to process their personal data — including the data described in Stele's Privacy Policy that is recorded when they accept;
- informing your users, in your own privacy notice, that their acceptance is recorded on a public blockchain and cannot be erased from it;
- the identifiers you link to acceptances (such as your own user IDs), which must not reveal personal data on their own;
- the way you present documents to your users and the decisions you make based on Stele records.

When your users accept your documents through Stele, you are the controller of their personal data and Stele processes it on your behalf, as described in the Privacy Policy.

## 8. Stele Gate and your programs

Stele Gate provides on-chain records (policies, passports, access passes) and a library that your Solana program can call. The protection is only as good as your program: it applies only if your program calls the check correctly, in every instruction that needs it, with the right policy, and only on the program code you actually deploy.

You are solely responsible for the design, security, testing, deployment and upgrades of your programs and for the assets they hold. Stele is not responsible for losses caused by your program, by a missing or incorrect check, by an upgrade, or by the behavior of wallets, RPC providers or other third parties.

## 9. Stele Verified

Stele Verified is an automated check. Stele simulates a call to your deployed program, as you describe it, in a small number of scenarios (for example: a wallet that never accepted is refused), and repeats it periodically and after upgrades we detect.

A "Verified" result means only that those simulations produced the expected outcome when they were run. It is not a security audit, does not cover other instructions or other code paths, and does not guarantee that your program is free of vulnerabilities or that it will behave the same way in the future. The badge may show "Verified" for a period after a change, until the next check runs.

You may display the Stele Verified badge only for programs you control, only on websites of your organization, and only as Stele provides it. You must not modify the badge, imitate it, or display it in a way that suggests a guarantee, an audit or an endorsement by Stele. Proving ownership of a program by signing with its upgrade authority is optional; if you do it, you confirm that you control that authority.

We may withdraw a badge, mark it as not verified or suspend verification if a check fails, if we believe the badge is misleading, or if you breach these Terms.

## 10. Fees and credits

Each organization receives a free allowance of recordings every calendar month, as shown on the pricing page. Beyond it, recordings use prepaid credits, which you buy in the dashboard by paying SOL to Stele's treasury address from your own wallet. Credits are added once the payment is found on-chain. Credits do not expire.

Payments are made on a public blockchain and are final. Except where the law requires otherwise, credits are not refundable and cannot be exchanged for money. Publishing documents and versions is paid directly by your wallet, at the network's cost.

We may change the free allowance, prices and credit packs for the future. Changes do not affect credits you already bought. You are responsible for any taxes that apply to your purchases.

If you enable fee sponsorship, your organization's shard reimburses the relayer for the recordings it sponsors, under the settings you choose.

## 11. Acceptable use

You must not use the Services to:

- publish content that is unlawful, fraudulent, deceptive, defamatory, infringing, hateful, or that exploits or harms minors;
- impersonate another person or organization, or claim a domain, name or program you do not control;
- collect signatures under false pretenses, phish, or mislead people about what they are signing;
- publish personal data, confidential information or secrets of anyone;
- send spam, or use the Services for unsolicited commercial communications;
- attack, probe, overload or interfere with the Services, the relayer or other users, or bypass rate limits, quotas or security measures;
- abuse the free allowance, the live demo or the relayer, for example by creating organizations or sessions to avoid paying;
- use the Services in breach of sanctions, export controls or anti-money-laundering laws;
- resell or provide the hosted Services to third parties as a competing service without our written agreement.

## 12. Your content and our rights

You keep all rights in the documents and other content you provide ("Your Content"). You grant Stele a worldwide, non-exclusive, royalty-free license to host, store, copy, process, transmit and publicly display Your Content as needed to provide the Services — including making published documents and their history publicly available for verification for as long as the records exist.

Because published content is anchored on-chain by its fingerprint, it remains publicly available for verification after you stop using the Services. You can ask us to stop serving a document's text from our servers when the law requires it; the on-chain records cannot be removed.

Stele, its logo, the Stele Verified badge, the website and the hosted Services are owned by Stele or its licensors. Apart from the open-source licenses mentioned in section 2 and the rights in these Terms, you receive no rights in them.

If you send us feedback or suggestions, we may use them without any obligation to you.

## 13. The AI assistant

The Services include an AI assistant that answers questions about Stele. It is provided by a third-party AI provider: what you type, and in the dashboard a summary of your organization's configuration (for example your documents, policies, programs and their verification status — never keys or secrets), is sent to that provider to produce an answer.

Answers are generated automatically and may be incomplete or wrong. Check them against the documentation before relying on them, especially for security, legal or financial decisions. Do not enter personal data, private keys, seed phrases, API keys or confidential information.

## 14. Third-party services

The Services depend on third parties that Stele does not control, including the Solana network and its validators, RPC providers, wallets and passkey providers, hosting providers and the AI provider. Your use of them may be subject to their own terms. Stele is not responsible for their availability or behavior.

## 15. Availability and changes to the Services

We work to keep the Services available and secure, but we do not promise that they will be uninterrupted, error-free or available in every country. We may change, add or remove features. If we discontinue a paid part of the Services, we will give reasonable notice where possible.

Stele is designed so that your evidence does not depend on us: published versions and acceptances can be verified against the blockchain with the open-source verifier and the receipts you keep, even if Stele's servers are unavailable.

## 16. Suspension and termination

You may stop using the Services at any time.

We may suspend or end your access to the Services, or to part of them, if you breach these Terms, if your use creates a risk for the Services, for other users or for us, if we are required to by law, or if your account has been inactive for a long period. Where reasonable, we will tell you in advance and give you a chance to fix the problem.

Suspension or termination does not delete on-chain records, and it does not prevent anyone from verifying them. Sections 5, 6, 7, 8, 9, 12, 17, 18 and 20 continue to apply after termination.

## 17. Disclaimers

To the extent permitted by law, the Services are provided "as is" and "as available". Stele makes no warranties, express or implied, including warranties of merchantability, fitness for a particular purpose, title and non-infringement, and no warranty that records will be accepted as evidence by any court or authority.

Some jurisdictions do not allow certain warranties to be excluded; in those jurisdictions, these exclusions apply only to the extent permitted.

## 18. Indemnity

You will defend and indemnify Stele against claims by third parties — including your users — and related losses and reasonable costs, to the extent they arise from Your Content, your documents and your relationship with your users, your programs, or your breach of these Terms or of the law.

## 19. Changes to these Terms

We may update these Terms. Each new version is published with Stele: its text, version and publication time are recorded on-chain, and anyone can compare it with earlier versions.

We will tell you about material changes in the dashboard before they take effect. When a new version requires your acceptance, the dashboard asks you to sign it; if you do not accept it, you may stop using the Services. Changes do not apply retroactively.

## 20. Governing law and disputes

These Terms are governed by the laws of [GOVERNING LAW — to be completed before the Mainnet launch], without regard to its conflict-of-laws rules. Any dispute arising out of or in connection with these Terms or the Services will be resolved by the competent courts of [VENUE — to be completed before the Mainnet launch], unless mandatory law gives you the right to bring proceedings elsewhere.

Before starting proceedings, each party will first try to resolve the dispute in good faith by contacting the other and allowing thirty days for a solution.

## 21. General

These Terms, together with the Privacy Policy and any order or agreement we sign with you, are the entire agreement between you and Stele about the Services. If a provision is found unenforceable, the rest remains in effect. If we do not enforce a provision, we do not waive it.

You may not transfer your rights under these Terms without our consent. We may transfer them to a successor of the Services, and we will tell you if we do.

Neither party is liable for delays or failures caused by events beyond its reasonable control, including failures of the Solana network.

These Terms are written in English. Translations are provided for convenience; the English version prevails.

## 22. Contact

Questions about these Terms, notices and requests: use the contact form at stele.site/contact.
