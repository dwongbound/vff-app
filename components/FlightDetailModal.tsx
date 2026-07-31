"use client";
// One flight-log entry, opened from the log list: the meters, the route, what
// was put back in, the photos, and any squawks that came out of it.
//
// Photos load from /api/photos/[id], which streams them from storage behind
// the session check — so there's no public bucket URL anywhere in the client.
import Badge from "./common/Badge";
import Button from "./common/Button";
import Modal from "./common/Modal";
import { SEVERITY_LABELS, SEVERITY_TONES } from "@/lib/constants";
import { formatFullDate } from "@/lib/dates";
import { formatCents, formatHours, hobbsHours, tachHours } from "@/lib/hours";
import type { ApiFlight } from "@/lib/types";

export default function FlightDetailModal({
  flight,
  onClose,
  hourlyRateCents,
  canDelete,
  onDelete,
}: {
  flight: ApiFlight | null;
  onClose: () => void;
  hourlyRateCents: number | null;
  canDelete: boolean;
  onDelete: (flight: ApiFlight) => void;
}) {
  if (!flight) return null;

  const tach = tachHours(flight);
  const hobbs = hobbsHours(flight);
  const cost = hourlyRateCents == null ? null : Math.round(tach * hourlyRateCents);

  return (
    <Modal
      open
      onClose={onClose}
      title={`${formatHours(tach)} hours · ${flight.aircraft.tailNumber}`}
      subtitle={`${formatFullDate(flight.flownOn)} · ${flight.pilot.name}`}
      footer={
        canDelete ? (
          <Button variant="ghost" onClick={() => onDelete(flight)} className="mr-auto">
            Delete entry
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
                next pilot needs to know about. */}
            {!flight.tiedDown && (
              <li className="text-amber-700 dark:text-amber-400">
                Not tied down when the pilot left
              </li>
            )}
            {!flight.cabinClean && (
              <li className="text-amber-700 dark:text-amber-400">
                Cabin left uncleaned
              </li>
            )}
          </ul>
        </section>

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
                  <Badge tone={SEVERITY_TONES[s.severity]}>
                    {SEVERITY_LABELS[s.severity]}
                  </Badge>
                  <span className="min-w-0">
                    <span className="font-medium">{s.title}</span>
                    {s.status === "RESOLVED" && (
                      <span className="ml-2 text-xs text-green-600 dark:text-green-400">
                        signed off
                      </span>
                    )}
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
          </section>
        )}
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
