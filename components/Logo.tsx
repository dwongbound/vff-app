"use client";
// The club roundel — N8318B's own tail livery, the copper-and-black swoosh
// sweeping up across a white field, sized via `className` (defaults to
// 2.25rem square). Drawn as vector paths (no font or image dependency) so it
// renders identically in every browser and theme.
//
// The geometry is the same drawing as app/icon.svg (the favicon) and
// public/icons/icon-square.svg (the installed home-screen icon), on the same
// 512 grid, so the mark in the top bar, the mark in the tab strip and the one
// on somebody's phone are one design. Change one, change all three.
//
// The SHAPE is the airframe's; the COLOUR is the app's — #c64912 is the club
// orange that tailwind.config.ts remaps `indigo-600` to, so the mark matches the
// avatar sitting beside it in the top bar. See app/icon.svg for the long version.
import { useId } from "react";
import { CLUB_NAME } from "@/lib/constants";

export default function Logo({
  className = "h-9 w-9",
  title = CLUB_NAME,
}: {
  className?: string;
  title?: string;
}) {
  // The disc clip is referenced by id, and the mark renders more than once per
  // page (top bar, login card), so the id has to be per-instance.
  const clipId = useId();

  return (
    <svg viewBox="0 0 512 512" role="img" aria-label={title} className={className}>
      <title>{title}</title>
      <defs>
        <clipPath id={clipId}>
          <circle cx="256" cy="256" r="248" />
        </clipPath>
      </defs>

      {/* White field: the fuselage/fin the stripes are painted on. */}
      <circle cx="256" cy="256" r="248" fill="#ffffff" />

      <g clipPath={`url(#${clipId})`}>
        {/* Orange band. The four edges are four different cubics: the bands
            FAN as they sweep, narrow and tight at one end, wide and far apart
            at the other, the way the paint does. See app/icon.svg. */}
        <path
          fill="#c64912"
          d="M-30 316
             C 140 316, 170 214, 300 158
             C 410 110, 470 84, 545 72
             L 545 182
             C 470 196, 410 226, 300 254
             C 170 316, 140 356, -30 356
             Z"
        />
        {/* Black band trailing below it, same curve, a thin white gap between. */}
        <path
          fill="#1b1b1e"
          d="M-30 368
             C 140 368, 180 314, 300 286
             C 410 262, 470 246, 545 240
             L 545 310
             C 470 318, 410 336, 300 352
             C 180 384, 140 390, -30 390
             Z"
        />
      </g>

      {/* Orange rim, so the white field still has an edge against a light page. */}
      <circle cx="256" cy="256" r="243" fill="none" stroke="#c64912" strokeWidth="10" />
    </svg>
  );
}
