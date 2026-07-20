import { avatarHueIndex, initialsFor } from "@/lib/email/addresses";

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
 * Circular initials avatar. Color is derived deterministically from the address
 * so the same contact is always the same hue across sessions.
 */
export function Avatar({
  address,
  label,
  size = 40,
}: {
  address: string;
  label: string;
  size?: number;
}) {
  const hue = HUE_CLASSES[avatarHueIndex(address)];
  return (
    <span
      className={`${hue} inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white/95`}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(11, Math.round(size * 0.36)),
      }}
      aria-hidden
    >
      {initialsFor(label)}
    </span>
  );
}
