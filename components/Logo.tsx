// The club roundel — a top-view airplane silhouette in an orange disc, sized
// via `className` (defaults to 2.25rem square). Drawn as vector paths (no font
// or image dependency) so it renders identically in every browser and theme.
import { CLUB_NAME } from "@/lib/constants";

export default function Logo({
  className = "h-9 w-9",
  title = CLUB_NAME,
}: {
  className?: string;
  title?: string;
}) {
  return (
    <svg viewBox="0 0 120 120" role="img" aria-label={title} className={className}>
      <title>{title}</title>
      {/* Orange disc with a thin white ring, like a squadron patch. */}
      <circle cx="60" cy="60" r="58" fill="#c64912" />
      <circle cx="60" cy="60" r="49" fill="none" stroke="#ffe6d5" strokeWidth="2" />
      {/* High-wing single, nose up: fuselage, wing, tailplane, spinner. */}
      <g fill="#ffffff">
        {/* fuselage */}
        <path d="M56 26 q4 -8 8 0 l3 52 -14 0 Z" />
        <rect x="53" y="74" width="14" height="18" rx="4" />
        {/* wing */}
        <path d="M18 54 l84 0 l0 9 l-84 0 Z" />
        {/* tailplane */}
        <path d="M40 88 l40 0 l0 7 l-40 0 Z" />
        {/* spinner */}
        <circle cx="60" cy="24" r="4" />
      </g>
    </svg>
  );
}
