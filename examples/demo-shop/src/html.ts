/** HTML helpers for the demo shop. Every dynamic value goes through `esc` (or `raw` for markup we build). */

export interface Html {
  readonly html: string;
}

export const raw = (html: string): Html => ({ html });

export function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Tagged template: interpolations are escaped unless they are `Html` (or arrays of it). */
export function html(strings: TemplateStringsArray, ...values: unknown[]): Html {
  let out = strings[0]!;
  values.forEach((v, i) => {
    const render = (x: unknown): string =>
      Array.isArray(x)
        ? x.map(render).join("")
        : x && typeof x === "object" && "html" in x
          ? (x as Html).html
          : x === false || x === null || x === undefined
            ? ""
            : esc(x);
    out += render(v) + strings[i + 1]!;
  });
  return raw(out);
}

export const short = (s: string, head = 6, tail = 4) =>
  s.length > head + tail + 1 ? `${s.slice(0, head)}…${s.slice(-tail)}` : s;

const NAV: [string, string][] = [
  ["/", "Home"],
  ["/terms", "1 · Terms"],
  ["/privacy", "2 · Privacy"],
  ["/checkout", "3 · Checkout"],
  ["/account", "4 · My acceptances"],
  ["/rewards", "5 · Rewards (Gate)"],
  ["/security", "6 · Security"],
  ["/webhooks", "7 · Webhooks"],
  ["/api-log", "8 · API log"],
];

const CSS = `
:root { --bg:#f7f6f2; --card:#fff; --ink:#18212b; --muted:#5b6672; --line:#e3e1da; --brand:#1f6f5c;
  --brand-soft:#e3f1ec; --warn:#a15c07; --warn-soft:#fdf3e3; --bad:#b42318; --bad-soft:#fdecea; }
* { box-sizing:border-box; }
body { margin:0; background:var(--bg); color:var(--ink); font:15px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif; }
a { color:var(--brand); }
header { background:var(--card); border-bottom:1px solid var(--line); }
.bar { max-width:1060px; margin:auto; padding:14px 20px; display:flex; align-items:center; gap:18px; flex-wrap:wrap; }
.logo { font-weight:800; letter-spacing:-.02em; font-size:18px; color:var(--ink); text-decoration:none; }
.logo span { color:var(--brand); }
nav { display:flex; gap:4px; flex-wrap:wrap; }
nav a { text-decoration:none; color:var(--muted); padding:6px 10px; border-radius:8px; font-size:14px; }
nav a.on, nav a:hover { background:var(--brand-soft); color:var(--brand); }
.who { margin-left:auto; font-size:13px; color:var(--muted); display:flex; gap:10px; align-items:center; }
main { max-width:1060px; margin:28px auto 60px; padding:0 20px; }
h1 { font-size:30px; letter-spacing:-.02em; margin:0 0 6px; }
h2 { font-size:19px; margin:28px 0 10px; }
.lead { color:var(--muted); max-width:720px; margin:0 0 22px; }
.grid { display:grid; gap:16px; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); }
.two { display:grid; gap:24px; grid-template-columns:minmax(0,1.35fr) minmax(0,1fr); align-items:start; }
@media (max-width:860px) { .two { grid-template-columns:1fr; } }
.card { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:18px 20px; }
.card h3 { margin:0 0 6px; font-size:16px; }
.card p { margin:0; color:var(--muted); font-size:14px; }
.step { font:600 12px ui-monospace,monospace; color:var(--brand); }
.btn { display:inline-block; border:0; border-radius:10px; padding:10px 16px; background:var(--brand); color:#fff;
  font:600 14px inherit; text-decoration:none; cursor:pointer; }
.btn:disabled { opacity:.45; cursor:not-allowed; }
.btn.ghost { background:transparent; color:var(--brand); border:1px solid var(--line); }
input[type=text] { font:inherit; padding:10px 12px; border:1px solid var(--line); border-radius:10px; min-width:240px; }
.ok, .no, .warn { display:inline-flex; gap:6px; align-items:center; padding:3px 10px; border-radius:999px; font-size:13px; font-weight:600; }
.ok { background:var(--brand-soft); color:var(--brand); }
.no { background:var(--bad-soft); color:var(--bad); }
.warn { background:var(--warn-soft); color:var(--warn); }
table { width:100%; border-collapse:collapse; font-size:13.5px; background:var(--card); border:1px solid var(--line); border-radius:12px; overflow:hidden; }
th, td { text-align:left; padding:9px 12px; border-top:1px solid var(--line); vertical-align:top; }
th { background:#fbfaf7; color:var(--muted); font-weight:600; border-top:0; }
code, .mono { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12.5px; }
.explain { background:#fbfaf7; border:1px dashed var(--line); border-radius:12px; padding:14px 16px; font-size:13.5px; color:var(--muted); }
.explain strong { color:var(--ink); }
.explain ol { margin:6px 0 0; padding-left:20px; }
.empty { color:var(--muted); font-style:italic; }
#log { list-style:none; padding:0 !important; }
#log li { display:block; border-radius:10px; padding:7px 10px; margin:6px 0; line-height:1.45; }
footer { max-width:1060px; margin:0 auto 40px; padding:0 20px; color:var(--muted); font-size:12.5px; }
`;

export interface PageOptions {
  title: string;
  path: string;
  user: string | null;
  network: string;
  body: Html;
  head?: Html;
  refreshSeconds?: number;
}

export function page(o: PageOptions): string {
  return html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        ${o.refreshSeconds ? raw(`<meta http-equiv="refresh" content="${o.refreshSeconds}" />`) : ""}
        <title>${o.title} · Northwind Shop</title>
        <style>
          ${raw(CSS)}
        </style>
        ${o.head ?? ""}
      </head>
      <body>
        <header>
          <div class="bar">
            <a class="logo" href="/">Northwind <span>Shop</span></a>
            <nav>
              ${NAV.map(([href, label]) => html`<a href="${href}" class="${o.path === href ? "on" : ""}">${label}</a>`)}
            </nav>
            <div class="who">
              ${
                o.user
                  ? html`Signed in as <strong>${o.user}</strong>
                      <form method="post" action="/logout" style="margin:0">
                        <button class="btn ghost" style="padding:4px 10px">Sign out</button>
                      </form>`
                  : html`<a href="/">Sign in</a>`
              }
            </div>
          </div>
        </header>
        <main>${o.body}</main>
        <footer>
          Demo integration of Stele on ${o.network}. Everything here uses the public Stele SDK and
          API; see examples/demo-shop in the repository.
        </footer>
      </body>
    </html>`.html;
}
