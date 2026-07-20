"use client";

import { useState } from "react";
import { NewMessage, type ContactSuggestion } from "./NewMessage";

/** Opens the net-new compose dialog. Lives in the rail, above the contact list. */
export function NewMessageButton({
  contacts,
}: {
  contacts: ContactSuggestion[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-full bg-coral py-2.5 text-[13px] font-extrabold text-white shadow-[0_4px_12px_oklch(0.5_0.12_25_/_0.4)] transition-opacity hover:opacity-90"
      >
        New message
      </button>

      {open && (
        <NewMessage contacts={contacts} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
