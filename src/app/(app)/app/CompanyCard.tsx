"use client";

import { useState } from "react";
import { MessageMenu } from "./MessageMenu";
import { MessageModal } from "./MessageModal";
import { AttachmentList } from "@/components/ui/AttachmentChip";
import { ReactionBadges } from "@/components/ui/ReactionBadges";
import { bubbleTime, dayDividerLabel } from "@/lib/format";
import type { CompanyMessage } from "./CompanyPane";

/**
 * One message in the Companies/Spam list view.
 *
 * The context menu wraps the whole card — subject line included — so
 * right-clicking anywhere on it works. That means the card, not the body,
 * owns the full-message modal, since both the menu and the inline expand link
 * need to open it.
 */
export function CompanyCard({
  message,
  threadLabel,
}: {
  message: CompanyMessage;
  threadLabel: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <MessageMenu
        messageId={message.id}
        onShowFull={message.truncated ? () => setOpen(true) : undefined}
      >
        <div className="rounded-[14px] border border-black/[0.06] bg-white p-4 shadow-[0_2px_8px_rgba(0,0,0,0.05)]">
          <div className="mb-1.5 flex items-baseline justify-between gap-4">
            <h3 className="min-w-0 flex-1 font-display text-[15px] font-bold text-text-body">
              {message.subject ?? "(no subject)"}
            </h3>
            <span className="shrink-0 text-[11.5px] text-text-muted-3">
              {dayDividerLabel(message.sentAt)} · {bubbleTime(message.sentAt)}
            </span>
          </div>

          <p className="whitespace-pre-wrap break-words text-[14px] leading-[1.5] text-text-muted">
            {message.body ?? ""}
          </p>

          {message.htmlOnly && (
            <p className="mt-2 text-[11px] text-text-muted-3">
              HTML email — preview only
            </p>
          )}

          <AttachmentList attachments={message.attachments} />

          {message.reactions.length > 0 && (
            <div className="mt-2">
              <ReactionBadges reactions={message.reactions} />
            </div>
          )}
        </div>
      </MessageMenu>

      <MessageModal
        open={open}
        onClose={() => setOpen(false)}
        title={message.subject ?? "(no subject)"}
        subtitle={threadLabel}
        body={message.fullBody}
      />
    </>
  );
}
