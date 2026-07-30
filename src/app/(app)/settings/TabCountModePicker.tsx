"use client";

import { useTransition } from "react";
import { updateTabCountMode } from "../actions";
import { TAB_COUNT_MODES, TAB_COUNT_MODE_LABELS, type TabCountMode } from "@/lib/types";

/**
 * Radio group for the Contacts/Companies/Spam tab counter preference.
 * Submits on change (via a hidden form + FormData, matching
 * updateTabCountMode's server-action signature) rather than needing an
 * explicit save button — there's nothing else on this form to batch with it.
 */
export function TabCountModePicker({
  initialMode,
}: {
  initialMode: TabCountMode;
}) {
  const [isPending, startTransition] = useTransition();

  const handleChange = (mode: TabCountMode) => {
    const formData = new FormData();
    formData.set("mode", mode);
    startTransition(() => {
      updateTabCountMode(formData);
    });
  };

  return (
    <div
      className={`flex flex-col gap-2 ${isPending ? "opacity-60" : ""}`}
    >
      {TAB_COUNT_MODES.map((mode) => (
        <label
          key={mode}
          className="flex items-center gap-2.5 text-[13.5px] text-text-body"
        >
          <input
            type="radio"
            name="mode"
            value={mode}
            defaultChecked={mode === initialMode}
            onChange={() => handleChange(mode)}
            disabled={isPending}
            className="accent-spruce"
          />
          {TAB_COUNT_MODE_LABELS[mode]}
        </label>
      ))}
    </div>
  );
}
