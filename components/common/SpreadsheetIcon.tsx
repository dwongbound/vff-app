// The mark on every Export that produces a spreadsheet (.xlsx).
//
// A generic sheet — a page with a green header band and a grid — rather than
// any spreadsheet program's logo: the file opens in Excel, Numbers or Google
// Sheets alike, and the icon only has to say "this gives you a spreadsheet".
// Green because that is the colour people already read as "spreadsheet".
export default function SpreadsheetIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={`shrink-0 ${className}`}>
      {/* The page */}
      <rect x="3" y="2" width="14" height="16" rx="2" className="fill-green-600" />
      {/* Its cells: a header band, then a 2×3 grid */}
      <g className="fill-white/90">
        <rect x="5" y="5" width="10" height="2" rx="0.5" />
        <rect x="5" y="8.5" width="4.25" height="2" rx="0.5" />
        <rect x="10.75" y="8.5" width="4.25" height="2" rx="0.5" />
        <rect x="5" y="11.5" width="4.25" height="2" rx="0.5" />
        <rect x="10.75" y="11.5" width="4.25" height="2" rx="0.5" />
        <rect x="5" y="14.5" width="4.25" height="1.5" rx="0.5" />
        <rect x="10.75" y="14.5" width="4.25" height="1.5" rx="0.5" />
      </g>
    </svg>
  );
}
