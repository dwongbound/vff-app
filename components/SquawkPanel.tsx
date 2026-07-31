"use client";
// The airplane's squawk list, shown under the flight log. Open items first,
// with the grounding ones impossible to miss.
//
// Signing off is admin-only (the API enforces it too) — that's the decision
// that puts the airplane back on the line.
import { useState } from "react";
import Badge from "./common/Badge";
import Button from "./common/Button";
import Card from "./common/Card";
import Input from "./common/Input";
import LoadingDots from "./common/LoadingDots";
import { sendJson } from "@/lib/api";
import { SEVERITY_LABELS, SEVERITY_TONES } from "@/lib/constants";
import { formatDay } from "@/lib/dates";
import type { ApiSquawk } from "@/lib/types";

export default function SquawkPanel({
  squawks,
  isAdmin,
  onChanged,
}: {
  squawks: ApiSquawk[];
  isAdmin: boolean;
  onChanged: () => void;
}) {
  // Id of the squawk whose "how was it fixed?" box is open.
  const [resolving, setResolving] = useState<string | null>(null);
  const [resolution, setResolution] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  async function resolve(id: string) {
    setBusyId(id);
    const result = await sendJson(`/api/squawks/${id}`, "PATCH", {
      status: "RESOLVED",
      resolution: resolution.trim() || null,
    });
    setBusyId(null);
    if (result.ok) {
      setResolving(null);
      setResolution("");
      onChanged();
    }
  }

  async function reopen(id: string) {
    setBusyId(id);
    const result = await sendJson(`/api/squawks/${id}`, "PATCH", { status: "OPEN" });
    setBusyId(null);
    if (result.ok) onChanged();
  }

  if (squawks.length === 0) {
    return (
      <Card>
        <h2 className="text-sm font-semibold">Squawks</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Nothing outstanding — the airplane is clean.
        </p>
      </Card>
    );
  }

  return (
    <Card className="space-y-3">
      <h2 className="text-sm font-semibold">Squawks</h2>
      <ul className="space-y-2">
        {squawks.map((s) => {
          const open = s.status === "OPEN";
          return (
            <li
              key={s.id}
              className={`rounded-lg border px-3 py-2.5 ${
                open && s.severity === "GROUNDING"
                  ? "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-900/20"
                  : "border-gray-200 dark:border-gray-700"
              } ${open ? "" : "opacity-70"}`}
            >
              <div className="flex flex-wrap items-start gap-2">
                <Badge tone={open ? SEVERITY_TONES[s.severity] : "green"}>
                  {open ? SEVERITY_LABELS[s.severity] : "Signed off"}
                </Badge>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{s.title}</span>
                  {s.description && (
                    <span className="block text-sm text-gray-600 dark:text-gray-400">
                      {s.description}
                    </span>
                  )}
                  <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
                    {s.reportedBy.name} · {formatDay(s.createdAt)}
                    {s.resolvedBy && s.resolvedAt && (
                      <> · signed off by {s.resolvedBy.name} {formatDay(s.resolvedAt)}</>
                    )}
                  </span>
                  {s.resolution && (
                    <span className="mt-0.5 block text-xs text-gray-600 dark:text-gray-400">
                      Fix: {s.resolution}
                    </span>
                  )}
                </span>

                {isAdmin &&
                  (busyId === s.id ? (
                    <LoadingDots size="sm" className="text-indigo-600" />
                  ) : open ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setResolving(resolving === s.id ? null : s.id);
                        setResolution("");
                      }}
                    >
                      Sign off
                    </Button>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => reopen(s.id)}>
                      Reopen
                    </Button>
                  ))}
              </div>

              {s.photos.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {s.photos.map((p) => (
                    <a
                      key={p.id}
                      href={`/api/photos/${p.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block h-16 w-16 overflow-hidden rounded border border-gray-200 dark:border-gray-700"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/api/photos/${p.id}`}
                        alt={p.caption ?? "Squawk photo"}
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    </a>
                  ))}
                </div>
              )}

              {resolving === s.id && (
                <div className="mt-2 flex items-end gap-2">
                  <Input
                    label="How was it fixed?"
                    value={resolution}
                    onChange={(e) => setResolution(e.target.value)}
                    placeholder="Replaced the brake pads — logbook entry 8/2"
                    className="flex-1"
                  />
                  <Button onClick={() => resolve(s.id)}>Confirm</Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
