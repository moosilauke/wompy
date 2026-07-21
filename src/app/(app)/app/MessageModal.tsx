"use client";

import { Modal, ModalHeader } from "@/components/ui/Modal";

/**
 * Full-message view.
 *
 * Bubbles show a trimmed excerpt; this is where the whole thing lives. Shown as
 * a modal rather than inline expansion so a long message can't push the rest of
 * the conversation off screen — the chat view's shape is the point.
 *
 * `body_html` is still never injected: this renders the plain-text body.
 */
export function MessageModal({
  open,
  onClose,
  title,
  subtitle,
  body,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string | null;
  body: string;
}) {
  return (
    <Modal open={open} onClose={onClose} label={title}>
      <ModalHeader title={title} subtitle={subtitle} onClose={onClose} />
      <div className="overflow-y-auto px-6 py-5">
        <p className="whitespace-pre-wrap break-words text-[14.5px] leading-[1.6] text-text-body">
          {body}
        </p>
      </div>
    </Modal>
  );
}
