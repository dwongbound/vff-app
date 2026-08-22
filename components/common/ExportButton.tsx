"use client";
// "Export" — hand the browser an .xlsx built from what the page is already
// holding.
//
// Client-side, like the reservation's .ics: the rows are on screen, so a round
// trip would only re-serialise what we've got, and it means the export works on
// the clubhouse wifi at the same moment the rest of the page does.
//
// One component rather than the same twenty lines on three pages. The workbook
// is built LAZILY, in the click handler — passing sheets as a prop would
// rebuild every row on every render of a page whose export nobody pressed.
import { useState } from "react";
import Button from "@/components/common/Button";
import { XLSX_MIME, buildXlsx, type Sheet } from "@/lib/xlsx";

export default function ExportButton({
  filename,
  build,
  label = "Export",
  disabled = false,
}: {
  /** Including the .xlsx extension — use `xlsxFilename` to build it. */
  filename: string;
  /** Called on click. Returns the workbook's sheets, in tab order. */
  build: () => Sheet[];
  label?: string;
  disabled?: boolean;
}) {
  // A build that throws must not leave the page with no explanation, and it
  // must not take the page down with it either: everything here runs inside a
  // click handler on data the user can see, so the honest failure is a line of
  // text beside the button.
  const [error, setError] = useState<string | null>(null);

  function download() {
    setError(null);
    let url: string | null = null;
    try {
      // The Uint8Array itself, never its `.buffer`: a typed array is a view
      // into a buffer that may be larger than it, so handing Blob the buffer
      // would write bytes that aren't ours.
      const blob = new Blob([buildXlsx(build())], { type: XLSX_MIME });
      url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch {
      setError("Couldn't build the export.");
    }
    // Revoking immediately can cancel the download in some browsers; one tick
    // is enough for the click to have been handed off.
    if (url) setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return (
    <div className="flex items-center gap-2">
      {error && (
        <span className="text-xs text-red-600 dark:text-red-400">{error}</span>
      )}
      <Button size="sm" variant="secondary" onClick={download} disabled={disabled}>
        {label}
      </Button>
    </div>
  );
}
