/**
 * Stele as a customer of itself: the dashboard user's status on Stele's own Terms (an ordinary
 * acceptance), the contact form and its staff-only inbox, and the AI assistant (documentation
 * search, tool calls, streaming, limits) against a fake OpenAI endpoint.
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acceptances, documents, documentVersions, eq, organizations } from "@stele/db";
import { toBase58 } from "@stelehq/protocol";
import {
  Knowledge,
  answer,
  passagesOf,
  tokenize,
  type AssistantEvent,
} from "../src/services/assistant.js";
import { keypairBytes, login, makeApp, testConfig, type Session, type TestApp } from "./helpers.js";

const addr = () => toBase58(new Uint8Array(randomBytes(32)));
const PLATFORM = addr();
const adminKey = keypairBytes();
const ADMIN = toBase58(adminKey.slice(32));

let t: TestApp;
let admin: Session;
let user: Session;
let termsDocId: string;
let orgId: string;

async function publishTerms(number: number) {
  const address = addr();
  await t.deps.db.insert(documentVersions).values({
    documentId: termsDocId,
    organizationId: orgId,
    address,
    number,
    versionHash: randomBytes(32).toString("hex"),
    contentHash: randomBytes(32).toString("hex"),
    title: "Stele Terms of Service",
    versionLabel: `${number}.0`,
    publishedAt: new Date(),
    publishedSlot: number,
    publisherAddress: addr(),
    publisherRole: 1,
    storageUri: "https://example.test/c",
  });
  await t.deps.db
    .update(documents)
    .set({ currentVersionAddress: address, versionCount: number })
    .where(eq(documents.id, termsDocId));
  return address;
}

beforeAll(async () => {
  t = await makeApp({
    config: testConfig({
      STELE_PLATFORM_ORGANIZATION: PLATFORM,
      STELE_PLATFORM_ADMINS: ADMIN,
      OPENAI_API_KEY: "sk-test",
      OPENAI_MODEL: "gpt-5-mini",
      STELE_ASSISTANT_PER_IP_HOUR: "3",
    }),
  });
  admin = await login(t.app, adminKey);
  user = await login(t.app, keypairBytes());
  const [org] = await t.deps.db
    .insert(organizations)
    .values({ address: PLATFORM, creatorAddress: ADMIN, name: "Stele", ownerAddress: ADMIN })
    .returning();
  orgId = org!.id;
  const [doc] = await t.deps.db
    .insert(documents)
    .values({
      organizationId: orgId,
      address: addr(),
      slug: "terms-of-service",
      documentType: "terms-of-service",
      locale: "en-US",
      versionCount: 0,
    })
    .returning();
  termsDocId = doc!.id;
});
afterAll(async () => {
  await t.close();
});

const me = async (s: Session) =>
  (await t.app.inject({ method: "GET", url: "/v1/auth/me", headers: s.headers })).json() as {
    terms: {
      accepted: boolean;
      version: { number: number };
      acceptedVersion: number | null;
    } | null;
    platformAdmin: boolean;
  };

describe("Stele's own Terms", () => {
  it("are required once published, and satisfied by accepting the current version", async () => {
    expect((await me(user)).terms).toBeNull();
    const v1 = await publishTerms(1);
    expect((await me(user)).terms).toMatchObject({ accepted: false, version: { number: 1 } });

    let n = 0;
    const accept = (version: number, versionAddress: string) =>
      t.deps.db.insert(acceptances).values({
        acceptanceId: randomBytes(32).toString("hex"),
        organizationId: orgId,
        documentId: termsDocId,
        versionAddress,
        versionNumber: version,
        signerAddress: user.address,
        txSignature: `terms${n++}`,
        slot: n,
        issuedAt: 1,
        expiresAt: 2,
        nonceShardAddress: addr(),
        nonceIndex: n,
        messageHash: "00",
        requestDomain: "localhost",
      });
    await accept(1, v1);
    expect((await me(user)).terms).toMatchObject({ accepted: true });

    // A new version: asked again, and told which one was accepted before.
    await publishTerms(2);
    expect((await me(user)).terms).toMatchObject({ accepted: false, acceptedVersion: 1 });
  });

  it("are listed publicly with the assistant's availability", async () => {
    const res = await t.app.inject({ method: "GET", url: "/v1/public/platform" });
    expect(res.json()).toMatchObject({
      organization: PLATFORM,
      terms: { slug: "terms-of-service", version: { number: 2 } },
      privacy: null,
      assistant: { enabled: true },
    });
  });
});

describe("contact inbox", () => {
  const message = {
    topic: "partnership",
    name: "Nino",
    email: "nino@example.com",
    company: "Acme",
    message: "We would like to integrate Stele Gate in our vault.",
  };

  it("stores a message and shows it to Stele's staff only", async () => {
    const sent = await t.app.inject({
      method: "POST",
      url: "/v1/public/contact",
      payload: message,
    });
    expect(sent.statusCode, sent.body).toBe(200);
    expect((await me(admin)).platformAdmin).toBe(true);
    expect((await me(user)).platformAdmin).toBe(false);

    const denied = await t.app.inject({
      method: "GET",
      url: "/v1/admin/contact",
      headers: user.headers,
    });
    expect(denied.statusCode).toBe(403);
    const inbox = await t.app.inject({
      method: "GET",
      url: "/v1/admin/contact",
      headers: admin.headers,
    });
    const { requests, counts } = inbox.json() as {
      requests: { id: string; email: string; status: string }[];
      counts: Record<string, number>;
    };
    expect(requests[0]).toMatchObject({ email: "nino@example.com", status: "new" });
    expect(counts.new).toBe(1);

    const read = await t.app.inject({
      method: "PATCH",
      url: `/v1/admin/contact/${requests[0]!.id}`,
      headers: admin.headers,
      payload: { status: "replied", note: "Call on Monday" },
    });
    expect(read.json()).toMatchObject({ request: { status: "replied", note: "Call on Monday" } });
  });

  it("refuses invalid messages and stores nothing from bots", async () => {
    const bad = await t.app.inject({
      method: "POST",
      url: "/v1/public/contact",
      payload: { ...message, email: "not-an-email" },
    });
    expect(bad.statusCode).toBe(400);
    const bot = await t.app.inject({
      method: "POST",
      url: "/v1/public/contact",
      payload: { ...message, fax: "http://spam.example" },
    });
    expect(bot.statusCode).toBe(200);
    const inbox = await t.app.inject({
      method: "GET",
      url: "/v1/admin/contact",
      headers: admin.headers,
    });
    expect((inbox.json() as { requests: unknown[] }).requests).toHaveLength(1);
  });

  it("limits one sender to a few messages an hour", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 6; i++)
      codes.push(
        (await t.app.inject({ method: "POST", url: "/v1/public/contact", payload: message }))
          .statusCode,
      );
    expect(codes.slice(0, 4)).toEqual([200, 200, 200, 200]);
    expect(codes.at(-1)).toBe(429);
  });
});

// ---- the assistant -----------------------------------------------------------------------------------

const DOCS = Knowledge.fromDocs([
  {
    slug: "gate-guide",
    title: "Gate guide",
    markdown:
      "# Gate guide\n\n## Pin the policy\n\nYour program calls require_current_passport with the policy it pins. InvalidPolicy means the program pins another policy.\n\n## Deploy\n\nDeploy with anchor deploy.",
  },
  {
    slug: "pricing",
    title: "Pricing",
    markdown: "# Pricing\n\nA free allowance of recordings every month, then credits paid in SOL.",
  },
]);

/** An OpenAI-style SSE body. */
function sse(chunks: unknown[]): Response {
  const body = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}

