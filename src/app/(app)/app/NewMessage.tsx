"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

const MAX_CHAT_LENGTH = 365;
// Deliberately permissive: real addresses are stranger than strict RFC subsets.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ContactSuggestion {
  address: string;
  label: string;
}

/**
 * Net-new compose: start a conversation with someone.
 *
 * The recipient field is a combobox — it suggests known contacts as you type but
 * accepts any address typed in full, so you can reach someone who has never
 * emailed you.
 *
 * No subject field: the chat view hides subjects by design, and one is derived
 * server-side so the message still looks normal in the recipient's mail client.
 */
export function NewMessage({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  // Fetched when the modal opens rather than passed down: the address book was
  // previously built on every render of the app page and serialized into the
  // RSC payload, including the overwhelming majority of renders where nobody
  // opens this. Typing is usable immediately — an address typed in full is
  // always accepted, so the list only ever accelerates the common case.
  const [contacts, setContacts] = useState<ContactSuggestion[]>([]);
  const [query, setQuery] = useState("");
  const [recipient, setRecipient] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [fullEmail, setFullEmail] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const res = await fetch("/api/contacts/suggestions");
        if (!active || !res.ok) return;
        const json = await res.json();
        if (active) setContacts(json.suggestions ?? []);
      } catch {
        // Suggestions are an accelerator, not a requirement — a full address
        // typed by hand works with or without them, so a failure here stays
        // silent rather than interrupting composing.
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Before anything is typed, the first few are the people the user
  // corresponds with most — the API returns them already ranked, so this is
  // just the top of that list rather than an arbitrary alphabetical slice.
  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contacts.slice(0, 6);
    return contacts
      .filter(
        (c) =>
          c.address.toLowerCase().includes(q) ||
          c.label.toLowerCase().includes(q),
      )
      .slice(0, 6);
  }, [contacts, query]);

  const typedIsValid = EMAIL_RE.test(query.trim());
  const chosen = recipient ?? (typedIsValid ? query.trim() : null);

  const remaining = MAX_CHAT_LENGTH - body.length;
  const overLimit = !fullEmail && remaining < 0;
  const canSend = Boolean(chosen) && body.trim().length > 0 && !overLimit && !sending;

  async function send() {
    if (!canSend || !chosen) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipients: [chosen], body, fullEmail }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.detail ?? json?.error ?? "Couldn’t send.");
        return;
      }
      onClose();
      // A full refresh here, unlike replies (see Composer): a net-new message
      // creates a thread the client has never seen, so there's no rail row to
      // patch and no open conversation to paint a bubble into. The rail itself
      // has to be rebuilt, which is exactly what this does.
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t send.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6">
      <div className="w-full max-w-lg rounded-[18px] bg-white p-5 shadow-[0_12px_40px_rgba(0,0,0,0.25)]">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-[17px] font-bold text-text-body">
            New message
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-2 py-1 text-[13px] font-bold text-text-muted hover:text-text-body"
          >
            Close
          </button>
        </div>

        {/* Recipient */}
        <label className="mb-1 block text-[12px] font-bold text-text-muted">
          To
        </label>
        {recipient ? (
          <div className="mb-3 flex items-center gap-2 rounded-[14px] bg-black/[0.04] px-3 py-2">
            <span className="flex-1 truncate text-[14px] font-semibold text-text-body">
              {recipient}
            </span>
            <button
              type="button"
              onClick={() => {
                setRecipient(null);
                setQuery("");
              }}
              className="text-[12px] font-bold text-text-muted hover:text-coral"
            >
              Change
            </button>
          </div>
        ) : (
          <div className="mb-3">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name or email address"
              autoFocus
              className="w-full rounded-[14px] border border-black/10 px-3.5 py-2.5 text-[14px] font-semibold outline-none focus:border-mint"
            />
            {(suggestions.length > 0 || typedIsValid) && (
              <ul className="mt-1.5 max-h-44 overflow-y-auto rounded-[14px] border border-black/[0.06] bg-white shadow-[0_2px_8px_rgba(0,0,0,0.05)]">
                {suggestions.map((c) => (
                  <li key={c.address}>
                    <button
                      type="button"
                      onClick={() => setRecipient(c.address)}
                      className="flex w-full flex-col items-start px-3.5 py-2 text-left hover:bg-black/[0.03]"
                    >
                      <span className="text-[13.5px] font-bold text-text-body">
                        {c.label}
                      </span>
                      <span className="text-[12px] text-text-muted">
                        {c.address}
                      </span>
                    </button>
                  </li>
                ))}
                {typedIsValid &&
                  !suggestions.some(
                    (s) => s.address === query.trim().toLowerCase(),
                  ) && (
                    <li>
                      <button
                        type="button"
                        onClick={() => setRecipient(query.trim())}
                        className="w-full px-3.5 py-2 text-left hover:bg-black/[0.03]"
                      >
                        <span className="text-[13.5px] font-bold text-spruce">
                          Send to {query.trim()}
                        </span>
                      </button>
                    </li>
                  )}
              </ul>
            )}
          </div>
        )}

        {/* Body */}
        <label className="mb-1 block text-[12px] font-bold text-text-muted">
          Message
        </label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          placeholder="Say something…"
          className="w-full resize-none rounded-[14px] border border-black/10 px-3.5 py-2.5 text-[14px] font-semibold outline-none focus:border-mint"
        />

        {error && (
          <p className="mt-2 text-[12.5px] font-bold text-coral">{error}</p>
        )}

        <div className="mt-3 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setFullEmail((v) => !v)}
            className="text-[12px] font-bold text-text-muted underline decoration-dotted underline-offset-2 hover:text-spruce"
          >
            {fullEmail ? "Back to a short message" : "Write a full email instead"}
          </button>

          <div className="flex items-center gap-3">
            {!fullEmail && (
              <span
                className={`text-[12px] font-bold ${
                  remaining < 0 ? "text-coral" : "text-text-muted-3"
                }`}
              >
                {remaining}
              </span>
            )}
            <button
              type="button"
              onClick={send}
              disabled={!canSend}
              className="rounded-full bg-coral px-5 py-2 text-[13px] font-extrabold text-white shadow-[0_4px_12px_oklch(0.5_0.12_25_/_0.4)] transition-opacity disabled:opacity-40"
            >
              {sending ? "Sending…" : "Send"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
