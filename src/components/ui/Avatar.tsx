import { avatarHueIndex, initialsFor } from "@/lib/email/addresses";
import { AvatarLogo } from "./AvatarLogo";

/** Avatar hue classes, indexed by `avatarHueIndex` so a contact keeps its color.
 * Values come from the --avatar-* design tokens in globals.css. */
const HUE_CLASSES = [
  "bg-avatar-blue",
  "bg-avatar-sage",
  "bg-avatar-olive",
  "bg-avatar-sand",
  "bg-avatar-terracotta",
] as const;

/**
 * Circular avatar. Shows a company logo when `logoUrl` is provided and loads;
 * otherwise deterministic colored initials (same contact, same hue, always).
 *
 * The logo path is a separate client component so the initials avatar stays a
 * plain server component — most avatars (people, spam, anything without a
 * confident brand domain) never touch it.
 */
export function Avatar({
  address,
  label,
  size = 40,
  logoUrl = null,
}: {
  address: string;
  label: string;
  size?: number;
  /** Brand logo URL; falls back to initials if absent or it fails to load. */
  logoUrl?: string | null;
}) {
  const hue = HUE_CLASSES[avatarHueIndex(address)];
  const initials = (
    <span
      className={`${hue} inline-flex h-full w-full items-center justify-center rounded-full font-extrabold text-white`}
      style={{ fontSize: Math.max(11, Math.round(size * 0.32)) }}
    >
      {initialsFor(label)}
    </span>
  );

  return (
    <span
      className="inline-flex shrink-0 overflow-hidden rounded-full shadow-[0_3px_8px_rgba(0,0,0,0.25)]"
      style={{ width: size, height: size }}
      aria-hidden
    >
      {logoUrl ? <AvatarLogo src={logoUrl} fallback={initials} /> : initials}
    </span>
  );
}
