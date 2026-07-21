import type { gmail_v1 } from "googleapis";

/**
 * Pulling real attachments out of a Gmail MIME tree.
 *
 * Pure and dependency-free so it can be tested against real payload shapes.
 *
 * "Real" is doing work here. Across a 40-message sample of the test mailbox,
 * 77 parts carried a filename but only 55 were things a person attached — the
 * other 22 were inline images: logos, spacer GIFs, signature graphics, tracking
 * pixels. Rendering those as attachment chips would put a paperclip on nearly
 * every newsletter and bury the actual documents.
 */

export interface ExtractedAttachment {
  gmailAttachmentId: string;
  filename: string;
  mimeType: string | null;
  sizeBytes: number | null;
}

/** Header lookup that tolerates Gmail's inconsistent header casing. */
function header(
  part: gmail_v1.Schema$MessagePart,
  name: string,
): string | null {
  const match = (part.headers ?? []).find(
    (h) => h.name?.toLowerCase() === name.toLowerCase(),
  );
  return match?.value ?? null;
}

/**
 * True when a part is embedded in the message body rather than attached to it.
 *
 * Two signals, either of which is sufficient:
 *   - `Content-ID`, which HTML references as `<img src="cid:...">`
 *   - `Content-Disposition: inline`
 */
function isInline(part: gmail_v1.Schema$MessagePart): boolean {
  if (header(part, "content-id")) return true;
  const disposition = header(part, "content-disposition") ?? "";
  return disposition.trim().toLowerCase().startsWith("inline");
}

/**
 * Calendar invites arrive twice — once as `text/calendar` and again as
 * `application/ics`, same bytes, same filename. Showing both would double every
 * meeting invite, so alternate encodings of an identical file collapse to one.
 */
const DUPLICATE_MIME_ALIASES = new Map([
  ["application/ics", "text/calendar"],
]);

function canonicalMime(mimeType: string | null): string | null {
  if (!mimeType) return null;
  const lower = mimeType.toLowerCase();
  return DUPLICATE_MIME_ALIASES.get(lower) ?? lower;
}

/**
 * Walk a message payload and collect the attachments worth showing.
 *
 * Returns them in the order encountered, deduplicated on
 * (filename, canonical mime, size).
 */
export function extractAttachments(
  payload: gmail_v1.Schema$MessagePart | undefined,
): ExtractedAttachment[] {
  if (!payload) return [];

  const found: ExtractedAttachment[] = [];
  const seen = new Set<string>();

  const visit = (part: gmail_v1.Schema$MessagePart) => {
    const filename = part.filename ?? "";
    const attachmentId = part.body?.attachmentId;

    // A part is an attachment when it has both a filename and a handle for its
    // bytes. Body parts have data inline and no filename; container parts
    // (multipart/*) have neither.
    if (filename.length > 0 && attachmentId && !isInline(part)) {
      const size = part.body?.size ?? null;
      const key = [
        filename.toLowerCase(),
        canonicalMime(part.mimeType ?? null) ?? "",
        size ?? "",
      ].join("|");

      if (!seen.has(key)) {
        seen.add(key);
        found.push({
          gmailAttachmentId: attachmentId,
          filename,
          mimeType: part.mimeType ?? null,
          sizeBytes: size,
        });
      }
    }

    for (const child of part.parts ?? []) visit(child);
  };

  visit(payload);
  return found;
}

/** Human-readable size for a chip label. Null size renders as no suffix. */
export function formatFileSize(bytes: number | null | undefined): string | null {
  if (bytes == null || bytes <= 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * A short label for the file type, shown on the chip's icon.
 *
 * Derived from the filename extension rather than the MIME type: senders set
 * MIME inconsistently (the same .ics arrives as two different types), while the
 * extension is what the user recognises.
 */
export function fileKindLabel(filename: string, mimeType: string | null): string {
  const ext = filename.includes(".")
    ? filename.slice(filename.lastIndexOf(".") + 1).toUpperCase()
    : "";
  if (ext && ext.length <= 4) return ext;
  if (mimeType?.startsWith("image/")) return "IMG";
  if (mimeType?.includes("pdf")) return "PDF";
  return "FILE";
}
