"use client";

import { useState } from "react";

/**
 * A brand logo image that falls back to initials if it fails to load.
 *
 * Brandfetch's Logo Link returns a 404 for an unknown brand (we ask for
 * fallback=404), so onError is the signal to drop back to our own colored
 * initials rather than show a placeholder we don't control. On a white logo
 * tile the initials sit on a tinted background exactly as they would without a
 * logo, so the fallback is seamless.
 *
 * The logo sits on white, since brand logos assume a light background.
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
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- external CDN with
          a dynamic per-domain URL; next/image would need remotePatterns and
          gains nothing for a 64px CDN-cached logo. */}
      <img
        src={src}
        alt=""
        width="100%"
        height="100%"
        loading="lazy"
        onError={() => setFailed(true)}
        className="h-full w-full bg-white object-contain"
      />
    </>
  );
}
