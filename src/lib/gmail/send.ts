import "server-only";
import { google } from "googleapis";
import { getAuthorizedClient } from "@/lib/gmail/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { canonicalAddress, parseAddress } from "@/lib/email/addresses";
import {
  buildRawMessage,
  buildReferences,
  deriveSubject,
  replySubject,
} from "@/lib/email/mime";
import {
  buildReactionMessage,
  canReactTo,
  isSingleEmoji,
} from "@/lib/email/reactions";
import type { EmailAccount } from "@/lib/types";

/**
 * Sending via the Gmail API (MVP build step 6).
 *
 * Two shapes:
 *   - reply:   lands inside an existing conversation. Needs threadId on the
 *              request plus In-Reply-To and References headers.
 *   - net-new: starts a fresh conversation with typed recipients.
 *
 * The `gmail.modify` scope already granted at connect time covers sending, so
 * no re-consent is needed.
 */

export const MAX_CHAT_LENGTH = 365;

export interface SendResult {
  gmailMessageId: string;
  gmailThreadId: string | null;
}

/** Pick the most recent message in a thread — the one a reply should attach to. */
async function latestMessageInThread(threadId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("messages")
    .select(
      "gmail_thread_id, message_id_header, references_header, subject, from_address, to_addresses, cc_addresses",
    )
    .eq("thread_id", threadId)
    .order("internal_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as {
    gmail_thread_id: string | null;
    message_id_header: string | null;
    references_header: string | null;
    subject: string | null;
    from_address: string | null;
    to_addresses: string[] | null;
    cc_addresses: string[] | null;
  } | null;
}

/**
 * Reply within an existing thread.
 *
 * Recipients are derived from the thread's participant set rather than the
 * parent's To/From, so a group conversation keeps everyone included and the
 * user is never sent a copy of their own message.
 */
export async function sendReply(
  account: EmailAccount,
  threadId: string,
  body: string,
): Promise<SendResult> {
  const admin = createAdminClient();

  const { data: thread, error: threadError } = await admin
    .from("threads")
    .select("participant_set")
    .eq("id", threadId)
    .single();
  if (threadError) throw threadError;

  const participants = (thread as { participant_set: string[] })
    .participant_set;
  const selfCanonical = canonicalAddress(account.email);
  const recipients = participants.filter(
    (p) => canonicalAddress(p) !== selfCanonical,
  );
  if (recipients.length === 0) {
    // Self-thread: reply to yourself so the message still has a destination.
    recipients.push(account.email);
  }

  const parent = await latestMessageInThread(threadId);

  const raw = buildRawMessage({
    from: account.email,
    to: recipients,
    subject: replySubject(parent?.subject),
    body,
    inReplyTo: parent?.message_id_header ?? null,
    references: buildReferences(
      parent?.references_header,
      parent?.message_id_header,
    ),
  });

  const auth = await getAuthorizedClient(account);
  const gmail = google.gmail({ version: "v1", auth });

  const sent = await gmail.users.messages.send({
    userId: "me",
    requestBody: {
      raw,
      // Attaching to Gmail's own thread is what keeps the reply in the same
      // conversation on the recipient's side.
      ...(parent?.gmail_thread_id
        ? { threadId: parent.gmail_thread_id }
        : {}),
    },
  });

  return {
    gmailMessageId: sent.data.id ?? "",
    gmailThreadId: sent.data.threadId ?? null,
  };
}

/** Raised when a reaction can't be sent to this conversation's recipients. */
export class ReactionUnsupportedError extends Error {
  readonly code = "reaction_unsupported";
  constructor(message: string) {
    super(message);
    this.name = "ReactionUnsupportedError";
  }
}

/**
 * React to a specific message with an emoji.
 *
 * Unlike a reply, this targets one message (not the thread's latest) and is
 * gated on the recipients: a reaction sent somewhere it won't render arrives as
 * a short email instead, so `canReactTo` is a hard precondition rather than a
 * UI hint. The picker is only shown when it passes, but the server re-checks —
 * a client should never be the thing enforcing this.
 */
