"use client";
// A section only some members can see, marked as such — quietly.
//
// Without a marker an officer has no way to know that the controls in front of
// them are theirs alone; they'll assume everyone sees the club's whole ledger,
// which is exactly the wrong thing to believe about other people's money.
//
// But the marker is a footnote, not an announcement. A banner shouting
// "FINANCE OFFICER ONLY" over the buttons reads as a warning about danger,
// and it's the loudest thing on a page whose actual subject is the money. So
// the surface stays a normal card, distinguished only by a thin accent rail,
// and the badge is a small grey line: the office name, and an (i) that spells
// out who else can see it for anyone who wonders. Clear on a second's
// attention, invisible to the first glance.
//
// It's a label, not a permission: the API decides what anyone may do. Never
// use this to hide something that isn't also refused server-side.
import type { ReactNode } from "react";
import Card from "./Card";
import InfoTip from "./InfoTip";

export default function OfficerOnly({
  office,
  children,
  className = "",
}: {
  /** Whose section this is — "Finance Officer", "Admins". */
  office: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={`border-l-2 border-l-indigo-400 dark:border-l-indigo-500 ${className}`}>
      {children}
      <div className="mt-3 flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500">
        <LockIcon />
        <span>{office}</span>
        <InfoTip label={`${office} tools`}>
          <p>
            These controls come with the office, and the server checks for it on
            every change. Members who don&apos;t hold it never see this section
            at all — the rest of the page looks the same to everyone.
          </p>
        </InfoTip>
      </div>
    </Card>
  );
}

function LockIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
      className="h-3.5 w-3.5 shrink-0"
    >
      <path
        fillRule="evenodd"
        d="M10 1a4 4 0 0 0-4 4v2H5.5A1.5 1.5 0 0 0 4 8.5v8A1.5 1.5 0 0 0 5.5 18h9a1.5 1.5 0 0 0 1.5-1.5v-8A1.5 1.5 0 0 0 14.5 7H14V5a4 4 0 0 0-4-4Zm2.5 6V5a2.5 2.5 0 0 0-5 0v2h5Z"
        clipRule="evenodd"
      />
    </svg>
  );
}