describe("assistant knowledge", () => {
  it("splits documents at headings and finds passages by their words", () => {
    expect(
      passagesOf({ slug: "x", title: "X", markdown: "# A\n\none\n\n## B\n\ntwo" }),
    ).toHaveLength(2);
    expect(tokenize("require_current_passport Policies")).toEqual([
      "require_current_passport",
      "require",
      "current",
      "passport",
      "policy",
    ]);
    const hit = DOCS.search("why InvalidPolicy?")[0];
    expect(hit).toMatchObject({ slug: "gate-guide", heading: "Pin the policy" });
    expect(DOCS.search("ქართული კითხვა")).toEqual([]);
  });
});

describe("assistant answers", () => {
  it("searches the documentation when the model asks, then streams the answer", async () => {
    const requests: { messages: { role: string; content: string | null }[]; tools?: unknown }[] =
      [];
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body)));
      if (requests.length === 1)
        return sse([
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "call_1",
                      function: { name: "search_docs", arguments: '{"query":' },
                    },
                  ],
                },
              },
            ],
          },
          {
            choices: [
              {
                delta: {
                  tool_calls: [{ index: 0, function: { arguments: '"InvalidPolicy pin"}' } }],
                },
                finish_reason: "tool_calls",
              },
            ],
          },
        ]);
      return sse([
        { choices: [{ delta: { content: "შენი პროგრამა " } }] },
        { choices: [{ delta: { content: "სხვა policy-ს ამოწმებს." }, finish_reason: "stop" }] },
      ]);
    }) as unknown as typeof fetch;

    const events: AssistantEvent[] = [];
    await answer(
      t.deps,
      {
        messages: [{ role: "user", content: "რატომ მიწერს InvalidPolicy-ს?" }],
        page: "/dashboard/gate/verification",
        organization: '{"organization":{"name":"Acme"}}',
      },
      (e) => events.push(e),
      { fetch: fakeFetch, knowledge: DOCS },
    );
    expect(events).toEqual([
      { type: "searching", query: "InvalidPolicy pin" },
      { type: "delta", text: "შენი პროგრამა " },
      { type: "delta", text: "სხვა policy-ს ამოწმებს." },
      { type: "done" },
    ]);
    const system = requests[0]!.messages[0]!.content!;
    expect(system).toContain("Reply in the language of the user's last message");
    expect(system).toContain("/dashboard/gate/verification");
    expect(system).toContain('"name":"Acme"');
    // The tool's result went back to the model.
    const tool = requests[1]!.messages.find((m) => m.role === "tool")!;
    expect(tool.content).toContain("InvalidPolicy means the program pins another policy");
  });

  it("streams over HTTP, and limits questions per address", async () => {
    const ask = () =>
      t.app.inject({
        method: "POST",
        url: "/v1/assistant/chat",
        payload: { messages: [{ role: "user", content: "x" }], page: "/pricing" },
      });
    // The provider, faked for the whole process.
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      sse([{ choices: [{ delta: { content: "Hi" }, finish_reason: "stop" }] }])) as never;
    try {
      const first = await ask();
      expect(first.headers["content-type"]).toContain("text/event-stream");
      expect(first.body).toContain('event: delta\ndata: {"type":"delta","text":"Hi"}');
      expect(first.body).toContain("event: done");
      await ask();
      await ask();
      expect((await ask()).statusCode).toBe(429);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("refuses an organization the asker is not a member of", async () => {
    const res = await t.app.inject({
      method: "POST",
      url: "/v1/assistant/chat",
      headers: user.headers,
      payload: { messages: [{ role: "user", content: "help" }], organizationId: orgId },
    });
    expect(res.statusCode).toBe(404);
  });
});
