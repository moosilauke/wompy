"use client";

import { useState } from "react";

/**
 * A brand logo image that falls back to initials if it fails to load.
 *
 * Brandfetch's Logo Link returns a 404 for an unknown brand (we ask for
 * fallback=404), so onError is the signal to drop back to our own colored
 * initials rather than show a placeholder we don't control.
 *
 * The image fills the circle edge-to-edge (object-cover), so the circular mask
 * on the parent is the only boundary. Brand icons come in two kinds — a
 * transparent logomark and a full-bleed colored square tile — and letting the
 * image fill means a square tile reads as a clean colored circle instead of a
 * square poking its corners past the frame. A white backing shows through for
 * transparent marks so they sit on white rather than the dark rail.
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
    <span className="block h-full w-full bg-white">
      {/* eslint-disable-next-line @next/next/no-img-element -- external CDN with
          a dynamic per-domain URL; next/image would need remotePatterns and
          gains nothing for a small CDN-cached logo. */}
      <img
        src={src}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
        className="h-full w-full object-cover"
      />
    </span>
  );
}
