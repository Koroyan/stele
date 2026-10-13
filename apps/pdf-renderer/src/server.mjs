// Stele PDF renderer: turns the API's HTML templates (PDF receipts) into PDF with Chromium.
//
// Chromium is the text engine because it shapes every script (HarfBuzz) and lays out right-to-left
// text (bidi) correctly; the image ships Noto fonts for all of them. Internal only: it listens on a
// private Docker network with no internet access, JavaScript is disabled in the page, and every
// request the page tries to make (other than inline data: URLs) is blocked.
//
//   POST /render  {"html": "...", "footer": "..."}  ->  application/pdf
//   GET  /health
import http from "node:http";
import puppeteer from "puppeteer-core";

const PORT = Number(process.env.PORT ?? 4100);
const CHROME = process.env.CHROME_PATH ?? "/usr/bin/chromium";
const MAX_BODY = 4 * 1024 * 1024;
const log = (msg, extra = {}) =>
  process.stdout.write(`${JSON.stringify({ time: new Date().toISOString(), msg, ...extra })}\n`);

let browserPromise = null;
function browser() {
  if (!browserPromise) {
    browserPromise = puppeteer
      .launch({
        executablePath: CHROME,
        headless: true,
        args: [
          // The container is the sandbox: unprivileged user, read-only filesystem, no network.
          "--no-sandbox",
          "--disable-gpu",
          "--disable-dev-shm-usage",
          "--font-render-hinting=none",
          "--disable-extensions",
          "--disable-background-networking",
          "--no-first-run",
        ],
      })
      .then((b) => {
        b.on("disconnected", () => {
          browserPromise = null;
        });
        return b;
      })
      .catch((e) => {
        browserPromise = null;
        throw e;
      });
  }
  return browserPromise;
}

async function render({ html, footer }) {
  const page = await (await browser()).newPage();
  try {
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const url = req.url();
      if (url.startsWith("data:") || url === "about:blank") void req.continue();
      else void req.abort("blockedbyclient");
    });
    await page.setContent(html, { waitUntil: "load", timeout: 15_000 });
    return await page.pdf({
      preferCSSPageSize: true,
      printBackground: true,
      displayHeaderFooter: Boolean(footer),
      headerTemplate: "<span></span>",
      footerTemplate: footer ?? "<span></span>",
      tagged: true,
      timeout: 30_000,
    });
  } finally {
    await page.close().catch(() => undefined);
  }
}

// One render at a time: predictable memory on a small server.
let queue = Promise.resolve();
const enqueue = (job) => {
  const run = queue.then(job, job);
  queue = run.catch(() => undefined);
  return run;
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("body too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
    return;
  }
  if (req.method !== "POST" || req.url !== "/render") {
    res.writeHead(404).end();
    return;
  }
  const started = Date.now();
  try {
    const body = JSON.parse(await readBody(req));
    if (typeof body.html !== "string") throw new Error("html required");
    const pdf = await enqueue(() => render(body));
    res.writeHead(200, { "content-type": "application/pdf", "content-length": pdf.length });
    res.end(pdf);
    log("rendered", { ms: Date.now() - started, bytes: pdf.length });
  } catch (e) {
    log("render failed", { error: e instanceof Error ? e.message : String(e) });
    res.writeHead(500, { "content-type": "application/json" }).end('{"error":"render_failed"}');
  }
});

server.listen(PORT, "0.0.0.0", () => log("listening", { port: PORT }));
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, async () => {
    server.close();
    if (browserPromise) await (await browserPromise).close().catch(() => undefined);
    process.exit(0);
  });
