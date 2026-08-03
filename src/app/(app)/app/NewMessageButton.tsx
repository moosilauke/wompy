"use client";

import { useState } from "react";
import { NewMessage } from "./NewMessage";

/** Opens the net-new compose dialog. Lives in the rail, above the contact list.
 *
 * Recipient suggestions are fetched by the dialog itself when it opens, so
 * nothing about the address book is loaded or shipped until someone actually
 * starts a message. */
export function NewMessageButton() {
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

      {open && <NewMessage onClose={() => setOpen(false)} />}
    </>
  );
}
