# Stele: პროექტის სრული აღწერა

> შიდა დოკუმენტი (ქართულად). ვებსაიტზე არ ქვეყნდება. აქ ერთ ადგილას წერია, რა არის Stele, რისგან
> შედგება, როგორ გაუშვა, როგორ გატესტო და რა რჩება production-მდე.
> მდგომარეობა: 2026 წლის 4 ოქტომბერი.

## სარჩევი

1. [რა არის Stele](#1-რა-არის-stele)
2. [როგორ მუშაობს, მარტივად](#2-როგორ-მუშაობს-მარტივად)
3. [რისგან შედგება](#3-რისგან-შედგება)
4. [რეპოზიტორიის სტრუქტურა](#4-რეპოზიტორიის-სტრუქტურა)
5. [ტექნოლოგიები](#5-ტექნოლოგიები)
6. [უსაფრთხოების გარანტიები](#6-უსაფრთხოების-გარანტიები)
7. [ლოკალური გაშვება](#7-ლოკალური-გაშვება)
8. [ხელით ტესტირება](#8-ხელით-ტესტირება)
9. [ავტომატური ტესტები და შემოწმებები](#9-ავტომატური-ტესტები-და-შემოწმებები)
10. [ქსელები: Localnet, Devnet, Testnet, Mainnet](#10-ქსელები-localnet-devnet-testnet-mainnet)
11. [დოკუმენტაცია](#11-დოკუმენტაცია)
12. [Production-მდე დარჩენილი ნაბიჯები](#12-production-მდე-დარჩენილი-ნაბიჯები)
13. [შეზღუდვები და გასათვალისწინებელი](#13-შეზღუდვები-და-გასათვალისწინებელი)
14. [ხშირი პრობლემები და გადაწყვეტა](#14-ხშირი-პრობლემები-და-გადაწყვეტა)
15. [სასარგებლო მისამართები](#15-სასარგებლო-მისამართები)
16. [საფულის გარეშე ხელმოწერა, საკომისიოს სპონსორობა და proof-ები](#16-საფულის-გარეშე-ხელმოწერა-საკომისიოს-სპონსორობა-და-proof-ები)
17. [Devnet და შემოსავალი (კრედიტები)](#17-devnet-და-შემოსავალი-კრედიტები)

---

## 1. რა არის Stele

**Stele არის პლატფორმა, რომელიც წესებს და პირობებს (Terms of Service), კონფიდენციალურობის
პოლიტიკას და ხელშეკრულებებს Solana-ზე დამოწმებულ მტკიცებულებად აქცევს.**

ჩვეულებრივ "I agree" ჩანაწერი კომპანიის საკუთარ ბაზაშია. კომპანიას შეუძლია ტექსტი შეცვალოს, ძველი
ვერსია დამალოს ან ჩანაწერი გადააკეთოს, და ამას გარედან ვერავინ შეამოწმებს. Stele-ში:

- გამოქვეყნებული ვერსია **სამუდამოა**: ვერც კომპანია შეცვლის და ვერც Stele;
- მომხმარებელი თანხმობას **საკუთარი საფულით აწერს ხელს**, ზუსტად იმ ვერსიაზე, რაც წაიკითხა;
- **ნებისმიერს შეუძლია შემოწმება** პირდაპირ Solana-ზე, Stele-სა და კომპანიაზე დამოკიდებულების გარეშე.

სლოგანი: **"Don't trust the website. Verify the evidence."**

რას **არ** ამტკიცებს: ხელმოწერა ამტკიცებს, რომ კონკრეტულმა **საფულის გასაღებმა** მიიღო კონკრეტული
ვერსია. ის არ ამტკიცებს, ვინ ფლობს გასაღებს (ადამიანის იდენტობას). ხელშეკრულების იურიდიული ძალა
კანონზე და გარემოებებზეა დამოკიდებული. Stele იურიდიულ რჩევას არ იძლევა.

## 2. როგორ მუშაობს, მარტივად

ეს ნაწილი ანიმაციის სახით საიტზეცაა: **`/how-it-works`**.

1. **კომპანია წერს Terms-ს** Stele-ს Dashboard-ში.
2. **Fingerprint.** Stele ტექსტს ზუსტ ბაიტებად აქცევს (canonicalization) და SHA-256-ით ითვლის მის
   ანაბეჭდს. ერთი მძიმის შეცვლაც კი სულ სხვა fingerprint-ს იძლევა.
3. **დალუქვა Solana-ზე.** კომპანია საფულით ადასტურებს და Stele-ს პროგრამა ვერსიას Solana-ზე წერს.
   ეს ვერსია შემდეგ შეუცვლელია. ცვლილება ნიშნავს ახალ ვერსიას, რომელიც წინაზე ებმის (ჯაჭვი).
4. **მომხმარებელი ხსნის საიტს.** ვიჯეტი ტექსტს აჩვენებს მხოლოდ მას შემდეგ, რაც შეამოწმებს, რომ ის
   Solana-ზე დალუქულ fingerprint-ს ემთხვევა.
5. **ხელმოწერა.** მომხმარებელი მონიშნავს "I agree"-ს, საფულე კი აჩვენებს მოკლე შეტყობინებას: ვინ,
   რომელი დოკუმენტი, რომელი ვერსია, რომელი საიტი. ერთი დაჭერით ადასტურებს. ეს უფასოა და ფულს არ
   გადარიცხავს.
6. **ჩაწერა.** Stele (relayer) ხელმოწერას Solana-ზე აგზავნის და საკომისიოს თავად იხდის. პროგრამა
   ამოწმებს ხელმოწერას და თანხმობას **ერთხელ** წერს (nonce-ით, ანუ განმეორება შეუძლებელია).
7. **დადასტურება.** მომხმარებელი იღებს ქვითარს (receipt). კომპანიის სერვერი იღებს ხელმოწერილ
   webhook-ს და შეუძლია ჰკითხოს: "ამ მომხმარებელმა მიიღო მიმდინარე ვერსია?"
8. **შემოწმება ნებისმიერ დროს.** ქვითრით ან ტრანზაქციით ნებისმიერს (სასამართლოს, აუდიტორს)
   შეუძლია ყველაფრის შემოწმება Solana-ზე. შედეგი: `VALID`, `VALID_WITH_WARNINGS`, `INVALID` ან
   `INCONCLUSIVE`.
9. **ახალი ვერსია.** როცა Terms იცვლება, ძველი ვერსია ისტორიაში რჩება, მომხმარებლებს კი ახლის
   მიღებას თავიდან სთხოვენ.

## 3. რისგან შედგება

| ნაწილი | სად არის | რას აკეთებს |
|---|---|---|
| **Solana პროგრამა** | `programs/stele` (Anchor) | ორგანიზაციები, როლები, multisig, recovery, freeze, დომენები, შეუცვლელი ვერსიები, თანხმობების on-chain შემოწმება |
| **Rust ბიბლიოთეკები** | `crates/stele-core`, `crates/stele-canonical` | საერთო ლოგიკა: შეტყობინებები, fingerprint-ები, canonicalization |
| **`@stele/protocol`** | `packages/protocol` | იგივე ლოგიკა TypeScript-ზე (codecs, ინსტრუქციები, ანგარიშები) |
| **`@stele/verifier`** | `packages/verifier` | დამოუკიდებელი ვერიფიკატორი: ბიბლიოთეკა და `stele-verify` CLI |
| **`@stele/sdk`** | `packages/sdk` | ჩასაშენებელი ვიჯეტი (`stele.js`), `mount()`, React კომპონენტი, სერვერის client, webhook-ის შემოწმება |
| **API** | `apps/api` (Fastify) | საფულით შესვლა, ორგანიზაციები, დოკუმენტები, relayer, DNS-ით დომენის დადასტურება, API key-ები, webhook-ები, audit log, ინდექსერი |
| **ვებ-აპლიკაცია** | `apps/web` (Next.js) | მარკეტინგული საიტი, დოკუმენტაცია, Dashboard, თანხმობის hosted გვერდი, ქვითრები, ვერიფიკატორი, ქსელის გადამრთველი, ანიმაციური ახსნა |
| **დიზაინ-სისტემა** | `packages/ui` | ფერები, კომპონენტები, ლოგო |
| **ბაზა** | `packages/db` (Drizzle) | სქემა და migration-ები (PostgreSQL; ლოკალურად PGlite) |
| **Demo მაღაზია** | `examples/demo-shop` | **Northwind Shop**: სრული ინტეგრაციის მაგალითი |
| **HTML მაგალითი** | `examples/local-widget` | ვიჯეტი ჩვეულებრივ HTML გვერდზე |
| **ლოკალური ხელსაწყოები** | `tools/localnet`, `tools/ops` | გასაღებები, `.env`, seed, demo-ს აწყობა, დომენის ლოკალური დადასტურება, პროტოკოლის ინიციალიზაცია |

### Dashboard-ის შესაძლებლობები

- **Overview:** სტატისტიკა და გრაფიკი (თანხმობები დღეების მიხედვით).
- **Documents:** დოკუმენტის შექმნა, draft-ი, canonical preview, fingerprint, გამოქვეყნება საფულით,
  ვერსიების ისტორია, ვერსიების შედარება (diff), ჩასაშენებელი კოდი (HTML / React / Server) **ნამდვილი
  მნიშვნელობებით**.
- **Acceptances:** ყველა თანხმობა.
- **Organization:** პროფილი, დომენის დადასტურება (DNS TXT), acceptance capacity (shards), acceptance
  policy (Allowed requesting sites, Require acceptance sessions).
- **Team:** წევრები და როლები (owner, admin, publisher).
- **API keys:** შექმნა (ჩანს ერთხელ), scope-ები, ვადა, გაუქმება. მზა `.env` ხაზი.
- **Integrations:** webhook endpoint-ები, secret, test, მიწოდების ლოგი. მზა `.env` ხაზი.
- **Signing & fees:** ხელმოწერის წესი (Wallet only / Passkey only / Wallet or Passkey / Account +
  Passkey), ვინ იხდის საკომისიოს (Stele ან ორგანიზაცია), sponsored shard-ის ბალანსი, deposit
  მისამართი, ლიმიტები, pause, withdraw, საკომისიოების ისტორია, passkey signer-ების სია.
- **Security, Audit log:** ჰეშ-ჯაჭვით დაცული audit log და მისი შემოწმება.

### დეველოპერისთვის ინტეგრაცია (უმარტივესი)

```html
<div data-stele-organization="acme.com" data-stele-document="terms-of-service"></div>
<script src="https://<stele-app>/sdk/v1/stele.js" defer></script>
```

ეს ორი ხაზი საკმარისია. დანარჩენი (session-ები, `hasAcceptedLatest`, webhook-ები, React) აღწერილია
`docs/get-started.md`-სა და `docs/api.md`-ში.

## 4. რეპოზიტორიის სტრუქტურა

```
programs/stele/         Solana პროგრამა (Anchor) და მისი ტესტები (LiteSVM)
crates/                 stele-core, stele-canonical (Rust)
packages/protocol       @stele/protocol
packages/verifier       @stele/verifier + stele-verify CLI
packages/sdk            @stele/sdk (ვიჯეტი, React, server)
packages/db             ბაზის სქემა და migration-ები
packages/ui             დიზაინ-სისტემა
apps/api                REST API, relayer, workers, ინდექსერი
apps/web                Next.js საიტი და Dashboard
examples/demo-shop      Northwind Shop (სრული demo)
examples/local-widget   ვიჯეტი უბრალო HTML-ში
tools/localnet          ლოკალური გასაღებები, .env, seed, demo, attest-domain
tools/ops               ოპერატორის ხელსაწყოები (init-protocol)
tests/integration       SDK ↔ API ↔ ვალიდატორი
tests/e2e               Playwright ბრაუზერის ტესტები
tests/programs          სატესტო Solana პროგრამა (CPI probe)
spec/test-vectors       საერთო სატესტო ვექტორები (Rust ↔ TypeScript)
infra/                  Dockerfile-ები და docker-compose
docs/                   დოკუმენტაცია (საჯარო და შიდა)
scripts/                WSL-ის და ლოკალური ვალიდატორის სკრიპტები
```

## 5. ტექნოლოგიები

| სფერო | არჩევანი |
|---|---|
| ბლოკჩეინი | Solana; Anchor 1.2, Agave 3.1.10 |
| კრიპტოგრაფია | SHA-256, Ed25519 (on-chain Ed25519 precompile; off-chain `@noble/curves`) |
| Backend | Node.js 24, Fastify 5, Drizzle ORM, PostgreSQL (ლოკალურად PGlite) |
| Frontend | Next.js 16, React 19, Tailwind v4, Wallet Standard (Phantom, Solflare, Backpack…) |
| SDK | `@solana/kit`, `@wallet-standard/app`, shadow DOM ვიჯეტი |
| ტესტები | Rust + LiteSVM, Vitest, Playwright |
| Build | pnpm 12.8 workspaces, Turborepo, tsup |
| ლიცენზია | Apache 2.0 |

## 6. უსაფრთხოების გარანტიები

- **შეუცვლელობა:** გამოქვეყნებული ვერსიისთვის Solana-ზე არ არსებობს ცვლილების ან წაშლის ინსტრუქცია.
- **ზუსტი ტექსტი:** fingerprint-ს Solana-ს პროგრამა თავად ითვლის; ვიჯეტი ტექსტს მხოლოდ ჰეშის
  დამთხვევის შემდეგ აჩვენებს.
- **ზუსტად ის, რაც ნახა:** ხელმოსაწერ შეტყობინებას SDK და პროგრამა Solana-ს მონაცემებიდან თავად
  აწყობენ; სერვერის მიერ მოწოდებულ ერთ ბაიტზე განსხვავებაზეც კი ხელმოწერა იბლოკება.
- **გაყალბება შეუძლებელია:** Ed25519 ხელმოწერას პროგრამა თავად ამოწმებს (instruction
  introspection, CPI-ის აკრძალვით და sysvar-ის შემოწმებით).
- **განმეორება შეუძლებელია:** ერთჯერადი nonce, მოქმედების ვადა და ქსელზე მიბმა.
- **საიტზე მიბმა:** "Requested by: <საიტი>" ბრაუზერის `Origin`-იდან ივსება; Allowed requesting sites
  მხოლოდ შენს დომენებს უშვებს.
- **ბაზა მტკიცებულება არ არის:** API-სა და ბაზის გატეხვაც ვერ გააყალბებს მტკიცებულებას, რომელიც
  ვერიფიკატორს გაივლის.
- **API key-ები** მხოლოდ სერვერზე ინახება, ჰეშის სახით; **webhook-ები** HMAC-ითაა ხელმოწერილი და
  replay-ისგან დაცული.
- **ვებ-უსაფრთხოება:** მკაცრი CSP nonce-ით, CSRF დაცვა, step-up (ხელახალი ხელმოწერა) მგრძნობიარე
  მოქმედებებზე, rate limiting, SSRF დაცვა.
- **პირადი მონაცემები Solana-ზე არ იწერება:** მხოლოდ public key-ები, ჰეშები, დრო და hostname-ები.

დეტალურად: `docs/security.md`, `docs/threat-model.md` (საჯარო) და `SECURITY_THREAT_MODEL.md` (სრული,
შიდა; 104 სცენარი).

## 7. ლოკალური გაშვება

**საჭიროა:** Windows-ზე WSL 2 (Ubuntu) Rust-ითა და Agave-ით, Node.js 24, pnpm 12.8.

```shell
# 1. დამოკიდებულებები
pnpm install

# 2. პროგრამის აგება (WSL-ში; scripts/dev რეპოზიტორიას Linux-ის საქაღალდეში ასინქრონებს)
wsl -d Ubuntu -- bash scripts/dev/wsl-run.sh "bash scripts/dev/build-program.sh"

# 3. სატესტო გასაღებები ("admin" ამ სიაშია)
pnpm localnet:keys

# 4. ლოკალური ვალიდატორი (ცალკე ფანჯარაში; ~4 საათის ისტორიით)
wsl -d Ubuntu -- bash scripts/dev/wsl-run.sh "STELE_LEDGER_SHREDS=4000000 bash scripts/localnet/validator.sh <ADMIN_PUBKEY>"

# 5. .env და სადემონსტრაციო მონაცემები (Acme Inc., acme.example)
pnpm localnet:env
pnpm localnet:seed

# 6a. Development რეჟიმი
pnpm dev:api        # http://127.0.0.1:4000
pnpm dev:web        # http://localhost:3000

# 6b. ან production build-ები
pnpm build
pnpm --filter @stele/api start
PORT=3000 HOSTNAME=localhost PUBLIC_RPC_URLS=http://127.0.0.1:8899 \
  STELE_NETWORKS="localnet=http://localhost:3000,devnet=,testnet=,mainnet=" \
  pnpm --filter @stele/web start

# 7. Demo მაღაზია (Northwind Shop); --member-ით შენი საფულე Dashboard-შიც დაინახავს მას
pnpm localnet:demo -- --member <შენი საფულის მისამართი>
pnpm demo:shop      # http://localhost:4300
```

**ფრთხილად:** ვალიდატორი ძველ ისტორიას შლის (დაახლოებით 4 საათის შემდეგ). თუ ტესტები
`INCONCLUSIVE`-ს ან "not found"-ს აჩვენებს, ვალიდატორი თავიდან გაუშვი (`--reset` ავტომატურია) და
`pnpm localnet:seed` ხელახლა გაუშვი. ამით ლოკალური ჯაჭვი სუფთავდება, ამიტომ ორგანიზაციები თავიდან
უნდა შეიქმნას (და `pnpm localnet:demo` ხელახლა).

## 8. ხელით ტესტირება

### საფულის მომზადება
- Phantom: **Settings → Developer Settings → Testnet Mode → Localnet** (`http://127.0.0.1:8899`).
- Dashboard-ში ორგანიზაციის შესაქმნელად საფულეს ლოკალური SOL სჭირდება; შექმნის გვერდზე
  **Request test SOL** ღილაკია. თანხმობის ხელმოწერას SOL არ სჭირდება.

### Dashboard (http://localhost:3000/dashboard)
1. საფულით შესვლა → **Create organization**.
2. **Documents → New document** → slug, მაგალითად `terms-of-service` → **Create on Solana** → ტექსტი →
   **Create draft** → **Sign & publish**.
3. დომენი: ნამდვილი დომენისთვის DNS TXT ჩანაწერი (`_stele.<domain>` → `stele-org=<org address>`) →
   **Check DNS & attest**. ლოკალურად, DNS-ის გარეშე:
   `pnpm localnet:attest-domain <org address> mycompany.test`
4. **API keys**, **Integrations** (webhook), **Team**, **Audit log**.

### თანხმობა
- Hosted გვერდი: `http://localhost:3000/accept/acme.example/terms-of-service`
- საკუთარი HTML: `npx serve -l 8080 examples/local-widget` → `http://localhost:8080` (`file://` არ
  მუშაობს, რადგან საფულე იქ არ ირთვება).

### Northwind Shop (http://localhost:4300)
1 Terms (საფულით **ან passkey-ით**) → 2 Privacy → 3 Checkout (თანხმობამდე 403; შემდეგ შეკვეთას
ადასტურებ ხელმოწერილი **PURCHASE proof**-ით) → 4 My acceptances (ქვითრები და დამოუკიდებელი
ვერიფიკაცია) → 5 Security (passkey-ები, recovery kit, reset) → 6 Webhooks → 7 API log. Northwind-ში
საკომისიოს **ორგანიზაცია იხდის** (sponsored shard, 0.5 SOL), ასე რომ ხედავ "the organization
sponsored the network fee". შემდეგ Dashboard-ში Northwind Shop-ისთვის ახალი Terms ვერსია
გამოაქვეყნე: მაღაზია თანხმობას თავიდან მოითხოვს.

### ვერიფიკაცია
- ბრაუზერში: `http://localhost:3000/verify` (ტრანზაქცია, acceptance ID ან ქვითარი).
- ბრძანებით: `stele-verify --rpc http://127.0.0.1:8899 --tx <signature>`.

## 9. ავტომატური ტესტები და შემოწმებები

| ბრძანება | რას ამოწმებს | ბოლო შედეგი |
|---|---|---|
| `bash scripts/dev/test-program.sh` (WSL) | Rust: პროგრამა, თავდასხმის სცენარები, ვექტორები, sponsorship, proofs | 120/120 |
| `pnpm test` | unit + localnet ტესტები (protocol 50, API 39, verifier 9, SDK 2, DB 2) | 102/102 |
| `pnpm test:integration` | SDK ↔ API ↔ ვალიდატორი (proof-ების გაყალბების სცენარებითაც) | 6/6 |
| `pnpm test:e2e` (`E2E_PRODUCTION=1` production build-ებზე) | ბრაუზერის სცენარები, virtual passkey (PRF)-ით | 45/45 |
| `pnpm localnet:costs` | რეალური საკომისიოები Solana-ს ტრანზაქციებიდან | ცხრილი |
| `pnpm lint`, `pnpm typecheck`, `pnpm format:check` | სტატიკური შემოწმებები | სუფთა |

CI (`.github/workflows/ci.yml`) ყველაფერს ავტომატურად უშვებს, მათ შორის Rust-ს (`--locked`),
localnet-ს, E2E-ს production build-ებზე, `pnpm audit`-ს, `cargo audit`-სა და secret scan-ს.

## 10. ქსელები: Localnet, Devnet, Testnet, Mainnet

- **ყოველი ქსელი ცალკე deployment-ია:** თავისი API, ბაზა, relayer-ისა და attestor-ის გასაღებები და
  მისამართი (მაგალითად `app.stele.com` და `devnet.app.stele.com`). ქსელები ერთმანეთში არ ირევა.
- საიტზე **ქსელის გადამრთველია** (header და Dashboard-ის sidebar), სატესტო ქსელზე კი ყველა გვერდზე
  ჩანს გამაფრთხილებელი ზოლი.
- სია ერთი ცვლადით იმართება:
  `STELE_NETWORKS=mainnet=https://app.stele.com,devnet=https://devnet.app.stele.com,testnet=https://testnet.app.stele.com`
- **Testnet-ის მოშორება production-ში:** წაშალე `testnet=…` ამ ცვლადიდან. კოდის ცვლილება არ არის საჭირო.
- **ახლა მხოლოდ Localnet მუშაობს.** Devnet და Mainnet ჯერ გაშვებული არ არის.

## 11. დოკუმენტაცია

**საჯარო** (საიტზე, `/docs`; კატალოგი `apps/web/src/lib/docs.ts`-შია):
Product overview, How Stele works, **Get started**, **SDK & API**, Verification, What a signature
proves, Protocol overview და specification, Canonicalization, Organizations & authority, Content
storage, Security architecture, Threat model, Security policy.

**შიდა** (მხოლოდ რეპოზიტორიაში, საიტზე არასოდეს ქვეყნდება):
`docs/deployment.md` (deployment, საიდუმლოები, მონიტორინგი, recovery, runbook-ები, mainnet checklist),
`ARCHITECTURE.md`, `docs/architecture.md`, `SECURITY_THREAT_MODEL.md` და ეს ფაილი.

დოკუმენტაციის კოდის მაგალითები `packages/sdk/test/docs-examples.tsx`-ში type-check-დება, ამიტომ SDK-ს
შეცვლისას მოძველებული მაგალითი typecheck-ს ჩააგდებს.

**მაგალითები 8 ენაზე.** Get started, SDK & API და Developers გვერდებზე სერვერის კოდი არის cURL, Node.js,
Python, Java, Go, PHP, Ruby და C#-ზე, ტაბებით. ერთხელ არჩეული ენა ყველა მაგალითზე და ყველა გვერდზე
მოქმედებს და ბრაუზერს ახსოვს. Markdown-ში ეს უბრალოდ ზედიზედ დაწერილი code block-ებია
`tab=Python`-ის მსგავსი ჭდით (GitHub-ზეც კარგად იკითხება). `https://app.stele.example` საიტზე ავტომატურად
იცვლება ამ აპის ნამდვილი მისამართით (deployment-ში `APP_ORIGIN`-დან; request-ის header-ს მხოლოდ localhost-ზე ენდობა), ხოლო
`<!-- stele:networks -->` ყველა ქსელის Base URL-ის ცხრილად იქცევა. 2026-10-04-ს ყველა ენის ყველა
მაგალითი (97) ლოკალურ API-ზე რეალურად გაეშვა; signer-ის გაუქმება mock-სერვერზე, webhook handler-ები
კი სწორი, შეცვლილი, ვადაგასული და ხელმოუწერელი მიწოდებებით შემოწმდა.

## 12. Production-მდე დარჩენილი ნაბიჯები

ყველა ქვემოთ ჩამოთვლილი შენს გადაწყვეტილებას ან გასაღებებს საჭიროებს:

1. **Git commit:** კოდი ჯერ დაკომიტებული არ არის.
2. **Devnet deployment:** პროგრამის Devnet-ზე განთავსება, ცალკე API, ბაზა და გასაღებები, დომენი
   (მაგალითად `devnet.app.stele.com`) და `STELE_NETWORKS`-ის განახლება.
3. **npm publish:** `@stele/protocol`, `@stele/verifier` და `@stele/sdk` (შენი npm ორგანიზაციით).
   მანამდე დოკუმენტაციაში მოცემული `npm install @stele/sdk` არ იმუშავებს; script tag-ი კი მუშაობს.
4. **დამოუკიდებელი security audit:** პროგრამისა და პროტოკოლის.
5. **Mainnet:** რეპროდუცირებადი build (`solana-verify`), upgrade authority და protocol admin
   multisig-ზე (Squads), relayer-ისა და attestor-ის გასაღებები secret manager-ში, ორი დამოუკიდებელი
   RPC პროვაიდერი, PostgreSQL TLS-ით და backup-ით, S3 object-lock-ით, მონიტორინგი. სრული სია:
   `docs/deployment.md` → Mainnet checklist.

## 13. შეზღუდვები და გასათვალისწინებელი

- დოკუმენტები ამჟამად მხოლოდ ტექსტურია (attachment-ები protocol-ში არის, მაგრამ UI და API მათ ჯერ არ
  იყენებს).
- ხელმოწერა საფულით ხდება (Wallet Standard). ზოგი hardware wallet `signMessage`-ს არ უჭერს მხარს.
- ძველი ტრანზაქციების ისტორია archival RPC-ზეა დამოკიდებული (ან ქვითარზე, რომელიც ტექსტს შეიცავს).
- გასაღები ≠ ადამიანი. მომხმარებელთან კავშირისთვის session-ები გამოიყენე (`externalUserRef`).
- Demo-ს შესვლა (Northwind Shop) სატესტოა: ნებისმიერი სახელი, პაროლის გარეშე.

## 14. ხშირი პრობლემები და გადაწყვეტა

| პრობლემა | გადაწყვეტა |
|---|---|
| Phantom: "chain ID does not match" | საფულე Localnet-ზე (ან საიტის ქსელზე) გადართე |
| Phantom: "Unexpected error" | Phantom-ის გახსნა და განბლოკვა, საჭიროების შემთხვევაში extension-ის გამორთვა და ჩართვა, გვერდის refresh |
| "No compatible wallet was found" | დააყენე Solana-ს საფულე, რომელიც ქსელს უჭერს მხარს |
| ვიჯეტი არ ჩანს | გვერდი `file://`-ით გაიხსნა, ან CSP ბლოკავს; გამოიყენე `http://localhost` |
| "This organization does not accept signing requests from …" | Organization → Acceptance policy → Allowed requesting sites |
| ვერიფიკაცია `INCONCLUSIVE` | ლოკალურ ვალიდატორს ისტორია წაეშალა: თავიდან გაუშვი და დასიდე |
| დომენი არ დადასტურდა | TXT ჩანაწერს გავრცელებას დრო სჭირდება; ლოკალურად გამოიყენე `pnpm localnet:attest-domain` |
| დისკი ივსება | WSL ledger-ი იზრდება: `STELE_LEDGER_SHREDS`-ის ზღვარი და `docs/deployment.md`-ის compact ინსტრუქცია |
| Windows-ზე standalone build-ის EPERM | build-ის სკრიპტი symlink-ებს ავტომატურად junction-ად აქცევს (`prepare-standalone.mjs`) |

## 15. სასარგებლო მისამართები

| | |
|---|---|
| საიტი | http://localhost:3000 |
| ანიმაციური ახსნა | http://localhost:3000/how-it-works |
| დოკუმენტაცია | http://localhost:3000/docs (Get started: `/docs/get-started`) |
| დეველოპერები | http://localhost:3000/developers |
| Dashboard | http://localhost:3000/dashboard |
| ვერიფიკატორი | http://localhost:3000/verify |
| თანხმობის გვერდი (demo) | http://localhost:3000/accept/acme.example/terms-of-service |
| API | http://127.0.0.1:4000 (საიტიდან `/api`) |
| ლოკალური ვალიდატორი | http://127.0.0.1:8899 |
| Northwind Shop | http://localhost:4300 |

## 16. საფულის გარეშე ხელმოწერა, საკომისიოს სპონსორობა და proof-ები

### Passkey-ით ხელმოწერა (საფულე არ სჭირდება)

- მომხმარებელი ირჩევს **Create a passkey**-ს (Face ID, თითის ანაბეჭდი, Windows Hello, ტელეფონი ან
  security key). ბრაუზერი ქმნის Ed25519 გასაღებს და შიფრავს მას (AES-256-GCM) passkey-ის **PRF**
  საიდუმლოთი. Stele-ს მხოლოდ დაშიფრული გასაღები აქვს: მას და ორგანიზაციას მომხმარებლის მაგივრად
  ხელმოწერა **არ შეუძლიათ**.
- ყოველ ხელმოწერაზე ერთი passkey-ის დადასტურება (user verification) ზუსტად ამ შეტყობინებას
  ადასტურებს და გასაღებს მხოლოდ ამ ერთი ხელმოწერისთვის ხსნის. Stele ჩაწერაზე უარს ამბობს, თუ
  passkey-მ ზუსტად ეს შეტყობინება არ დაადასტურა.
- Solana-ზე არაფერი იცვლება: იგივე Ed25519 ხელმოწერა, იგივე შეტყობინება (`stele/1`). ქვითარში
  დამატებით არის passkey-ის მტკიცებულება (`PASSKEY_PROTECTED_STELE_KEY`), რომელსაც ვერიფიკატორი
  ხელახლა ამოწმებს.
- **PRF-ის გარეშე** (ძველი ბრაუზერი) passkey-ით ხელმოწერა არ ხდება — სთავაზობს საფულეს. სერვერზე
  შენახული "სათადარიგო" გასაღები არ არსებობს.
- **Recovery kit** (`stele-rk1-…`) ერთხელ ჩანს; მოწყობილობის დაკარგვისას იგივე გასაღებს აღადგენს.
  თუ ყველაფერი დაიკარგა, ორგანიზაცია მხოლოდ **ახალ** გასაღებს ანიჭებს (ჩაიწერება როგორც
  `account_authorized`), ძველი გასაღები არასდროს "აღდგება", ძველი ხელმოწერები კი ძალაში რჩება.

### საკომისიო: მომხმარებელი არასდროს იხდის

- ყველა ჩაწერას Stele-ს relayer აგზავნის და იხდის. ორი რეჟიმი: **Stele იხდის** (თვიური ლიმიტი) ან
  **ორგანიზაცია იხდის**: ორგანიზაცია nonce shard-ზე რთავს sponsorship-ს და იქ SOL-ს დებს (shard-ის
  მისამართი = deposit მისამართი; პირადი გასაღები არ არსებობს). პროგრამა თავად უბრუნებს relayer-ს
  ზუსტ საკომისიოს, ლიმიტების ფარგლებში; თანხის გატანა მხოლოდ owner-ს შეუძლია.
- ცალკე "vault" ანგარიში თავიდან ავაშენეთ, მაგრამ worst-case ტრანზაქცია 1,259 ბაიტი გახდა (ლიმიტი
  1,232). ამიტომ sponsorship shard-ზე გადავიტანეთ: ტრანზაქცია არ იზრდება.
- გაზომილი ხარჯი (localnet): ერთი ჩაწერა = **10,000 lamports = 0.00001 SOL** → ~100,000 ჩაწერა 1
  SOL-ზე; საფულით და passkey-ით ერთნაირია. ბრძანება: `pnpm localnet:costs`.

### Proof-ები (შეძენა, დაბრუნება, თანხმობა…)

- ორგანიზაციის სერვერი ქმნის **proof request**-ს (მაგ. `PURCHASE`: ნივთები, თანხები, შეკვეთის
  ნომერი). მომხმარებელი ხედავს შეკვეთას და ადასტურებს ხელმოწერით. Solana-ზე მხოლოდ statement-ის
  (salt-იანი) **ჰეში** იწერება; დეტალები კერძოა და ინახება `stele-proof-v1` ქვითარში.
- 17 ტიპი: PURCHASE, SALE, ORDER, PAYMENT, RECEIPT, INVOICE, REFUND, CANCELLATION, DELIVERY, RETURN,
  WARRANTY, SUBSCRIPTION_START, SUBSCRIPTION_CANCEL, QUOTE_ACCEPTANCE, CONTRACT, CONSENT,
  POLICY_ACCEPTANCE.
- ვიჯეტი შეკვეთას მხოლოდ მაშინ აჩვენებს, თუ მისი ჰეში ემთხვევა იმას, რასაც მომხმარებელი ხელს აწერს;
  `/verify`-ზე ქვითრის ატვირთვისას ერთი თანხის შეცვლაც კი `INVALID`-ს იძლევა.

### სად არის

- სპეციფიკაცია: `PROTOCOL_SPEC.md` §12–§14; უსაფრთხოება: `SECURITY_THREAT_MODEL.md` §6 (W01–W20 და
  20 ინვარიანტის ცხრილი ტესტებით); დიზაინი: `docs/design-walletless-sponsorship-proofs.md`.
- კოდი: `programs/stele/src/instructions/{proof,sponsor}.rs`, `packages/protocol/src/{proof,statement,webauthn,keywrap,fees}.ts`,
  `apps/api/src/services/{signers,proofs,sponsorship}.ts`, `packages/sdk/src/{passkey,proofs,receipts}.ts`,
  `apps/web/src/app/dashboard/signing`, `apps/web/src/app/confirm`.

## 17. Devnet და შემოსავალი (კრედიტები)

### Devnet (2026-10-04)

- პროგრამა: `6sTKscWmUtBQRMpNCiEpurCJxpjx7GK5rzk7e265kpwV` (SHA-256 `824c8f39…`), deploy-ის ტრანზაქცია
  `5BmpwCsQ…`. Protocol ინიციალიზებულია: config `48Tiw24F…`, label **Solana Devnet**, chain ID
  `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`.
- გასაღებები WSL-შია, `~/.config/stele-devnet/` (chmod 600, repo-ს გარეთ):
  - `owner.json` → `C6q9uiQsmxy5E2hx3hjv1i36i98vXvtBF35Hfq54GJ4p`: upgrade authority, protocol admin და
    **treasury** (შემოსავალი აქ მოდის). სერვერზე **არასოდეს** იდება.
  - `relayer.json` → `EdLvTmdN…` (საკომისიოს იხდის; სერვერზე), `attestor.json` → `tc2njAHN…` (დომენები; სერვერზე).
- Smoke test: ორგანიზაცია, დოკუმენტი, ვერსია, shard და acceptance devnet-ზე; `stele-verify`-ით ყველა
  კრიპტოგრაფიული შემოწმება გავიდა.
- საჯარო devnet RPC (`api.devnet.solana.com`) IP-ს მკაცრად ზღუდავს (429). სერვერისთვის უმჯობესია
  უფასო Helius/QuickNode devnet RPC (მისი URL საიდუმლოა: მხოლოდ `SOLANA_RPC_URLS`-ში).

### შემოსავალი: კრედიტები

- ყოველ ორგანიზაციას თვეში `STELE_FREE_RECORDS_PER_MONTH` (ნაგულისხმევად 1,000) ჩანაწერი (acceptance ან
  proof) უფასოდ აქვს; შემდეგ თითო ჩანაწერი = 1 კრედიტი.
- კრედიტებს owner/admin ყიდულობს **Dashboard → Billing**-ში: საფულე SOL-ს პირდაპირ treasury-ზე
  (`STELE_TREASURY_ADDRESS`) რიცხავს, invoice-ის უნიკალური reference-ით; API კრედიტს მხოლოდ blockchain-ზე
  ნაპოვნი, დადასტურებული გადახდის შემდეგ ჩაურიცხავს (ერთი invoice და ერთი ტრანზაქცია = ერთხელ).
- პაკეტები (`STELE_CREDIT_PACKS`): 10,000 = 0.5 SOL, 100,000 = 4 SOL, 1,000,000 = 30 SOL. Pricing გვერდი
  ფასებს პირდაპირ API-დან (`GET /v1/billing`) კითხულობს.
- კრედიტის/ლიმიტის ამოწურვისას მოთხოვნა უარყოფილია **ხელმოწერამდე** (`402 credits_exhausted`).
- Mainnet-ისთვის რეკომენდაცია: treasury და upgrade authority **ცალ-ცალკე** (treasury შეიძლება იყოს
  ჩვეულებრივი საფულე, upgrade authority კი multisig).

## 18. Colosseum-ის განახლება: native passkey-ები, receipt v2, batching (stele/2)

**რა დაემატა (არაფერი წაშლილა):**

- **Native passkey ხელმოწერა (stele/2).** Passkey-ის საკუთარი P-256 გასაღები ხელს აწერს; private key
  მოწყობილობიდან არასდროს გადის, Stele-სა და JavaScript-ში არაფერი ინახება. Solana-ს secp256r1
  precompile ამოწმებს ხელმოწერას, პროგრამა კი ამოწმებს challenge-ს, origin-ს (browser-attested),
  RP ID-ს და user verification-ს (`record_passkey_acceptance`). Wallet (Ed25519) და PRF passkey
  (stele/1) უცვლელად მუშაობს.
- **On-chain enrollment** (`PasskeySigner`, salted account commitment, პერსონალური მონაცემი არ არის):
  rotation მხოლოდ ძველი გასაღებით; ორგანიზაციის recovery admin wallet-ით და ყველა verifier-ში
  „ORGANIZATION_RECOVERY“-ად ჩანს.
- **`stele-receipt/2`**: ზუსტი ტექსტი, WebAuthn მონაცემები, browser-attested origin, enrollment,
  evidence mode; verifier API-ის გარეშე მუშაობს (CLI: `--receipt`, `--batched`, `--show-text`).
- **MERKLE_BATCHED რეჟიმი**: relayer ხელმოწერებს off-chain ამოწმებს და Merkle root-ს ერთი
  ტრანზაქციით აფიქსირებს (`anchor_acceptance_batch`); manifest საჯაროა (`/v1/public/batches/{root}`).
- **Display safety**: bidi/zero-width/look-alike/გარე ბმულების გაფრთხილება (PROTOCOL_SPEC §4.5).
- Domain-ის on-chain მტკიცებულება ანგარიშში; wallet origin = „merchant-claimed“ (გაფრთხილება).
- Relayer policy: precompile↔ინსტრუქციის მკაცრი წყვილები; enrollment-ების თვიური ლიმიტი
  (`STELE_MAX_ENROLLMENTS_PER_MONTH`); 429-ზე RPC retry.
- დოკუმენტაცია: PROTOCOL_SPEC §17, threat model §7, `docs/cost-analysis.md`,
  `docs/upgrade-authority.md`, `docs/demo.md`, განახლებული README და საიტის მთავარი გვერდი.

**Devnet (2026-10-05):** პროგრამა განახლდა stele/2 build-ზე (786 344 ბაიტი, sha256 `f4a32972…`).
Smoke test devnet-ზე: native passkey acceptance, Merkle batch და forgery-ის მცდელობები (უარყოფილი).
Upgrade authority ჯერ ერთი გასაღებია (`C6q9…`) — **პროგრამა immutable არ არის**; Squads-ზე
გადასვლის ნაბიჯები: `docs/upgrade-authority.md`.

**ბრძანებები:**

| ბრძანება | |
|---|---|
| `pnpm --filter @stele/localnet costs` | გაზომილი საკომისიოები, CU, ზომა, rent |
| `pnpm --filter @stele/localnet forgery-demo -- --receipt <file>` | operator-ის forgery მცდელობები (simulation) |
| `pnpm --filter @stele/localnet publish-version -- …` | ვერსიის გამოქვეყნება localnet/devnet-ზე (mainnet-ზე უარს ამბობს) |
| `STELE_DEVNET_SMOKE=1 … vitest run test/devnet.smoke.test.ts` | devnet smoke test (apps/api) |
| `npx tsx packages/verifier/src/cli.ts --rpc … --receipt … --show-text` | დამოუკიდებელი შემოწმება |

**შენიშვნები:** E2E Edge-ით: `PW_CHANNEL=msedge E2E_PRODUCTION=1 pnpm test:e2e`.
`pnpm localnet:seed` ახლა იმავე ledger-ზე თავიდან გაშვებადია (acme.example ახალ org-ზე გადადის).
