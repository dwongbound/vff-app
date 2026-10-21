"use client";
// A flight's TYPE — the same vocabulary a booking uses (lib/constants.ts
// PURPOSES), so a lesson booked as "Training (Solo)" reads the same in the
// calendar and in the log. Two pieces: the chip the log shows, and the select
// every form that writes a flight uses to set it.
import Badge from "@/components/common/Badge";
import Select from "@/components/common/Select";
import { PURPOSES, PURPOSE_LABELS, PURPOSE_TONES, type Purpose } from "@/lib/constants";

/**
 * The log row's words: a phone row already carries a name, a route and maybe a
 * signature badge, and "Training (with CFI)" beside all that ran under the
 * badge. The detail modal has the room for the full label.
 */
const SHORT_LABELS: Record<Purpose, string> = {
  LOCAL: "Local",
  CROSS_COUNTRY: "Cross-country",
  TRAINING: "Training",
  TRAINING_SOLO: "Solo",
  CHECKRIDE: "Checkride",
  MAINTENANCE: "Maintenance",
};

export function FlightTypeChip({
  purpose,
  short = false,
}: {
  purpose: Purpose | null;
  short?: boolean;
}) {
  if (!purpose) return null;
  return (
    // `max-w-full` + the inner truncate: in a row squeezed by a signature
    // badge the chip ellipsizes rather than running under its neighbour.
    <Badge tone={PURPOSE_TONES[purpose]} className="min-w-0 max-w-full">
      <span className="truncate">
        {short ? SHORT_LABELS[purpose] : PURPOSE_LABELS[purpose]}
      </span>
    </Badge>
  );
}

/**
 * The type picker. Its value is the purpose or "" for "not set" — an entry
 * nobody typed stays honestly blank rather than defaulting to "Local flight".
 */
export function FlightTypeSelect({
  value,
  onChange,
}: {
  value: Purpose | "";
  onChange: (value: Purpose | "") => void;
}) {
  return (
    <Select
      label="Flight type"
      value={value}
      onChange={(e) => onChange(e.target.value as Purpose | "")}
    >
      <option value="">Not set</option>
      {PURPOSES.map((p) => (
        <option key={p} value={p}>
          {PURPOSE_LABELS[p]}
        </option>
      ))}
    </Select>
  );
}
