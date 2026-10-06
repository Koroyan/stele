/**
 * Northwind Shop: a sample customer app that uses every part of Stele.
 *
 *   /terms      the widget with a server-issued acceptance session (data attributes)
 *   /privacy    the widget through the JavaScript API (Stele.mount, callbacks, session function)
 *   /checkout   an order the SERVER allows only after the current Terms were accepted, confirmed
 *               by the customer as a signed PURCHASE proof (passkey or wallet, fee-free)
 *   /account    the user's status per document, their acceptances, receipts, independent checks
 *   /security   the user's passkey signer: devices, recovery kit, reset (walletless signing)
 *   /webhooks   signed notifications from Stele, verified and de-duplicated
 *   /api-log    every call this server made to Stele
 *
 * The login is a demo: pick any name. Run `pnpm localnet:demo` first, then `pnpm demo:shop`.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { verifyWebhook } from "@stele/sdk/server";
import { esc, html, page, raw, short, type Html } from "./html";
import {
  APP_URL,
  DOCUMENTS,
  ORGANIZATION,
  ORGANIZATION_ADDRESS,
  WEBHOOK_SECRET,
  acceptanceById,
  apiLog,
  network,
  publicDocument,
  receipt,
  stele,
  verifyIndependently,
} from "./stele";

const PORT = Number(process.env.PORT ?? 4300);
const SCRIPT = `${APP_URL}/sdk/v1/stele.js`;

// ---- Demo state (in memory) -----------------------------------------------------------------------

interface WebhookEntry {
  at: Date;
  verified: boolean;
  duplicate: boolean;
  id: string;
  type: string;
  summary: string;
  error?: string;
}
const webhooks: WebhookEntry[] = [];
const seenEvents = new Set<string>();
const orders: { id: string; user: string; at: Date; termsVersion: number; proofId: string }[] = [];

/** The cart (fixed in this demo) — the statement the customer confirms is built from it. */
const CART = [
  {
    sku: "MUG-SEA",
    name: "Ceramic mug, sea green",
    quantity: 1,
    unitPrice: "18.00",
    total: "18.00",
  },
  { sku: "TOWEL-LIN", name: "Linen tea towel", quantity: 1, unitPrice: "12.00", total: "12.00" },
];
/** Orders waiting for the customer's signed purchase confirmation. */
const pendingOrders = new Map<string, { user: string; requestId: string; termsVersion: number }>();

let networkLabel = "Solana";
void network()
  .then((n) => (networkLabel = n.label))
  .catch(() => undefined);

// ---- Helpers ---------------------------------------------------------------------------------------

function userOf(req: IncomingMessage): string | null {
  const m = /(?:^|;\s*)nw_user=([A-Za-z0-9_-]{3,64})/.exec(req.headers.cookie ?? "");
  return m ? m[1]! : null;
}

function send(
  res: ServerResponse,
  status: number,
  body: string,
  type = "text/html; charset=utf-8",
) {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" }).end(body);
}

