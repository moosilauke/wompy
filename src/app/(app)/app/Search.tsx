"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar } from "./Avatar";
import { railTimestamp } from "@/lib/format";
import type { ContactTab } from "@/lib/types";

/**
 * Search, in the top bar.
 *
 * Results are people first, then messages — the contact-centric model means
 * most searches are "where's that thread with Sarah" rather than a document
 * hunt. Picking either lands in the conversation.
 *
 * Queries run against Postgres full-text search over an excerpted copy of each
 * body, so a hit means the sender actually wrote that word rather than quoted
 * it from someone else.
 */

interface ContactHit {
  address: string;
  display_name: string | null;
  tab: ContactTab;
  thread_id: string | null;
}

interface MessageHit {
  id: string;
  thread_id: string | null;
  from_address: string | null;
  subject: string | null;
  snippet: string | null;
  internal_date: string | null;
  tab: ContactTab;
}

const DEBOUNCE_MS = 180;

export function Search() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [contacts, setContacts] = useState<ContactHit[]>([]);
  const [messages, setMessages] = useState<MessageHit[]>([]);
  const [loading, setLoading] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  // Guards against a slow early request overwriting a later, more specific one.
  const requestId = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();
    // Clearing is handled in the change handler, so the effect only ever runs
    // for a query that will actually be fetched.
    if (!trimmed) return;

    const id = ++requestId.current;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/search?q=${encodeURIComponent(trimmed)}`,
        );
        const data = await res.json();
        if (id !== requestId.current) return; // a newer query has superseded this
        setContacts(data.contacts ?? []);
        setMessages(data.messages ?? []);
      } catch {
        if (id === requestId.current) {
          setContacts([]);
          setMessages([]);
        }
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query]);

  // Dismiss on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const go = useCallback(
    (tab: ContactTab, threadId: string | null) => {
      if (!threadId) return;
      setOpen(false);
      setQuery("");
      router.push(`/app?tab=${tab}&thread=${threadId}`);
    },
    [router],
  );

  const hasResults = contacts.length > 0 || messages.length > 0;
  const trimmed = query.trim();

  return (
    <div ref={rootRef} className="relative w-[320px]">
      <input
        type="search"
        value={query}
        onChange={(e) => {
          const next = e.target.value;
          setQuery(next);
          setOpen(true);
          if (next.trim()) {
            setLoading(true);
          } else {
            // Reset immediately so stale results never flash for an empty box.
            requestId.current += 1;
            setContacts([]);
            setMessages([]);
            setLoading(false);
          }
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search people or messages"
        aria-label="Search people or messages"
        className="w-full rounded-[14px] border border-spruce-edge bg-spruce-raised px-3.5 py-2 text-sm font-semibold text-white placeholder:text-on-spruce-muted focus:border-mint/40 focus:outline-none"
      />

      {open && trimmed !== "" && (
        <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-50 max-h-[70vh] overflow-y-auto rounded-[14px] border border-black/[0.06] bg-white py-1.5 shadow-[0_16px_44px_rgba(0,0,0,0.24)]">
          {loading && !hasResults && (
            <p className="px-4 py-3 text-[13px] text-text-muted">Searching…</p>
          )}

          {!loading && !hasResults && (
            <p className="px-4 py-3 text-[13px] text-text-muted">
              Nothing matches “{trimmed}”.
            </p>
          )}

          {contacts.length > 0 && (
            <>
              <p className="px-4 pb-1 pt-2 text-[11px] font-extrabold uppercase tracking-[0.6px] text-text-muted-3">
                People
              </p>
              {contacts.map((c) => (
                <button
                  key={c.address}
                  type="button"
                  onClick={() => go(c.tab, c.thread_id)}
                  disabled={!c.thread_id}
                  className="flex w-full items-center gap-2.5 px-4 py-2 text-left transition-colors hover:bg-black/[0.04] disabled:opacity-40"
                >
                  <Avatar
                    address={c.address}
                    label={c.display_name || c.address}
                    size={28}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-bold text-text-body">
                      {c.display_name || c.address.split("@")[0]}
                    </span>
                    <span className="block truncate text-[12px] text-text-muted">
                      {c.address}
                    </span>
                  </span>
                </button>
              ))}
            </>
          )}

          {messages.length > 0 && (
            <>
              <p className="px-4 pb-1 pt-2.5 text-[11px] font-extrabold uppercase tracking-[0.6px] text-text-muted-3">
                Messages
              </p>
              {messages.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => go(m.tab, m.thread_id)}
                  className="block w-full px-4 py-2 text-left transition-colors hover:bg-black/[0.04]"
                >
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-[13px] font-bold text-text-body">
                      {m.from_address?.replace(/\s*<[^>]*>/, "") ??
                        "(unknown sender)"}
                    </span>
                    <span className="shrink-0 text-[11px] text-text-muted-3">
                      {railTimestamp(m.internal_date)}
                    </span>
                  </span>
                  <Highlighted text={m.snippet ?? ""} />
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Render ts_headline output, which marks hits with << >>.
 *
 * Split rather than injected as HTML: the text is untrusted mail content, and
 * dangerouslySetInnerHTML on it would be an XSS hole.
 */
function Highlighted({ text }: { text: string }) {
  const parts = text.split(/(<<[^>]*?>>)/g);
  return (
    <span className="mt-0.5 block truncate text-[12.5px] text-text-muted">
      {parts.map((part, i) =>
        part.startsWith("<<") && part.endsWith(">>") ? (
          <mark
            key={i}
            className="bg-mint/40 text-text-body"
          >
            {part.slice(2, -2)}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </span>
  );
}
