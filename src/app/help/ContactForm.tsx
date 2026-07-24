"use client";

import { useState } from "react";

/**
 * Get Help contact form. Plain controlled inputs + fetch, matching the rest
 * of the codebase's forms (see AuthForm) rather than pulling in a form
 * library for three fields.
 */
export function ContactForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, message }),
      });
      if (!res.ok) throw new Error();
      setSent(true);
    } catch {
      setError("Something went wrong sending that. Try again in a moment.");
    } finally {
      setPending(false);
    }
  }

  if (sent) {
    return (
      <p className="rounded-[14px] border border-black/10 bg-white px-4 py-3 text-[14.5px] text-text-body">
        Thanks — we got your message and will get back to you soon.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm font-semibold">
        Name
        <input
          type="text"
          required
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="rounded-[14px] border border-black/10 bg-white px-4 py-2.5 font-normal outline-none focus:border-mint"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm font-semibold">
        Email
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="rounded-[14px] border border-black/10 bg-white px-4 py-2.5 font-normal outline-none focus:border-mint"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm font-semibold">
        Message
        <textarea
          required
          rows={5}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className="resize-none rounded-[14px] border border-black/10 bg-white px-4 py-2.5 font-normal outline-none focus:border-mint"
        />
      </label>

      {error && <p className="text-sm text-coral">{error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="mt-2 self-start rounded-[100px] bg-coral px-5 py-2.5 font-bold text-white shadow-[0_4px_14px_rgba(226,114,90,0.35)] transition-opacity disabled:opacity-60"
      >
        {pending ? "Sending…" : "Send message"}
      </button>
    </form>
  );
}
