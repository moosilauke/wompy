"use client";

import { useTransition } from "react";
import { updateAlwaysLoadImages } from "../actions";

/**
 * Whether "View original" loads remote images without asking.
 *
 * Same shape as TabCountModePicker: submits on change through a FormData
 * server action, no save button, since there is nothing to batch it with.
 */
export function ImageLoadingPicker({
  initialEnabled,
}: {
  initialEnabled: boolean;
}) {
  const [isPending, startTransition] = useTransition();

  const handleChange = (enabled: boolean) => {
    const formData = new FormData();
    formData.set("enabled", String(enabled));
    startTransition(() => {
      updateAlwaysLoadImages(formData);
    });
  };

  return (
    <div className={`flex flex-col gap-2 ${isPending ? "opacity-60" : ""}`}>
      <label className="flex items-center gap-2.5 text-[13.5px] text-text-body">
        <input
          type="radio"
          name="always-load-images"
          value="false"
          defaultChecked={!initialEnabled}
          onChange={() => handleChange(false)}
          disabled={isPending}
          className="accent-spruce"
        />
        Ask before loading images
      </label>
      <label className="flex items-center gap-2.5 text-[13.5px] text-text-body">
        <input
          type="radio"
          name="always-load-images"
          value="true"
          defaultChecked={initialEnabled}
          onChange={() => handleChange(true)}
          disabled={isPending}
          className="accent-spruce"
        />
        Always load images
      </label>
    </div>
  );
}
