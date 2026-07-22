"use client";

import { useState } from "react";

/**
 * A brand logo image that falls back to initials if it fails to load.
 *
 * Brandfetch's Logo Link returns a 404 for an unknown brand (we ask for
 * fallback=404), so onError is the signal to drop back to our own colored
 * initials rather than show a placeholder we don't control.
 *
 * The logo sits on a white tile with a small inset padding, so a mark with its
 * own tight bounding box (Amazon, Schwab) has breathing room inside the circle
 * instead of clipping hard against the edge. `object-contain` keeps aspect
 * ratio within that padded box.
 */
export function AvatarLogo({
  src,
  fallback,
}: {
  src: string;
  fallback: React.ReactNode;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) return <>{fallback}</>;

  return (
    <span className="flex h-full w-full items-center justify-center bg-white p-[14%]">
      {/* eslint-disable-next-line @next/next/no-img-element -- external CDN with
          a dynamic per-domain URL; next/image would need remotePatterns and
          gains nothing for a small CDN-cached logo. */}
      <img
        src={src}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
        className="max-h-full max-w-full object-contain"
      />
    </span>
  );
}
