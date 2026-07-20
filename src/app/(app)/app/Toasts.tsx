"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

/**
 * Toast notifications with an optional Undo affordance.
 *
 * Actions apply immediately and offer Undo here rather than asking for
 * confirmation up front — trashing is recoverable, so the honest, low-friction
 * pattern is "do it, and let me take it back".
 *
 * Provided as context so any action anywhere in the shell can raise one.
 */

const UNDO_WINDOW_MS = 7000;

export interface Toast {
  id: number;
  message: string;
  /** When present, the toast shows an Undo button. */
  onUndo?: () => void | Promise<void>;
}

interface ToastContextValue {
  notify: (message: string, onUndo?: () => void | Promise<void>) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToasts(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToasts must be used inside <ToastProvider>");
  }
  return ctx;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const notify = useCallback(
    (message: string, onUndo?: () => void | Promise<void>) => {
      const id = Date.now() + Math.random();
      setToasts((current) => [...current, { id, message, onUndo }]);
    },
    [],
  );

  const value = useMemo(() => ({ notify }), [notify]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-6 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
        {toasts.map((toast) => (
          <ToastRow key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastRow({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: (id: number) => void;
}) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), UNDO_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

  return (
    <div className="pointer-events-auto flex items-center gap-4 rounded-full bg-spruce py-2.5 pl-5 pr-2.5 text-[13px] font-bold text-white shadow-[0_8px_28px_rgba(0,0,0,0.28)]">
      <span>{toast.message}</span>
      {toast.onUndo && (
        <button
          type="button"
          onClick={async () => {
            onDismiss(toast.id);
            await toast.onUndo?.();
          }}
          className="rounded-full bg-coral px-3.5 py-1.5 text-[12.5px] font-extrabold text-white transition-opacity hover:opacity-90"
        >
          Undo
        </button>
      )}
    </div>
  );
}