export async function sendReaction(
  account: EmailAccount,
  messageId: string,
  emoji: string,
): Promise<SendResult> {
  if (!isSingleEmoji(emoji)) {
    // Gmail silently drops a malformed reaction and sends the fallback as a
    // plain email, so reject before it can reach the wire.
    throw new ReactionUnsupportedError("That isn’t a single emoji.");
  }

  const admin = createAdminClient();

  // The exact message being reacted to — its Message-ID is the reaction's
  // In-Reply-To, and its thread supplies the recipients.
  const { data: target, error: targetError } = await admin
    .from("messages")
    .select(
      "thread_id, gmail_thread_id, message_id_header, references_header, subject",
    )
    .eq("id", messageId)
    .eq("user_id", account.user_id)
    .maybeSingle();
  if (targetError) throw targetError;
  if (!target) throw new Error("Message not found.");

  const targetRow = target as {
    thread_id: string | null;
    gmail_thread_id: string | null;
    message_id_header: string | null;
    references_header: string | null;
    subject: string | null;
  };
  if (!targetRow.message_id_header) {
    // Nothing to point In-Reply-To at; the reaction couldn't be attributed.
    throw new ReactionUnsupportedError(
      "This message can’t be reacted to yet.",
    );
  }

  // Recipients come from the thread's participant set, same as a reply, so a
  // group conversation keeps everyone included and the user isn't sent their
  // own reaction.
  const { data: thread, error: threadError } = await admin
    .from("threads")
    .select("participant_set")
    .eq("id", targetRow.thread_id ?? "")
    .maybeSingle();
  if (threadError) throw threadError;

  const participants =
    (thread as { participant_set: string[] } | null)?.participant_set ?? [];
  const selfCanonical = canonicalAddress(account.email);
  const recipients = participants.filter(
    (p) => canonicalAddress(p) !== selfCanonical,
  );
  if (recipients.length === 0) {
    // Self-thread: react to your own message. Always deliverable.
    recipients.push(account.email);
  }

  if (!canReactTo(recipients)) {
    throw new ReactionUnsupportedError(
      "Reactions only work when everyone in this conversation uses a client that supports them.",
    );
  }

  const raw = buildReactionMessage({
    from: account.email,
    to: recipients,
    inReplyTo: targetRow.message_id_header,
    references: buildReferences(
      targetRow.references_header,
      targetRow.message_id_header,
    ),
    subject: replySubject(targetRow.subject),
    emoji,
  });

  const auth = await getAuthorizedClient(account);
  const gmail = google.gmail({ version: "v1", auth });

  const sent = await gmail.users.messages.send({
    userId: "me",
    requestBody: {
      raw,
      ...(targetRow.gmail_thread_id
        ? { threadId: targetRow.gmail_thread_id }
        : {}),
    },
  });

  return {
    gmailMessageId: sent.data.id ?? "",
    gmailThreadId: sent.data.threadId ?? null,
  };
}

/** Start a brand-new conversation with the given recipients. */
export async function sendNewMessage(
  account: EmailAccount,
  recipients: string[],
  body: string,
): Promise<SendResult> {
  const cleaned = recipients
    .map((r) => parseAddress(r)?.address)
    .filter((r): r is string => Boolean(r));

  if (cleaned.length === 0) {
    throw new Error("No valid recipient address.");
  }

  const raw = buildRawMessage({
    from: account.email,
    to: cleaned,
    // Subject is generated silently: the chat view hides subjects, but an empty
    // one looks broken in the recipient's normal mail client.
    subject: deriveSubject(body),
    body,
  });

  const auth = await getAuthorizedClient(account);
  const gmail = google.gmail({ version: "v1", auth });

  const sent = await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw },
  });

  return {
    gmailMessageId: sent.data.id ?? "",
    gmailThreadId: sent.data.threadId ?? null,
  };
}
