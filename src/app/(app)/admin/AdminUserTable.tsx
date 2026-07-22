"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { railTimestamp } from "@/lib/format";
import type { AdminUser } from "@/lib/admin/users";

/**
 * The admin user list, with a per-row actions menu.
 *
 * Delete and Make/Remove admin are gated behind confirmation dialogs — delete
 * requires typing the target's email (a real double-confirm, not just a second
 * click), because it's irreversible and cascades to all their data. The server
 * additionally blocks self-delete and last-admin removal, so the UI guards are
 * convenience, not the safety net.
 */
export function AdminUserTable({
  users,
  currentUserId,
}: {
  users: AdminUser[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<
    | { kind: "delete"; user: AdminUser }
    | { kind: "make-admin"; user: AdminUser }
    | { kind: "remove-admin"; user: AdminUser }
    | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.error ?? json?.detail ?? "Action failed");
      }
      setConfirm(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overflow-x-auto rounded-[14px] border border-black/[0.06] bg-white shadow-[0_2px_8px_rgba(0,0,0,0.05)]">
      <table className="w-full text-left text-[13px]">
        <thead>
          <tr className="border-b border-black/[0.06] text-[11px] font-extrabold uppercase tracking-[0.5px] text-text-muted-3">
            <th className="px-4 py-3">Email</th>
            <th className="px-4 py-3">Created</th>
            <th className="px-4 py-3">Last login</th>
            <th className="px-4 py-3">Login</th>
            <th className="px-4 py-3">Mail</th>
            <th className="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr
              key={u.id}
              className="border-b border-black/[0.04] last:border-0"
            >
              <td className="px-4 py-3 font-bold text-text-body">
                <span className="flex items-center gap-2">
                  {u.email ?? "(no email)"}
                  {u.isAdmin && (
                    <span className="rounded-full bg-mint/20 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.4px] text-[oklch(0.5_0.1_175)]">
                      Admin
                    </span>
                  )}
                  {u.id === currentUserId && (
                    <span className="text-[11px] font-semibold text-text-muted-3">
                      you
                    </span>
                  )}
                </span>
              </td>
              <td className="px-4 py-3 text-text-muted">
                {railTimestamp(u.createdAt)}
              </td>
              <td className="px-4 py-3 text-text-muted">
                {u.lastSignInAt ? railTimestamp(u.lastSignInAt) : "never"}
              </td>
              <td className="px-4 py-3 text-text-muted">
                {u.providers.length > 0 ? u.providers.join(", ") : "—"}
              </td>
              <td className="px-4 py-3 text-text-muted">
                {u.mailProvider ?? "—"}
              </td>
              <td className="relative px-4 py-3 text-right">
                <button
                  type="button"
                  onClick={() =>
                    setOpenMenu(openMenu === u.id ? null : u.id)
                  }
                  aria-label="Actions"
                  className="rounded-md px-2 py-1 text-[16px] leading-none text-text-muted hover:bg-black/[0.04]"
                >
                  ⋯
                </button>

                {openMenu === u.id && (
                  <RowMenu
                    user={u}
                    onClose={() => setOpenMenu(null)}
                    onDelete={() => {
                      setOpenMenu(null);
                      setConfirm({ kind: "delete", user: u });
                    }}
                    onToggleAdmin={() => {
                      setOpenMenu(null);
                      setConfirm({
                        kind: u.isAdmin ? "remove-admin" : "make-admin",
                        user: u,
                      });
                    }}
                    onReset={() => {
                      setOpenMenu(null);
                      if (u.email) void act({ action: "reset-password", email: u.email });
                    }}
                  />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {confirm?.kind === "delete" && (
        <DeleteDialog
          user={confirm.user}
          busy={busy}
          error={error}
          onCancel={() => {
            setConfirm(null);
            setError(null);
          }}
          onConfirm={() =>
            void act({ action: "delete", userId: confirm.user.id })
          }
        />
      )}

      {(confirm?.kind === "make-admin" ||
        confirm?.kind === "remove-admin") && (
        <AdminDialog
          user={confirm.user}
          making={confirm.kind === "make-admin"}
          busy={busy}
          error={error}
          onCancel={() => {
            setConfirm(null);
            setError(null);
          }}
          onConfirm={() =>
            void act({
              action: confirm.kind,
              userId: confirm.user.id,
            })
          }
        />
      )}
    </div>
  );
}

function RowMenu({
  user,
  onClose,
  onDelete,
  onToggleAdmin,
  onReset,
}: {
  user: AdminUser;
  onClose: () => void;
  onDelete: () => void;
  onToggleAdmin: () => void;
  onReset: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useOutsideClose(ref, onClose);

  return (
    <div
      ref={ref}
      role="menu"
      className="absolute right-4 top-full z-20 mt-1 min-w-[170px] overflow-hidden rounded-[10px] border border-black/[0.06] bg-white py-1 text-left shadow-[0_8px_28px_rgba(0,0,0,0.18)]"
    >
      <button
        type="button"
        onClick={onToggleAdmin}
        className="block w-full px-3.5 py-2 text-[13px] font-bold text-text-body hover:bg-black/[0.04]"
      >
        {user.isAdmin ? "Remove admin" : "Make admin"}
      </button>
      {user.email && (
        <button
          type="button"
          onClick={onReset}
          className="block w-full px-3.5 py-2 text-[13px] font-bold text-text-body hover:bg-black/[0.04]"
        >
          Send password reset
        </button>
      )}
      <div className="my-1 border-t border-black/[0.06]" />
      <button
        type="button"
        onClick={onDelete}
        className="block w-full px-3.5 py-2 text-[13px] font-bold text-coral hover:bg-coral/10"
      >
        Delete user
      </button>
    </div>
  );
}

/** Delete: irreversible, so it requires typing the exact email to confirm. */
function DeleteDialog({
  user,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  user: AdminUser;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [typed, setTyped] = useState("");
  const matches = typed.trim() === (user.email ?? "");

  return (
    <Modal open onClose={onCancel} label="Delete user" maxWidth={440}>
      <div className="px-6 py-5">
        <h2 className="font-display text-[18px] font-bold text-text-body">
          Delete this user?
        </h2>
        <p className="mt-2 text-[13.5px] text-text-muted">
          This permanently deletes{" "}
          <span className="font-bold text-text-body">{user.email}</span> and all
          their data — mail, threads, everything. It can’t be undone.
        </p>
        <p className="mt-4 text-[12.5px] font-semibold text-text-muted">
          Type <span className="font-bold text-text-body">{user.email}</span> to
          confirm:
        </p>
        <input
          type="text"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          className="mt-1.5 w-full rounded-[10px] border border-black/15 px-3 py-2 text-[13px] outline-none focus:border-coral"
        />
        {error && <p className="mt-2 text-[12.5px] text-coral">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full px-4 py-2 text-[13px] font-bold text-text-muted hover:bg-black/[0.04]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!matches || busy}
            onClick={onConfirm}
            className="rounded-full bg-coral px-4 py-2 text-[13px] font-extrabold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {busy ? "Deleting…" : "Delete user"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Make/remove admin: a plain confirm, since it's reversible. */
function AdminDialog({
  user,
  making,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  user: AdminUser;
  making: boolean;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal open onClose={onCancel} label="Change admin status" maxWidth={420}>
      <div className="px-6 py-5">
        <h2 className="font-display text-[18px] font-bold text-text-body">
          {making ? "Make this user an admin?" : "Remove admin access?"}
        </h2>
        <p className="mt-2 text-[13.5px] text-text-muted">
          {making ? (
            <>
              <span className="font-bold text-text-body">{user.email}</span> will
              get full admin access — including this panel, and the ability to
              delete users.
            </>
          ) : (
            <>
              <span className="font-bold text-text-body">{user.email}</span> will
              lose admin access.
            </>
          )}
        </p>
        {error && <p className="mt-3 text-[12.5px] text-coral">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full px-4 py-2 text-[13px] font-bold text-text-muted hover:bg-black/[0.04]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="rounded-full bg-spruce px-4 py-2 text-[13px] font-extrabold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {busy ? "Saving…" : making ? "Make admin" : "Remove admin"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function useOutsideClose(
  ref: React.RefObject<HTMLElement | null>,
  onClose: () => void,
) {
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [ref, onClose]);
}
