"use client";
// One flight-log entry, opened from the log list: the meters, the route, what
// was put back in, the photos, and any squawks that came out of it.
//
// Photos load from /api/photos/[id], which streams them from storage behind
// the session check — so there's no public bucket URL anywhere in the client.
import { useState } from "react";
import Badge from "./common/Badge";
import Button from "./common/Button";
import LoadingDots from "./common/LoadingDots";
import Modal from "./common/Modal";
import {
  NoImageSupport,
  usePhotoSupport,
} from "./PhotoSupportProvider";
import { sendJson } from "@/lib/api";
import { countChecked, totalItems } from "@/lib/checkouts";
import {
  SIGNATURE_LABELS,
  SIGNATURE_TONES,
  signatureState,
} from "@/lib/flightSignature";
import { SQUAWK_STATUS_SHORT, SQUAWK_STATUS_TONES } from "@/lib/squawks";
import { formatFullDate } from "@/lib/dates";
import { formatCents, formatHours, hobbsHours, tachHours } from "@/lib/hours";
import type { ApiFlight } from "@/lib/types";

export default function FlightDetailModal({
  flight,
  onClose,
  hourlyRateCents,
  canDelete,
  onDelete,
  viewerId,
  onSignatureChanged,
}: {
  flight: ApiFlight | null;
  onClose: () => void;
  hourlyRateCents: number | null;
  canDelete: boolean;
  onDelete: (flight: ApiFlight) => void;
  /** The signed-in member, so the modal knows if the signature is theirs to give. */
  viewerId?: string | null;
  /** Refetch the log after a signature lands. Omit to hide the control. */
  onSignatureChanged?: () => void;
}) {
  // Above the early return: hooks may not be called conditionally.
  const { enabled: photosEnabled } = usePhotoSupport();
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);

  async function toggleSignature(id: string, signed: boolean) {
    setSignError(null);
    setSigning(true);
    const result = await sendJson(
      `/api/flights/${id}/sign`,
      signed ? "DELETE" : "POST"
    );
    setSigning(false);
    if (!result.ok) {
      setSignError(result.error ?? "Could not update the signature.");
      return;
    }
    onSignatureChanged?.();
  }

  if (!flight) return null;

  const tach = tachHours(flight);
  const hobbs = hobbsHours(flight);
  const cost = hourlyRateCents == null ? null : Math.round(tach * hourlyRateCents);
  const state = signatureState(flight);

  return (
    <Modal
      open
      onClose={onClose}
      title={`${formatHours(tach)} hours · ${flight.aircraft.tailNumber}`}
      subtitle={`${formatFullDate(flight.flownOn)} · ${flight.pilot.name}`}
      footer={
        canDelete ? (
          <Button variant="ghost" onClick={() => onDelete(flight)} className="mr-auto">
            Delete
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-5">
        {/* Meters, side by side the way they read on the panel. */}
        <section className="grid grid-cols-2 gap-3 text-sm">
          <Figure label="Tach" value={`${flight.tachStart} → ${flight.tachEnd}`} sub={`${formatHours(tach)} hr`} />
          <Figure
            label="Hobbs"
            value={
              flight.hobbsStart != null && flight.hobbsEnd != null
                ? `${flight.hobbsStart} → ${flight.hobbsEnd}`
                : "—"
            }
            sub={hobbs != null ? `${formatHours(hobbs)} hr` : "not recorded"}
          />
          <Figure label="Landings" value={String(flight.landings)} />
          {cost != null && <Figure label="Est. cost" value={formatCents(cost)} />}
        </section>

        {(flight.departure || flight.arrival || flight.route) && (
          <section>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Route
            </h3>
            <p className="text-sm">
              {flight.route ??
                [flight.departure, flight.arrival].filter(Boolean).join(" → ")}
            </p>
          </section>
        )}

        <section>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Servicing &amp; put-away
          </h3>
          <ul className="space-y-1 text-sm">
            <li>
              Fuel added:{" "}
              {flight.fuelAddedGal != null ? `${flight.fuelAddedGal} gal` : "none"}
              {flight.fuelCostCents != null && ` (${formatCents(flight.fuelCostCents)})`}
            </li>
            <li>
              Oil added:{" "}
              {flight.oilAddedQts != null ? `${flight.oilAddedQts} qt` : "none"}
            </li>
            {/* Only worth a line when the answer is "no" — that's the case the
                next pilot needs to know about. These are derived from the
                turn-off checkout, so "not confirmed" is the honest wording:
                unticked can mean undone or just unrecorded. */}
            {!flight.tiedDown && (
              <li className="text-amber-700 dark:text-amber-400">
                Tie-downs and chocks not confirmed
              </li>
            )}
            {!flight.cabinClean && (
              <li className="text-amber-700 dark:text-amber-400">
                Cabin clean-out not confirmed
              </li>
            )}
            {flight.turnoffCheckoutVersion != null && (
              <li className="text-gray-500 dark:text-gray-400">
                Turn-off checkout: {countChecked("TURNOFF", flight.turnoffAnswers)}{" "}
                of {totalItems("TURNOFF")} items
              </li>
            )}
          </ul>
        </section>

        {/* The instructor's endorsement. Only on a lesson — an entry with no
            CFI on it has nobody to sign, and a permanently empty "unsigned"
            section on every solo flight would read as something missing. */}
        {flight.instructor && (
          <section>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Instructor sign-off
            </h3>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={SIGNATURE_TONES[state]}>{SIGNATURE_LABELS[state]}</Badge>
              <span className="text-sm text-gray-600 dark:text-gray-400">
                {flight.instructor.name}
                {flight.signedAt && <> · {formatFullDate(flight.signedAt)}</>}
              </span>
            </div>

            {/* The whole reason the two dates are stored separately. Not an
                error — correcting an entry is the right thing to do — but the
                signature was given against a different version, and saying so
                is the only way a reader can tell. */}
            {state === "SIGNED_THEN_EDITED" && (
              <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
                This entry was corrected on {formatFullDate(flight.editedAt!)},
                after it was signed. The signature covers the earlier version.
              </p>
            )}

            {signError && (
              <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
                {signError}
              </p>
            )}

            {/* Offered only to the instructor named on THIS entry — not to
                other CFIs and not to admins. See lib/flightSignature.ts for
                why that's the one place the app's "admins can do anything"
                rule doesn't apply. */}
            {onSignatureChanged && flight.instructor.id === viewerId && (
              <div className="mt-2">
                <Button
                  size="sm"
                  variant={flight.signedAt ? "ghost" : "primary"}
                  disabled={signing}
                  onClick={() => toggleSignature(flight.id, Boolean(flight.signedAt))}
                >
                  {signing ? (
                    <LoadingDots size="sm" />
                  ) : flight.signedAt ? (
                    "Withdraw signature"
                  ) : (
                    "Sign this entry"
                  )}
                </Button>
              </div>
            )}
          </section>
        )}

        {flight.notes && (
          <section>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Notes
            </h3>
            <p className="whitespace-pre-wrap text-sm">{flight.notes}</p>
          </section>
        )}

        {flight.squawks.length > 0 && (
          <section>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Squawks from this flight
            </h3>
            <ul className="space-y-2">
              {flight.squawks.map((s) => (
                <li key={s.id} className="flex items-start gap-2 text-sm">
                  <Badge tone={SQUAWK_STATUS_TONES[s.status]}>
                    {SQUAWK_STATUS_SHORT[s.status]}
                  </Badge>
                  <span className="min-w-0">
                    <span className="font-medium">{s.title}</span>
                    {s.description && (
                      <span className="block text-gray-500 dark:text-gray-400">
                        {s.description}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {flight.photos.length > 0 && (
          <section>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Photos
            </h3>
            {/* The rows outlive the bytes when a club drops its bucket, so a
                flight can carry photos this deployment simply cannot fetch.
                Better to say so than to render a wall of broken images. */}
            {!photosEnabled ? (
              <NoImageSupport />
            ) : (
            <div className="flex flex-wrap gap-2">
              {flight.photos.map((p) => (
                <a
                  key={p.id}
                  href={`/api/photos/${p.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block h-24 w-24 overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- the
                      bytes come from an authed API route, not a static asset */}
                  <img
                    src={`/api/photos/${p.id}`}
                    alt={p.caption ?? "Flight photo"}
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                </a>
              ))}
            </div>
            )}
          </section>
        )}

        {/* When this entry was written and when it was last touched. Shown on
            every flight, not just signed ones: "filed on the day, never
            corrected" is a fact about a log entry worth being able to read,
            and it's the thing a signature date gets compared against. */}
        <p className="border-t border-gray-200 pt-3 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
          Filed {formatFullDate(flight.createdAt)}
          {flight.editedAt
            ? ` · last edited ${formatFullDate(flight.editedAt)}`
            : " · never edited"}
        </p>
      </div>
    </Modal>
  );
}

function Figure({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-700/50">
      <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
      <div className="font-semibold tabular">{value}</div>
      {sub && <div className="text-xs text-gray-500 dark:text-gray-400">{sub}</div>}
    </div>
  );
}
