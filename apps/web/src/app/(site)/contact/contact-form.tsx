"use client";
/** The contact form: one message to Stele's inbox (Dashboard → Inbox, Stele staff only). */
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Alert, Button, Card, CheckCircleIcon, Field, Input, Select, Textarea } from "@stele/ui";
import { api, errorMessage } from "@/lib/api";

const TOPICS = [
  { value: "partnership", label: "Partnership" },
  { value: "integration", label: "Integration help" },
  { value: "enterprise", label: "Enterprise & pricing" },
  { value: "press", label: "Press" },
  { value: "other", label: "Something else" },
] as const;

export function ContactForm() {
  const [form, setForm] = useState({
    topic: "partnership",
    name: "",
    email: "",
    company: "",
    website: "",
    message: "",
    fax: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/v1/public/contact", {
        body: {
          ...form,
          company: form.company || null,
          website: form.website || null,
          fax: form.fax || undefined,
        },
      });
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (sent)
    return (
      <Card className="flex flex-col items-start gap-4 p-8">
        <span className="grid h-11 w-11 place-items-center rounded-full bg-verified-soft text-verified">
          <CheckCircleIcon className="h-6 w-6" />
        </span>
        <h2 className="text-[20px] font-semibold text-fg">Thank you — message sent</h2>
        <p className="text-[14.5px] leading-relaxed text-fg-muted">
          We&apos;ll reply to <span className="font-medium text-fg">{form.email}</span>. In the
          meantime, try the{" "}
          <Link href="/demo" className="text-accent hover:underline">
            live demo
          </Link>{" "}
          or read the{" "}
          <Link href="/docs/get-started" className="text-accent hover:underline">
            guides
          </Link>
          .
        </p>
      </Card>
    );

  return (
    <Card className="p-6 sm:p-8">
      <form onSubmit={(e) => void submit(e)} className="grid gap-5" noValidate={false}>
        <Field label="What is it about?" htmlFor="topic">
          <Select id="topic" value={form.topic} onChange={set("topic")}>
            {TOPICS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Your name" htmlFor="name">
            <Input id="name" required maxLength={120} value={form.name} onChange={set("name")} />
          </Field>
          <Field label="Work e-mail" htmlFor="email">
            <Input
              id="email"
              type="email"
              required
              maxLength={254}
              value={form.email}
              onChange={set("email")}
            />
          </Field>
          <Field label="Organization" htmlFor="company">
            <Input id="company" maxLength={120} value={form.company} onChange={set("company")} />
          </Field>
          <Field label="Website" htmlFor="website">
            <Input
              id="website"
              maxLength={200}
              placeholder="https://"
              value={form.website}
              onChange={set("website")}
            />
          </Field>
        </div>
        <Field label="Message" htmlFor="message" hint="What you are building, and how we can help.">
          <Textarea
            id="message"
            required
            minLength={10}
            maxLength={5000}
            rows={6}
            value={form.message}
            onChange={set("message")}
          />
        </Field>
        {/* Never shown to people: bots fill it in, and their messages are dropped. */}
        <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
          <label htmlFor="fax">Fax</label>
          <input id="fax" tabIndex={-1} autoComplete="off" value={form.fax} onChange={set("fax")} />
        </div>
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[12.5px] leading-relaxed text-fg-subtle">
            We use these details only to reply — see the{" "}
            <Link href="/privacy" className="text-accent hover:underline">
              Privacy Policy
            </Link>
            .
          </p>
          <Button type="submit" loading={busy} className="shrink-0">
            Send message
          </Button>
        </div>
      </form>
    </Card>
  );
}