function redirect(res: ServerResponse, to: string, cookie?: string) {
  res.writeHead(303, { location: to, ...(cookie ? { "set-cookie": cookie } : {}) }).end();
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

const render = (
  req: IncomingMessage,
  path: string,
  title: string,
  body: Html,
  refreshSeconds?: number,
) => page({ title, path, user: userOf(req), network: networkLabel, body, refreshSeconds });

const signInFirst = html`<div class="card">
  <h3>Sign in first</h3>
  <p>
    The demo links every acceptance to your account in this shop.
    <a href="/">Sign in on the home page</a>.
  </p>
</div>`;

const widget = (slug: string, sessionToken: string) =>
  html`<div
      data-stele-organization="${ORGANIZATION}"
      data-stele-document="${slug}"
      data-stele-session="${sessionToken}"
      data-stele-theme="light"
    ></div>
    <script src="${SCRIPT}" defer></script>`;

// ---- Pages -----------------------------------------------------------------------------------------

function home(req: IncomingMessage): string {
  const user = userOf(req);
  const steps: [string, string, string][] = [
    [
      "/terms",
      "Accept the Terms",
      "The widget, with a session your server created for you. Your user ID is stored with the acceptance.",
    ],
    [
      "/privacy",
      "Accept the Privacy Policy",
      "The same widget mounted from JavaScript, with callbacks.",
    ],
    [
      "/checkout",
      "Check out",
      "The server checks your Terms acceptance, then you confirm the purchase itself with a signed proof.",
    ],
    [
      "/account",
      "See your acceptances",
      "Status per document, receipts, and an independent check against Solana.",
    ],
    [
      "/security",
      "Protect your passkey signer",
      "No wallet? Sign with a passkey. Add a second device, keep a recovery kit, or reset.",
    ],
    ["/webhooks", "Watch webhooks", "Signed notifications Stele sent to this server, verified."],
    ["/api-log", "Inspect API calls", "Every request this server made to Stele."],
  ];
  return render(
    req,
    "/",
    "Home",
    html`<h1>Northwind Shop</h1>
      <p class="lead">
        A sample online store that uses <strong>Stele</strong> for its Terms of Service and Privacy
        Policy. Sign in with any name, then follow the steps. Everything you do is recorded on
        Solana and can be verified by anyone.
      </p>
      ${
        user
          ? html`<p><span class="ok">✓ Signed in as ${user}</span></p>`
          : html`<form method="post" action="/login" class="card" style="max-width:520px">
              <h3>Sign in (demo)</h3>
              <p style="margin-bottom:12px">
                Any name works; it becomes your user ID in this shop.
              </p>
              <input
                type="text"
                name="name"
                placeholder="for example: nino"
                required
                pattern="[A-Za-z0-9 _-]{2,40}"
              />
              <button class="btn" style="margin-left:8px">Sign in</button>
            </form>`
      }
      <h2>What to try</h2>
      <div class="grid">
        ${steps.map(
          ([href, title, text], i) =>
            html`<a class="card" href="${href}" style="text-decoration:none;color:inherit">
              <div class="step">STEP ${i + 1}</div>
              <h3>${title}</h3>
              <p>${text}</p>
            </a>`,
        )}
      </div>
      <h2>Then: publish new Terms</h2>
      <div class="explain">
        In the Stele dashboard (as a member of Northwind Shop), open
        <strong>Documents → Terms of Service → New version</strong> and publish it. Come back to
        <a href="/account">My acceptances</a> and <a href="/checkout">Checkout</a>: your old
        acceptance no longer counts, and the shop asks you to accept the new version.
      </div>`,
  );
}

async function termsPage(req: IncomingMessage): Promise<string> {
  const user = userOf(req);
  if (!user) return render(req, "/terms", "Terms", signInFirst);
  // One session per page view, created on the server with the API key.
  const { sessionToken } = await stele.createAcceptanceSession({
    document: "terms-of-service",
    externalUserRef: user,
  });
  return render(
    req,
    "/terms",
    "Terms of Service",
    html`<h1>Terms of Service</h1>
      <p class="lead">Read the Terms and accept them with your Solana wallet.</p>
      <div class="two">
        <div>${widget("terms-of-service", sessionToken)}</div>
        <div class="explain">
          <strong>What is happening</strong>
          <ol>
            <li>
              This page asked Stele for an <em>acceptance session</em> for
              <code>${user}</code> (server, API key).
            </li>
            <li>
              The widget loaded the Terms and checked them against Solana before showing them.
            </li>
            <li>
              When you sign, the acceptance is recorded on Solana, and Stele remembers that it was
              <code>${user}</code>.
            </li>
            <li>
              Stele then sends this server a signed webhook (see <a href="/webhooks">Webhooks</a>).
            </li>
          </ol>
          <p style="margin-top:10px">
            Next: <a href="/privacy">Privacy Policy</a> or <a href="/checkout">Checkout</a>.
          </p>
        </div>
      </div>`,
  );
}

function privacyPage(req: IncomingMessage): string {
  const user = userOf(req);
  if (!user) return render(req, "/privacy", "Privacy", signInFirst);
  // The widget is mounted from JavaScript; it fetches a session from /session when the user signs.
  const script = raw(`<script src="${esc(SCRIPT)}" defer></script>
<script>
  window.addEventListener("DOMContentLoaded", function () {
    Stele.mount("#privacy", {
      organization: ${JSON.stringify(ORGANIZATION)},
      document: "privacy-policy",
      theme: "light",
      sessionToken: function () {
        return fetch("/session?document=privacy-policy").then(function (r) { return r.text(); });
      },
      onAccepted: function (result) {
        var out = document.getElementById("result");
        out.textContent = "onAccepted: " + JSON.stringify({ acceptanceId: result.acceptanceId, transactionSignature: result.transactionSignature, slot: result.slot }, null, 2);
      },
      onError: function (error) {
        document.getElementById("result").textContent = "onError: " + error.message;
      }
    });
  });
</script>`);
  return render(
    req,
    "/privacy",
    "Privacy Policy",
    html`<h1>Privacy Policy</h1>
      <p class="lead">
        The same widget, created with <code>Stele.mount()</code> instead of data attributes.
      </p>
      <div class="two">
        <div>
          <div id="privacy"></div>
          ${script}
        </div>
        <div class="explain">
          <strong>JavaScript API</strong>
          <ol>
            <li><code>Stele.mount("#privacy", { … })</code> renders the widget.</li>
            <li>
              <code>sessionToken</code> is a function: the widget calls <code>/session</code> on
              this server only when you click <em>Accept &amp; sign</em>.
            </li>
            <li><code>onAccepted</code> and <code>onError</code> receive the result:</li>
          </ol>
          <pre id="result" class="mono" style="white-space:pre-wrap;margin:10px 0 0">
(waiting for your signature)</pre>
        </div>
      </div>`,
  );
}

async function checkoutPage(req: IncomingMessage, notice?: Html): Promise<string> {
  const user = userOf(req);
  if (!user) return render(req, "/checkout", "Checkout", signInFirst);
  const accepted = await stele.hasAcceptedLatest(user, "terms-of-service");
  const latest = await stele.latestVersion("terms-of-service");
  let terms: Html;
  if (accepted) {
    terms = html`<p>
      <span class="ok"
        >✓ You accepted the current Terms (version ${latest.version.label},
        #${latest.version.number})</span
      >
    </p>`;
  } else {
    const { sessionToken } = await stele.createAcceptanceSession({
      document: "terms-of-service",
      externalUserRef: user,
    });
    terms = html`<p>
        <span class="warn"
          >Please accept the current Terms (version ${latest.version.label}) to continue</span
        >
      </p>
      ${widget("terms-of-service", sessionToken)}
      <script>
        document.addEventListener("stele:accepted", function () {
          document.getElementById("pay").disabled = false;
        });
      </script>`;
  }
  return render(
    req,
    "/checkout",
    "Checkout",
    html`<h1>Checkout</h1>
      ${notice ?? ""}
      <div class="two">
        <div>
          <table>
            <tr>
              <th>Item</th>
              <th>Price</th>
            </tr>
            <tr>
              <td>Ceramic mug, sea green</td>
              <td>€18.00</td>
            </tr>
            <tr>
              <td>Linen tea towel</td>
              <td>€12.00</td>
            </tr>
            <tr>
              <td><strong>Total</strong></td>
              <td><strong>€30.00</strong></td>
            </tr>
          </table>
          <h2>Terms of Service</h2>
          ${terms}
          <form method="post" action="/checkout" style="margin-top:16px">
            <button id="pay" class="btn" ${accepted ? "" : raw("disabled")}>Place order</button>
          </form>
        </div>
        <div class="explain">
          <strong>Why the server checks again</strong>
          <p>
            The button is enabled by the browser event <code>stele:accepted</code>, but browser
            events can be faked. When you place the order, the server asks Stele:
            <code>hasAcceptedLatest("${user}", "terms-of-service")</code>, and refuses the order if
            the answer is <code>null</code>.
          </p>
          <p style="margin-top:8px">
            Publish a new Terms version in the dashboard and this page asks you to accept again.
          </p>
        </div>
      </div>`,
  );
}

/** Step 1: Terms checked by the server; the customer is asked to confirm the purchase. */
async function placeOrder(req: IncomingMessage, res: ServerResponse) {
  const user = userOf(req);
  if (!user) return redirect(res, "/");
  const accepted = await stele.hasAcceptedLatest(user, "terms-of-service");
  if (!accepted) {
    return send(
      res,
      403,
      await checkoutPage(
        req,
        html`<p>
          <span class="no"
            >✗ Order refused by the server: you have not accepted the current Terms of
            Service.</span
          >
        </p>`,
      ),
    );
  }
  const id = `NW-${1000 + orders.length + pendingOrders.size + 1}`;
  const latest = await stele.latestVersion("terms-of-service");
  // The statement: what is bought, for how much, under which Terms. Stele stores it off-chain and
  // records only its hash; the customer signs a message naming that hash.
  const request = await stele.createProofRequest({
    type: "PURCHASE",
    reference: id,
    summary: `Purchase of ${CART.length} items from Northwind Shop`,
    details: {
      currency: "EUR",
      items: CART,
      subtotal: "30.00",
      shipping: "0.00",
      total: "30.00",
      paymentMethod: "Demo card •••• 4242",
    },
    policies: [
      {
        title: latest.version.title,
        version: latest.version.number,
        fingerprint: latest.version.fingerprint,
        acceptanceId: accepted.acceptanceId,
      },
    ],
    externalUserRef: user,
    ttlSeconds: 1800,
  });
  pendingOrders.set(id, {
    user,
    requestId: request.requestId,
    termsVersion: accepted.versionNumber,
  });
  send(
    res,
    200,
    render(
      req,
      "/checkout",
      "Confirm your purchase",
      html`<h1>Confirm your purchase</h1>
        <p class="lead">
          Order <strong>${id}</strong>. Sign the purchase with your passkey or wallet — it is free:
          Northwind sponsors the network fee.
        </p>
        <div class="two">
          <div>
            <div
              data-stele-proof-request="${request.requestId}"
              data-stele-proof-token="${request.clientToken}"
              data-stele-theme="light"
            ></div>
            <script src="${SCRIPT}" defer></script>
            <form id="complete" method="post" action="/checkout/complete" style="display:none">
              <input type="hidden" name="order" value="${id}" />
            </form>
            <script>
              document.addEventListener("stele:confirmed", function () {
                document.getElementById("complete").submit();
              });
            </script>
          </div>
          <div class="explain">
            <strong>What you sign</strong>
            <p>
              The widget checks, in your browser, that the order it shows hashes to the
              <code>Statement</code> line of the message you sign. Only that hash goes on-chain; the
              order details stay private between you and the shop, in your receipt.
            </p>
            <p style="margin-top:8px">
              The server then refuses to fulfil the order unless Stele has a verified PURCHASE proof
              with reference <code>${id}</code> signed for your account.
            </p>
          </div>
        </div>`,
    ),
  );
}

/** Step 2: the server fulfils the order only with a verified purchase proof. */
async function completeOrder(req: IncomingMessage, res: ServerResponse) {
  const user = userOf(req);
  if (!user) return redirect(res, "/");
  const orderId = new URLSearchParams((await readBody(req)).toString()).get("order") ?? "";
  const pending = pendingOrders.get(orderId);
  if (!pending || pending.user !== user) return redirect(res, "/checkout");
  const { proofs } = await stele.listProofs({ type: "PURCHASE", reference: orderId, limit: 5 });
  const proof = proofs.find((p) => p.externalUserRef === user);
  if (!proof)
    return send(
      res,
      409,
      render(
        req,
        "/checkout",
        "Not confirmed",
        html`<p class="no">✗ No signed purchase confirmation was found for ${orderId}.</p>`,
      ),
    );
  // The receipt endpoint re-verifies the proof against the chain before returning it.
  const { report } = await stele.getProofReceipt(proof.proofId);
  pendingOrders.delete(orderId);
  orders.push({
    id: orderId,
    user,
    at: new Date(),
    termsVersion: pending.termsVersion,
    proofId: proof.proofId,
  });
  send(
    res,
    200,
    render(
      req,
      "/checkout",
      "Order placed",
      html`<h1>Thank you!</h1>
        <p class="lead">
          Order <strong>${orderId}</strong> was placed. You accepted Terms #${pending.termsVersion}
          and confirmed the purchase itself with a signed proof (verdict:
          <strong>${String((report as { verdict?: string }).verdict)}</strong>).
        </p>
        <div class="card">
          <h3>Purchase proof</h3>
          <p>
            Proof <code>${short(proof.proofId, 10, 6)}</code> · signed by
            <code>${short(proof.signer)}</code>
            (${proof.signerType === "passkey" ? "passkey" : "wallet"}) ·
            <a href="/proof/${proof.proofId}.json">download the receipt</a> — anyone can verify it
            at <a href="${APP_URL}/verify" target="_blank">${APP_URL}/verify</a>.
          </p>
        </div>`,
    ),
  );
}

async function securityPage(req: IncomingMessage): Promise<string> {
  const user = userOf(req);
  if (!user) return render(req, "/security", "Account security", signInFirst);
  const { signers } = await stele.listSigners(user);
  const active = signers.filter((s) => s.status === "active");
  return render(
    req,
    "/security",
    "Account security",
    html`<h1>Account security</h1>
      <p class="lead">
        Your passkey signer for Northwind: a signing key created in your browser and protected by
        your passkey. Northwind and Stele hold only its encrypted form and cannot sign for you.
      </p>
      ${
        signers.length === 0
          ? html`<p class="empty">
              No passkey signer yet. Accept the <a href="/terms">Terms</a> and choose "Create a
              passkey".
            </p>`
          : html`<table>
              <tr>
                <th>Signer key</th>
                <th>Status</th>
                <th>Passkeys</th>
                <th>Recovery kits</th>
                <th>Created</th>
              </tr>
              ${signers.map(
                (s) =>
                  html`<tr>
                    <td class="mono">
                      ${short(s.publicKey)}${s.rotation ? html` <span class="warn">(replaced a lost key)</span>` : ""}
                    </td>
                    <td>${s.status}</td>
                    <td>${String(s.passkeys.filter((p) => !p.revokedAt).length)}</td>
                    <td>${String(s.recoveryKits.length)}</td>
                    <td>${new Date(s.createdAt).toLocaleString()}</td>
                  </tr>`,
              )}
            </table>`
      }
      <div class="grid" style="margin-top:20px">
        <div class="card">
          <h3>Add another device</h3>
          <p>
            Unlock your key with your current passkey, then create a second passkey (e.g. a security
            key).
          </p>
          <button class="btn" id="add" style="margin-top:10px">Add a passkey</button>
        </div>
        <div class="card">
          <h3>Restore with your recovery kit</h3>
          <p>
            On a new device: the kit unlocks the same key, which then authorizes a passkey here.
          </p>
          <input id="kit" placeholder="stele-rk1-…" style="margin-top:10px;width:100%" />
          <button class="btn" id="restore" style="margin-top:8px">Restore</button>
        </div>
        <div class="card">
          <h3>Lost everything?</h3>
          <p>
            The shop can retire your signer after verifying you. Your next signer is a
            <strong>new</strong> key, recorded as authorized by the shop's account system — nobody
            ever gains control of the old key, and your past signatures stay valid.
          </p>
          <form method="post" action="/security/reset" style="margin-top:10px">
            <button class="btn ghost" ${active.length ? "" : raw("disabled")}>
              Reset my signer
            </button>
          </form>
        </div>
      </div>
      <pre id="out" class="mono" style="white-space:pre-wrap;margin-top:16px"></pre>
      <script src="${SCRIPT}"></script>
      <script>
        (function () {
          var out = document.getElementById("out");
          var org = ${raw(JSON.stringify(ORGANIZATION_ADDRESS))};
          function client() {
            return window.Stele.client();
          }
          document.getElementById("add").onclick = function () {
            var signer = window.Stele.PasskeySigner.remembered(client(), org);
            if (!signer) {
              out.textContent =
                "No passkey signer on this device yet. Create one when accepting the Terms.";
              return;
            }
            signer.addPasskey("Second passkey").then(
              function () {
                out.textContent = "Added. Reload to see it.";
              },
              function (e) {
                out.textContent = String((e && e.message) || e);
              },
            );
          };
          document.getElementById("restore").onclick = function () {
            window.Stele.PasskeySigner.recover({
              client: client(),
              organization: org,
              recoveryKit: document.getElementById("kit").value,
            }).then(
              function (s) {
                out.textContent =
                  "Restored signer " + s.address + " with a new passkey on this device.";
              },
              function (e) {
                out.textContent = String((e && e.message) || e);
              },
            );
          };
        })();
      </script>`,
  );
}

async function resetSigner(req: IncomingMessage, res: ServerResponse) {
  const user = userOf(req);
  if (!user) return redirect(res, "/");
  const { signers } = await stele.listSigners(user);
  for (const s of signers)
    if (s.status === "active")
      await stele.revokeSigner(
        s.publicKey,
        "customer lost every passkey and recovery kit (demo: no identity check)",
      );
  return redirect(res, "/security");
}

async function accountPage(req: IncomingMessage): Promise<string> {
  const user = userOf(req);
  if (!user) return render(req, "/account", "My acceptances", signInFirst);
  const status = await Promise.all(
    DOCUMENTS.map(async (d) => ({
      ...d,
      latest: await stele.latestVersion(d.slug),
      accepted: await stele.hasAcceptedLatest(user, d.slug),
      history: await publicDocument(d.slug),
    })),
  );
  const { acceptances } = await stele.listAcceptances({ externalUserRef: user, limit: 50 });
  return render(
    req,
    "/account",
    "My acceptances",
    html`<h1>My acceptances</h1>
      <p class="lead">
        What this shop knows about <code>${user}</code>, all of it backed by evidence on Solana.
      </p>
      <div class="grid">
        ${status.map(
          (d) =>
            html`<div class="card">
              <h3>${d.title}</h3>
              <p>
                Current version ${d.latest.version.label} (#${d.latest.version.number}) ·
                fingerprint <code>${short(d.latest.version.fingerprint, 8, 6)}</code>
              </p>
              <p style="margin-top:10px">
                ${
                  d.accepted
                    ? html`<span class="ok">✓ Accepted (#${d.accepted.versionNumber})</span>`
                    : html`<span class="warn">Not accepted yet</span>
                        <a href="${d.slug === "terms-of-service" ? "/terms" : "/privacy"}"
                          >accept now</a
                        >`
                }
              </p>
              <p style="margin-top:10px;font-size:12.5px">
                Version history (public API):
                ${(d.history?.versions ?? []).map((v) => html`v${v.label} (${v.acceptanceCount} acceptances) `)}
              </p>
            </div>`,
        )}
      </div>
      <h2>All your acceptances</h2>
      ${
        acceptances.length === 0
          ? html`<p class="empty">None yet. Start with <a href="/terms">the Terms</a>.</p>`
          : html`<table>
              <tr>
                <th>When</th>
                <th>Document</th>
                <th>Version</th>
                <th>Wallet</th>
                <th>Site</th>
                <th>Status</th>
                <th></th>
              </tr>
              ${acceptances.map(
                (a) =>
                  html`<tr>
                    <td>${a.blockTime ? new Date(a.blockTime).toLocaleString() : ""}</td>
                    <td>${a.documentSlug}</td>
                    <td>#${a.versionNumber}</td>
                    <td class="mono">${short(a.signer)}</td>
                    <td>${a.requestDomain}</td>
                    <td>${a.commitment}</td>
                    <td>
                      <a href="/verify/${a.acceptanceId}">verify</a> ·
                      <a href="${APP_URL}/receipt/${a.acceptanceId}" target="_blank">receipt</a> ·
                      <a href="/receipt/${a.acceptanceId}.json">download</a>
                    </td>
                  </tr>`,
              )}
            </table>`
      }`,
  );
}

async function verifyPage(req: IncomingMessage, acceptanceId: string): Promise<string> {
  const found = await acceptanceById(acceptanceId);
  if (!found) return render(req, "/account", "Verify", html`<p class="no">Unknown acceptance.</p>`);
  const report = await verifyIndependently(found.acceptance.transactionSignature);
  const badge =
    report.verdict === "VALID" ? "ok" : report.verdict === "VALID_WITH_WARNINGS" ? "warn" : "no";
  return render(
    req,
    "/account",
    "Independent verification",
    html`<h1>Independent verification</h1>
      <p class="lead">
        This server checked the acceptance itself with <code>@stele/verifier</code>, reading Solana
        directly. It did not ask Stele whether the evidence is genuine.
      </p>
      <p><span class="${badge}">${report.verdict}</span> ${report.summary}</p>
      <p style="font-size:13px">
        Transaction <code>${short(found.acceptance.transactionSignature, 10, 8)}</code> · your user
        <code>${found.acceptance.externalUserRef ?? "(no session)"}</code>
      </p>
      <table>
        <tr>
          <th>Check</th>
          <th>Result</th>
          <th>Detail</th>
        </tr>
        ${report.checks.map(
          (c) =>
            html`<tr>
              <td>${c.label}</td>
              <td>
                <span class="${c.status === "pass" ? "ok" : c.status === "warn" ? "warn" : "no"}"
                  >${c.status}</span
                >
              </td>
              <td>${c.detail}</td>
            </tr>`,
        )}
      </table>`,
  );
}

function webhooksPage(req: IncomingMessage): string {
  return render(
    req,
    "/webhooks",
    "Webhooks",
    html`<h1>Webhooks</h1>
      <p class="lead">
        Notifications Stele sent to <code>POST /webhooks/stele</code> on this server. Each one is
        verified with <code>verifyWebhook</code> (HMAC signature and age) and de-duplicated by event
        ID. This page refreshes every 4 seconds.
      </p>
      ${
        webhooks.length === 0
          ? html`<p class="empty">
              Nothing received yet. Accept a document, or use <strong>Test</strong> on the endpoint
              in the dashboard (Integrations).
            </p>`
          : html`<table>
              <tr>
                <th>Received</th>
                <th>Event</th>
                <th>Signature</th>
                <th>Data</th>
              </tr>
              ${webhooks.map(
                (w) =>
                  html`<tr>
                    <td>${w.at.toLocaleTimeString()}</td>
                    <td>
                      <code>${w.type}</code><br /><span class="mono" style="color:#5b6672"
                        >${w.id}</span
                      >
                    </td>
                    <td>
                      ${
                        w.verified
                          ? html`<span class="ok">✓ valid</span
                              >${w.duplicate ? html` <span class="warn">duplicate, ignored</span>` : ""}`
                          : html`<span class="no">✗ ${w.error}</span>`
                      }
                    </td>
                    <td>${w.summary}</td>
                  </tr>`,
              )}
            </table>`
      }`,
    4,
  );
}

function apiLogPage(req: IncomingMessage): string {
  return render(
    req,
    "/api-log",
    "API log",
    html`<h1>API log</h1>
      <p class="lead">
        Every request this server made to Stele (the browser widget talks to Stele directly and is
        not listed). This page refreshes every 4 seconds.
      </p>
      ${
        apiLog.length === 0
          ? html`<p class="empty">No calls yet.</p>`
          : html`<table>
              <tr>
                <th>Time</th>
                <th>Request</th>
                <th>Auth</th>
                <th>Status</th>
                <th>ms</th>
              </tr>
              ${apiLog.map(
                (c) =>
                  html`<tr>
                    <td>${c.at.toLocaleTimeString()}</td>
                    <td class="mono">${c.method} ${c.path}</td>
                    <td>${c.auth}</td>
                    <td>${c.status}</td>
                    <td>${c.ms}</td>
                  </tr>`,
              )}
            </table>`
      }`,
    4,
  );
}

// ---- Webhook receiver ------------------------------------------------------------------------------

async function receiveWebhook(req: IncomingMessage, res: ServerResponse) {
  const body = await readBody(req); // raw bytes: the signature covers exactly these
  try {
    const event = verifyWebhook(
      WEBHOOK_SECRET,
      req.headers["stele-signature"] as string | undefined,
      body,
    );
    const duplicate = seenEvents.has(event.id);
    seenEvents.add(event.id);
    const d = event.data as Record<string, unknown>;
    const summary = Object.entries(d)
      .filter(([k]) =>
        [
          "externalUserRef",
          "versionNumber",
          "documentSlug",
          "commitment",
          "domain",
          "versionLabel",
          "message",
        ].includes(k),
      )
      .map(([k, v]) => `${k}: ${String(v)}`)
      .join(" · ");
    webhooks.unshift({
      at: new Date(),
      verified: true,
      duplicate,
      id: event.id,
      type: event.type,
      summary,
    });
    res.writeHead(204).end();
  } catch (e) {
    webhooks.unshift({
      at: new Date(),
      verified: false,
      duplicate: false,
      id: "",
      type: "(rejected)",
      summary: "",
      error: e instanceof Error ? e.message : String(e),
    });
    res.writeHead(400).end();
  }
  webhooks.length = Math.min(webhooks.length, 100);
}

// ---- Router ----------------------------------------------------------------------------------------

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const path = url.pathname;
  try {
    if (req.method === "POST" && path === "/webhooks/stele") return await receiveWebhook(req, res);
    if (req.method === "POST" && path === "/login") {
      const name = new URLSearchParams((await readBody(req)).toString()).get("name") ?? "";
      const id = `user_${name
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 40)}`;
      if (id === "user_") return redirect(res, "/");
      return redirect(res, "/terms", `nw_user=${id}; Path=/; HttpOnly; SameSite=Lax`);
    }
    if (req.method === "POST" && path === "/logout")
      return redirect(res, "/", "nw_user=; Path=/; Max-Age=0; SameSite=Lax");
    if (req.method === "POST" && path === "/checkout") return await placeOrder(req, res);
    if (req.method === "POST" && path === "/checkout/complete")
      return await completeOrder(req, res);
    if (req.method === "POST" && path === "/security/reset") return await resetSigner(req, res);
    const proofMatch = /^\/proof\/([0-9a-f]{64})\.json$/.exec(path);
    if (req.method === "GET" && proofMatch) {
      const { receipt: body } = await stele.getProofReceipt(proofMatch[1]!);
      res.writeHead(200, {
        "content-type": "application/json",
        "content-disposition": `attachment; filename="stele-proof-${proofMatch[1]!.slice(0, 16)}.json"`,
      });
      return res.end(JSON.stringify(body, null, 2));
    }
    if (req.method === "GET" && path === "/session") {
      const user = userOf(req);
      if (!user) return send(res, 401, "sign in first", "text/plain");
      const document = url.searchParams.get("document") ?? "terms-of-service";
      const { sessionToken } = await stele.createAcceptanceSession({
        document,
        externalUserRef: user,
      });
      return send(res, 200, sessionToken, "text/plain");
    }
    const receiptMatch = /^\/receipt\/([0-9a-f]{64})\.json$/.exec(path);
    if (req.method === "GET" && receiptMatch) {
      const json = await receipt(receiptMatch[1]!);
      if (!json) return send(res, 404, "not found", "text/plain");
      res.writeHead(200, {
        "content-type": "application/json",
        "content-disposition": `attachment; filename="receipt-${receiptMatch[1]!.slice(0, 12)}.json"`,
      });
      return res.end(json);
    }
    const verifyMatch = /^\/verify\/([0-9a-f]{64})$/.exec(path);
    if (req.method === "GET" && verifyMatch)
      return send(res, 200, await verifyPage(req, verifyMatch[1]!));
    if (req.method !== "GET") return send(res, 405, "method not allowed", "text/plain");
    switch (path) {
      case "/":
        return send(res, 200, home(req));
      case "/terms":
        return send(res, 200, await termsPage(req));
      case "/privacy":
        return send(res, 200, privacyPage(req));
      case "/checkout":
        return send(res, 200, await checkoutPage(req));
      case "/account":
        return send(res, 200, await accountPage(req));
      case "/security":
        return send(res, 200, await securityPage(req));
      case "/webhooks":
        return send(res, 200, webhooksPage(req));
      case "/api-log":
        return send(res, 200, apiLogPage(req));
      default:
        return send(res, 404, render(req, path, "Not found", html`<h1>Not found</h1>`));
    }
  } catch (e) {
    console.error(e);
    send(
      res,
      500,
      render(
        req,
        path,
        "Error",
        html`<h1>Something went wrong</h1>
          <p class="no">${e instanceof Error ? e.message : String(e)}</p>
          <p>Is the local Stele stack running? See examples/demo-shop/README.md.</p>`,
      ),
    );
  }
}

// Loopback only (IPv4 and IPv6): "localhost" may resolve to either, for browsers and for Stele's
// webhook deliveries alike. Nothing is exposed to the network.
for (const host of ["127.0.0.1", "::1"]) {
  createServer((req, res) => void handle(req, res))
    .on("error", (e) => console.warn(`not listening on ${host}: ${e.message}`))
    .listen(PORT, host);
}
console.info(`Northwind Shop (Stele demo) on http://localhost:${PORT}`);
