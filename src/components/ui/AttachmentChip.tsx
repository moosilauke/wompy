import { fileKindLabel, formatFileSize } from "@/lib/email/attachments";

export interface AttachmentInfo {
  id: string;
  filename: string;
  mimeType: string | null;
  sizeBytes: number | null;
}

/**
 * An attachment, shown as an inline chip inside the bubble rather than in a
 * separate tray — per the design spec, and because a chat bubble is where the
 * file's context lives.
 *
 * Downloads rather than previews: the bytes are untrusted content from a
 * stranger, and rendering them in our origin would be an XSS vector for
 * anything HTML- or SVG-shaped.
 */
export function AttachmentChip({
  attachment,
  outgoing = false,
}: {
  attachment: AttachmentInfo;
  outgoing?: boolean;
}) {
  const kind = fileKindLabel(attachment.filename, attachment.mimeType);
  const size = formatFileSize(attachment.sizeBytes);

  return (
    <a
      href={`/api/attachments/${attachment.id}`}
      download={attachment.filename}
      title={attachment.filename}
      className={`mt-2 flex max-w-full items-center gap-2.5 rounded-[12px] border px-2.5 py-2 transition-colors ${
        outgoing
          ? "border-white/20 bg-white/10 hover:bg-white/15"
          : "border-black/[0.07] bg-black/[0.02] hover:bg-black/[0.04]"
      }`}
    >
      <span
        aria-hidden
        className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] text-[9px] font-extrabold tracking-tight ${
          outgoing ? "bg-white/20 text-white" : "bg-mint text-white"
        }`}
      >
        {kind}
      </span>

      <span className="flex min-w-0 flex-col">
        <span
          className={`truncate text-[13px] font-bold ${
            outgoing ? "text-white" : "text-text-body"
          }`}
        >
          {attachment.filename}
        </span>
        {size && (
          <span
            className={`text-[11.5px] ${
              outgoing ? "text-white/60" : "text-text-muted-3"
            }`}
          >
            {size}
          </span>
        )}
      </span>
    </a>
  );
}

/** Renders a message's attachments, or nothing when there are none. */
export function AttachmentList({
  attachments,
  outgoing = false,
}: {
  attachments: AttachmentInfo[];
  outgoing?: boolean;
}) {
  if (attachments.length === 0) return null;
  return (
    <span className="flex flex-col">
      {attachments.map((a) => (
        <AttachmentChip key={a.id} attachment={a} outgoing={outgoing} />
      ))}
    </span>
  );
}
