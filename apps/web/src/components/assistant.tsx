"use client";
/**
 * The AI assistant: a launcher in the corner and a chat panel. Answers stream from the API, which
 * grounds them in Stele's public documentation and — in the dashboard — in a summary of the selected
 * organization. The conversation lives in this tab only (sessionStorage); the server keeps nothing.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChatIcon, SendIcon, Spinner, XIcon, cn } from "@stele/ui";
import { usePlatform } from "@/lib/platform";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const STORE = "stele:assistant";

const SITE_SUGGESTIONS = [
  "What is Stele, in two sentences?",
  "How do I add terms acceptance to my web app?",
  "How does Stele Gate protect my Solana program?",
  "What does a Stele acceptance prove — and not prove?",
];
const DASHBOARD_SUGGESTIONS = [
  "What should I set up next?",
  "Why did my verification check fail, and what do I change?",
  "How do I get the Stele Verified badge?",
  "How do I connect Stele to my backend with webhooks?",
];

function csrfToken(): string | null {
  const m = /(?:^|;\s*)stele_csrf=([^;]+)/.exec(document.cookie);
  return m ? decodeURIComponent(m[1]!) : null;
}

function readStored(): Message[] {
  try {
    const raw = window.sessionStorage.getItem(STORE);
    return raw ? (JSON.parse(raw) as Message[]) : [];
  } catch {
    return [];
  }
}

function AnswerMarkdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children }) => {
          const url = href ?? "";
          const internal =
            url.startsWith("/") ||
            (typeof window !== "undefined" && url.startsWith(window.location.origin));
          return internal ? (
            <Link
              href={url.replace(window.location.origin, "") || "/"}
              className="text-accent underline"
            >
              {children}
            </Link>
          ) : (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="text-accent underline"
            >
              {children}
            </a>
          );
        },
        p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
        ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
        ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
        h1: ({ children }) => <p className="mb-1 mt-3 font-semibold">{children}</p>,
        h2: ({ children }) => <p className="mb-1 mt-3 font-semibold">{children}</p>,
        h3: ({ children }) => <p className="mb-1 mt-3 font-semibold">{children}</p>,
        pre: ({ children }) => (
          <pre className="my-2 overflow-x-auto rounded-lg border border-line bg-bg px-3 py-2 text-[12px] leading-relaxed">
            {children}
          </pre>
        ),
        code: ({ children, className }) => (
          <code
            className={cn(
              "font-mono text-[12px]",
              !className && "rounded bg-surface-3 px-1 py-0.5",
            )}
          >
            {children}
          </code>
        ),
        table: ({ children }) => (
          <div className="my-2 overflow-x-auto">
            <table className="text-[12.5px]">{children}</table>
          </div>
        ),
        th: ({ children }) => (
          <th className="border-b border-line px-2 py-1 text-left">{children}</th>
        ),
        td: ({ children }) => <td className="border-b border-line px-2 py-1">{children}</td>,
      }}
    >
      {text}
    </ReactMarkdown>
  );
}

export function AssistantWidget({ organizationId }: { organizationId?: string }) {
  const platform = usePlatform();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // null until read from this tab's storage: nothing is written back before that.
  const [stored, setMessages] = useState<Message[] | null>(null);
  const messages = useMemo(() => stored ?? [], [stored]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const dashboard = pathname.startsWith("/dashboard");

  useEffect(() => setMessages(readStored()), []);
  useEffect(() => {
    if (stored === null) return;
    try {
      window.sessionStorage.setItem(STORE, JSON.stringify(stored.slice(-24)));
    } catch {
      // storage unavailable: the conversation is not kept across pages
    }
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [stored]);
  useEffect(() => {
    if (open) field.current?.focus();
  }, [open]);

  const ask = useCallback(
    async (question: string) => {
      const q = question.trim();
      if (!q || busy) return;
      const history: Message[] = [...messages, { role: "user", content: q }];
      setMessages([...history, { role: "assistant", content: "" }]);
      setInput("");
      setError(null);
      setBusy(true);
      const controller = new AbortController();
      abort.current = controller;
      const append = (text: string) =>
        setMessages((ms) => {
          const next = [...(ms ?? [])];
          const last = next[next.length - 1]!;
          next[next.length - 1] = { ...last, content: last.content + text };
          return next;
        });
      try {
        const token = csrfToken();
        const res = await fetch("/api/v1/assistant/chat", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "text/event-stream",
            ...(token ? { "x-csrf-token": token } : {}),
          },
          credentials: "same-origin",
          body: JSON.stringify({
            messages: history.slice(-12),
            page: pathname.slice(0, 200),
            ...(dashboard && organizationId ? { organizationId } : {}),
          }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          const body = (await res.json().catch(() => null)) as {
            error?: { message?: string };
          } | null;
          throw new Error(body?.error?.message ?? "The assistant could not answer.");
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let end: number;
          while ((end = buf.indexOf("\n\n")) >= 0) {
            const block = buf.slice(0, end);
            buf = buf.slice(end + 2);
            const data = block
              .split("\n")
              .find((l) => l.startsWith("data:"))
              ?.slice(5)
              .trim();
            if (!data) continue;
            const e = JSON.parse(data) as
              | { type: "delta"; text: string }
              | { type: "searching"; query: string }
              | { type: "done" }
              | { type: "error"; message: string };
            if (e.type === "delta") {
              setSearching(null);
              append(e.text);
            } else if (e.type === "searching") setSearching(e.query);
            else if (e.type === "error") throw new Error(e.message);
          }
        }
      } catch (e) {
        if (!(e instanceof DOMException && e.name === "AbortError"))
          setError(e instanceof Error ? e.message : String(e));
        // Drop an empty answer bubble.
        setMessages((ms) => (ms?.at(-1)?.content === "" ? ms.slice(0, -1) : ms));
      } finally {
        setBusy(false);
        setSearching(null);
        abort.current = null;
      }
    },
    [busy, messages, pathname, dashboard, organizationId],
  );

  if (!platform?.assistant.enabled) return null;

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void ask(input);
    }
  };
  const suggestions = dashboard ? DASHBOARD_SUGGESTIONS : SITE_SUGGESTIONS;

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 rounded-full border border-accent-line bg-surface px-4 py-2.5 text-[13.5px] font-medium text-fg shadow-lg shadow-black/30 transition-colors hover:bg-surface-2"
        >
          <ChatIcon className="h-4 w-4 text-accent" />
          Ask Stele AI
        </button>
      )}
      {open && (
        <div
          role="dialog"
          aria-label="Stele assistant"
          onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
          className="fixed inset-0 z-50 flex flex-col bg-surface sm:inset-auto sm:bottom-5 sm:right-5 sm:h-[min(640px,calc(100dvh-40px))] sm:w-[420px] sm:rounded-2xl sm:border sm:border-line sm:shadow-2xl sm:shadow-black/40"
        >
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div>
              <p className="text-[14px] font-semibold text-fg">Stele assistant</p>
              <p className="text-[11.5px] text-fg-subtle">
                {dashboard && organizationId
                  ? "Knows the docs and your organization's setup"
                  : "Answers from Stele's documentation"}
              </p>
            </div>
            <div className="flex items-center gap-1">
              {messages.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    abort.current?.abort();
                    setMessages([]);
                    setError(null);
                  }}
                  className="rounded-md px-2 py-1 text-[12.5px] text-fg-muted hover:bg-surface-2 hover:text-fg"
                >
                  New chat
                </button>
              )}
              <button
                type="button"
                aria-label="Close the assistant"
                onClick={() => setOpen(false)}
                className="rounded-md p-1.5 text-fg-muted hover:bg-surface-2 hover:text-fg"
              >
                <XIcon className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div ref={list} className="flex-1 space-y-4 overflow-y-auto px-4 py-4" aria-live="polite">
            {messages.length === 0 ? (
              <div>
                <p className="text-[14px] leading-relaxed text-fg-muted">
                  Ask anything about Stele — setting up acceptance in your app, Stele Gate in your
                  Solana program, verification, pricing. Any language works.
                </p>
                <div className="mt-4 grid gap-2">
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => void ask(s)}
                      className="rounded-xl border border-line px-3 py-2 text-left text-[13px] text-fg hover:border-accent-line hover:bg-surface-2"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m, i) =>
                m.role === "user" ? (
                  <div key={i} className="flex justify-end">
                    <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-accent-soft px-3.5 py-2 text-[13.5px] text-fg">
                      {m.content}
                    </p>
                  </div>
                ) : (
                  <div key={i} className="break-words text-[13.5px] leading-relaxed text-fg">
                    {m.content ? (
                      <AnswerMarkdown text={m.content} />
                    ) : (
                      <span className="inline-flex items-center gap-2 text-fg-muted">
                        <Spinner className="h-3.5 w-3.5" />
                        {searching ? `Searching the docs: ${searching}` : "Thinking…"}
                      </span>
                    )}
                  </div>
                ),
              )
            )}
            {error && (
              <p
                role="alert"
                className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger"
              >
                {error}
              </p>
            )}
          </div>

          <div className="border-t border-line px-3 pb-3 pt-2">
            <div className="flex items-end gap-2 rounded-xl border border-line-strong bg-surface-2 px-3 py-2 focus-within:border-accent-line">
              <textarea
                ref={field}
                aria-label="Your question"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKey}
                rows={1}
                maxLength={4000}
                placeholder="Ask a question…"
                className="max-h-32 min-h-[24px] flex-1 resize-none bg-transparent text-[13.5px] text-fg outline-none placeholder:text-fg-subtle"
              />
              <button
                type="button"
                aria-label="Send"
                disabled={busy || !input.trim()}
                onClick={() => void ask(input)}
                className="grid h-8 w-8 place-items-center rounded-lg bg-accent text-accent-ink disabled:opacity-40"
              >
                {busy ? <Spinner className="h-4 w-4" /> : <SendIcon className="h-4 w-4" />}
              </button>
            </div>
            <p className="mt-1.5 px-1 text-[11px] leading-snug text-fg-subtle">
              AI answers can be wrong — check the docs. Never share keys or personal data. Questions
              are sent to OpenAI (
              <Link href="/privacy" className="underline">
                Privacy
              </Link>
              ).
            </p>
          </div>
        </div>
      )}
    </>
  );
}
