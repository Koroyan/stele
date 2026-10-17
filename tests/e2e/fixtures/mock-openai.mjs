/**
 * A stand-in for OpenAI's chat completions in end-to-end tests and local development: it streams a
 * fixed answer that quotes the question, so tests never spend a real key.
 *
 *   node tests/e2e/fixtures/mock-openai.mjs     # http://127.0.0.1:4510/v1
 *   OPENAI_API_KEY=mock OPENAI_BASE_URL=http://127.0.0.1:4510/v1 pnpm dev:api
 */
import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_OPENAI_PORT ?? 4510);

createServer((req, res) => {
  if (req.method !== "POST" || !req.url?.endsWith("/chat/completions")) {
    res.writeHead(404).end();
    return;
  }
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const { messages } = JSON.parse(body);
    const question = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const system = messages[0]?.content ?? "";
    const org = /"name": "([^"]+)"/.exec(system)?.[1];
    const words = [
      "Mock answer to: ",
      `“${question}”. `,
      org ? `Your organization: ${org}. ` : "",
      "See [Get started](http://localhost:3000/docs/get-started).",
    ];
    res.writeHead(200, { "content-type": "text/event-stream" });
    for (const w of words.filter(Boolean))
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: w } }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
}).listen(PORT, "127.0.0.1", () => console.log(`mock OpenAI on http://127.0.0.1:${PORT}/v1`));
