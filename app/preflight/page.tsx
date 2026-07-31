"use client";
// Preflight tab — the walkaround, in POH order.
//
// Design notes: this page is used standing on a ramp, one-handed, often in
// sun. So: big tap targets (the whole row toggles), a running progress bar,
// sections that collapse once they're done, and no destructive action within
// reach of a thumb. The checklist itself lives in lib/checklist.ts.
import { useCallback, useEffect, useMemo, useState } from "react";
import Badge from "@/components/common/Badge";
import Button from "@/components/common/Button";
import Card from "@/components/common/Card";
import Input from "@/components/common/Input";
import LoadingDots from "@/components/common/LoadingDots";
import Textarea from "@/components/common/Textarea";
import InfoTip from "@/components/common/InfoTip";
import PhotoUploader, { uploadPhotos } from "@/components/PhotoUploader";
import SquawkDraftModal, { type SquawkDraft } from "@/components/SquawkDraftModal";
import { GumpsCard, MyLimitsCard } from "@/components/OperatingRules";
import { notifyAircraftChanged, useAircraft } from "@/components/AircraftProvider";
import { usePageLoading } from "@/components/LoadingProvider";
import { fetchJsonArray, sendJson } from "@/lib/api";
import {
  PREFLIGHT_CHECKLIST,
  TOTAL_ITEMS,
  countChecked,
  countSectionChecked,
  isComplete,
  missingItems,
  type Answers,
} from "@/lib/checklist";
import { SEVERITY_LABELS, SEVERITY_TONES } from "@/lib/constants";
import { formatDay } from "@/lib/dates";
import { hoursInLastYear, pilotTier } from "@/lib/operatingRules";
import { useMe } from "@/components/MeProvider";
import type { ApiFlight, ApiPreflight, ApiSquawk } from "@/lib/types";

export default function PreflightPage() {
  const { selected, loading: fleetLoading } = useAircraft();
  // Fetches key off the ID, not the aircraft object: the provider hands back a
  // fresh object on every refresh, so depending on it would re-run this page's
  // queries every time anyone touched a squawk.
  const aircraftId = selected?.id ?? null;
  const [answers, setAnswers] = useState<Answers>({});
  const [openSection, setOpenSection] = useState<string>(PREFLIGHT_CHECKLIST[0].id);
  const [fuel, setFuel] = useState("");
  const [oil, setOil] = useState("");
  const [notes, setNotes] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [squawkDrafts, setSquawkDrafts] = useState<SquawkDraft[]>([]);
  const [squawkModalOpen, setSquawkModalOpen] = useState(false);
  const [recent, setRecent] = useState<ApiPreflight[] | null>(null);
  const [openSquawks, setOpenSquawks] = useState<ApiSquawk[]>([]);
  // My own flights, for the experience/currency half of the operating rules.
  const [myFlights, setMyFlights] = useState<ApiFlight[]>([]);
  const { me } = useMe();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  // See the reservations page for why this isn't just `recent === null`.
  const showSplash = fleetLoading || (selected !== null && recent === null);
  usePageLoading(showSplash);

  const refresh = useCallback(async () => {
    if (!aircraftId) return;
    // Both lists are always shown together, so they go out together rather
    // than one after the other.
    const [runs, squawks, flights] = await Promise.all([
      fetchJsonArray<ApiPreflight>(`/api/preflight?aircraftId=${aircraftId}&limit=5`),
      fetchJsonArray<ApiSquawk>(`/api/squawks?aircraftId=${aircraftId}&status=OPEN`),
      fetchJsonArray<ApiFlight>(`/api/flights?aircraftId=${aircraftId}&mine=1&limit=300`),
    ]);
    setRecent(runs);
    setOpenSquawks(squawks);
    setMyFlights(flights);
  }, [aircraftId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Which column of the club's operating rules applies to this member today.
  // The recent half comes from this club's log; the total is whatever they
  // declared on their profile (the club can't see their logbook).
  const recentHours = hoursInLastYear(myFlights);
  const tier = pilotTier({
    totalTimeHours: me?.totalTimeHours ?? null,
    recentHours,
  });

  const checked = countChecked(answers);
  const complete = isComplete(answers);
  const progress = Math.round((checked / TOTAL_ITEMS) * 100);
  const remaining = useMemo(() => missingItems(answers), [answers]);

  function toggle(id: string) {
    setAnswers((prev) => {
      const next = { ...prev };
      if (next[id]) delete next[id];
      else next[id] = true;
      return next;
    });
  }

  function toggleSection(sectionId: string, on: boolean) {
    const section = PREFLIGHT_CHECKLIST.find((s) => s.id === sectionId);
    if (!section) return;
    setAnswers((prev) => {
      const next = { ...prev };
      for (const item of section.items) {
        if (on) next[item.id] = true;
        else delete next[item.id];
      }
      return next;
    });
  }

  async function submit(signOff: boolean) {
    if (!selected) return;
    setError(null);
    setSaved(null);
    setBusy(true);

    const result = await sendJson<ApiPreflight>("/api/preflight", "POST", {
      aircraftId: selected.id,
      answers,
      fuelOnBoardGal: fuel === "" ? null : Number(fuel),
      oilQuarts: oil === "" ? null : Number(oil),
      notes: notes.trim() || null,
      complete: signOff,
    });

    if (!result.ok || !result.data) {
      setBusy(false);
      setError(result.error ?? "Could not save the preflight.");
      return;
    }

    const preflightId = result.data.id;

    // Photos and squawks both need the row's id, so they go up after it.
    if (photos.length) {
      await uploadPhotos(photos, "preflight", preflightId);
    }
    for (const draft of squawkDrafts) {
      const squawk = await sendJson<ApiSquawk>("/api/squawks", "POST", {
        aircraftId: selected.id,
        preflightId,
        title: draft.title,
        description: draft.description || null,
        severity: draft.severity,
      });
      if (squawk.ok && squawk.data && draft.photos.length) {
        await uploadPhotos(draft.photos, "squawk", squawk.data.id);
      }
    }

    setBusy(false);
    setSaved(
      signOff
        ? "Preflight signed off. Have a good flight."
        : "Progress saved — pick it back up any time."
    );

    // A new grounding squawk changes the whole app's banner state.
    if (squawkDrafts.some((d) => d.severity === "GROUNDING")) {
      notifyAircraftChanged();
    }

    // Start clean for the next run.
    setAnswers({});
    setPhotos([]);
    setSquawkDrafts([]);
    setNotes("");
    setFuel("");
    setOil("");
    setOpenSection(PREFLIGHT_CHECKLIST[0].id);
    await refresh();
  }

  if (!selected) {
    return (
      <Card>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          No airplane set up yet — seed one with{" "}
          <code className="rounded bg-gray-100 px-1 py-0.5 dark:bg-gray-700">
            npm run db:seed
          </code>
          .
        </p>
      </Card>
    );
  }

  const lastRun = recent?.find((r) => r.completedAt) ?? null;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-bold">Preflight</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {selected.tailNumber} · {selected.model}
          {lastRun && (
            <>
              {" · last signed off "}
              {formatDay(lastRun.completedAt!)} by {lastRun.user.name}
            </>
          )}
        </p>
      </header>

      {/* The club's limits for THIS member, before anything else — they decide
          whether the flight happens at all. */}
      <MyLimitsCard
        tier={tier}
        totalTimeHours={me?.totalTimeHours ?? null}
        recentHours={recentHours}
      />

      {/* Open squawks up top: knowing what's already wrong changes what you
          look at on the walkaround. */}
      {openSquawks.length > 0 && (
        <Card className="space-y-2">
          <h2 className="text-sm font-semibold">Open squawks</h2>
          {tier === "BUILDING" && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
              Club rules: call the VFF Safety Officer to discuss before flying
              with an open squawk.
            </p>
          )}
          <ul className="space-y-1.5">
            {openSquawks.map((s) => (
              <li key={s.id} className="flex items-start gap-2 text-sm">
                <Badge tone={SEVERITY_TONES[s.severity]}>
                  {SEVERITY_LABELS[s.severity]}
                </Badge>
                <span className="min-w-0">
                  <span className="font-medium">{s.title}</span>
                  {s.description && (
                    <span className="text-gray-500 dark:text-gray-400"> — {s.description}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Sticky progress bar: it's the one number you want while working down
          the airplane, and it stays put as you scroll. */}
      <div className="sticky top-[var(--app-header-h)] z-10 -mx-4 bg-gray-50/95 px-4 py-2 backdrop-blur dark:bg-gray-900/95">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">
            {checked} of {TOTAL_ITEMS} checked
          </span>
          <span
            className={
              complete
                ? "font-semibold text-green-600 dark:text-green-400"
                : "text-gray-500 dark:text-gray-400"
            }
          >
            {complete ? "Ready to sign off" : `${progress}%`}
          </span>
        </div>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
          <div
            className={`h-full rounded-full transition-all duration-300 ${
              complete ? "bg-green-500" : "bg-indigo-600"
            }`}
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* The checklist. One section open at a time keeps the page short enough
          to thumb through, and finishing a section auto-advances to the next. */}
      <div className="space-y-3">
        {PREFLIGHT_CHECKLIST.map((section, sectionIndex) => {
          const done = countSectionChecked(section, answers);
          const sectionComplete = done === section.items.length;
          const expanded = openSection === section.id;

          return (
            <Card key={section.id} className="p-0">
              <button
                onClick={() => setOpenSection(expanded ? "" : section.id)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left"
                aria-expanded={expanded}
              >
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                    sectionComplete
                      ? "bg-green-500 text-white"
                      : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300"
                  }`}
                >
                  {sectionComplete ? <Check /> : sectionIndex + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{section.title}</span>
                  {section.subtitle && (
                    <span className="block text-xs text-gray-500 dark:text-gray-400">
                      {section.subtitle}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-sm tabular text-gray-500 dark:text-gray-400">
                  {done}/{section.items.length}
                </span>
                <Chevron open={expanded} />
              </button>

              {expanded && (
                <div className="border-t border-gray-100 dark:border-gray-700">
                  <ul>
                    {section.items.map((item) => {
                      const on = Boolean(answers[item.id]);
                      // The row's tick target and its (i) are SIBLINGS, not
                      // nested: a button inside a button is invalid HTML and
                      // React refuses to hydrate it. The tick target still
                      // takes all the leftover width, so it stays a
                      // thumb-sized target on a ramp.
                      return (
                        <li
                          key={item.id}
                          className="flex items-start gap-2 pr-3 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50"
                        >
                          <button
                            onClick={() => toggle(item.id)}
                            aria-pressed={on}
                            className="flex min-w-0 flex-1 items-start gap-3 py-3 pl-4 text-left"
                          >
                            <span
                              className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 transition-colors ${
                                on
                                  ? "border-green-500 bg-green-500 text-white"
                                  : "border-gray-300 dark:border-gray-600"
                              }`}
                            >
                              {on && <Check />}
                            </span>
                            <span className="min-w-0">
                              <span
                                className={`block text-sm ${
                                  on
                                    ? "text-gray-500 line-through dark:text-gray-500"
                                    : "font-medium"
                                }`}
                              >
                                {item.label}
                              </span>
                              {item.detail && (
                                <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
                                  {item.detail}
                                </span>
                              )}
                            </span>
                          </button>
                          <span className="mt-4 shrink-0">
                            <InfoTip label={item.label}>{item.why}</InfoTip>
                          </span>
                        </li>
                      );
                    })}
                  </ul>

                  <div className="flex items-center justify-between gap-2 border-t border-gray-100 px-4 py-2 dark:border-gray-700">
                    <button
                      onClick={() => toggleSection(section.id, !sectionComplete)}
                      className="text-xs font-medium text-gray-500 hover:underline dark:text-gray-400"
                    >
                      {sectionComplete ? "Clear this section" : "Check all in section"}
                    </button>
                    {sectionIndex < PREFLIGHT_CHECKLIST.length - 1 && (
                      <button
                        onClick={() =>
                          setOpenSection(PREFLIGHT_CHECKLIST[sectionIndex + 1].id)
                        }
                        className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                      >
                        Next: {PREFLIGHT_CHECKLIST[sectionIndex + 1].title} →
                      </button>
                    )}
                  </div>
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {/* What you found on the walkaround. */}
      <Card className="space-y-4">
        <h2 className="text-sm font-semibold">What you found</h2>
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Fuel on board"
            type="number"
            inputMode="decimal"
            step="0.5"
            min="0"
            value={fuel}
            onChange={(e) => setFuel(e.target.value)}
            hint={
              selected.fuelCapacityGal
                ? `gallons (${selected.fuelCapacityGal} usable)`
                : "gallons"
            }
          />
          <Input
            label="Oil"
            type="number"
            inputMode="decimal"
            step="0.5"
            min="0"
            value={oil}
            onChange={(e) => setOil(e.target.value)}
            hint="quarts on the dipstick"
          />
        </div>
        <Textarea
          label="Notes (optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Anything worth passing on that isn't a squawk."
        />
        <PhotoUploader
          files={photos}
          onChange={setPhotos}
          hint="Optional — fuel state, oil level, anything you want on record."
        />
      </Card>

      {/* Squawks raised during this walkaround, filed when you submit. */}
      <Card className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Squawks from this preflight</h2>
          <Button variant="secondary" size="sm" onClick={() => setSquawkModalOpen(true)}>
            Report a squawk
          </Button>
        </div>
        {squawkDrafts.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Nothing reported. Anything you find here gets filed against this
            preflight when you submit.
          </p>
        ) : (
          <ul className="space-y-2">
            {squawkDrafts.map((draft, i) => (
              <li
                key={i}
                className="flex items-start gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700"
              >
                <Badge tone={SEVERITY_TONES[draft.severity]}>
                  {SEVERITY_LABELS[draft.severity]}
                </Badge>
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{draft.title}</span>
                  {draft.photos.length > 0 && (
                    <span className="ml-2 text-xs text-gray-500">
                      {draft.photos.length} photo{draft.photos.length > 1 ? "s" : ""}
                    </span>
                  )}
                </span>
                <button
                  onClick={() =>
                    setSquawkDrafts((rows) => rows.filter((_, index) => index !== i))
                  }
                  aria-label={`Remove ${draft.title}`}
                  className="text-gray-400 hover:text-red-600"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* The last mnemonic of the rules — not a checklist item because it's
          flown, not walked: you run it on every approach. */}
      <GumpsCard />

      {/* Submit. "Sign off" is gated on a complete checklist and says exactly
          what's missing when it isn't — never a silently disabled button. */}
      <div className="space-y-2 pb-2">
        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
            {error}
          </p>
        )}
        {saved && (
          <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-900/30 dark:text-green-300">
            {saved}
          </p>
        )}
        {!complete && (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {remaining.length} item{remaining.length === 1 ? "" : "s"} left, starting
            with <span className="font-medium">{remaining[0]?.label}</span>.
          </p>
        )}
        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <Button
            size="lg"
            onClick={() => submit(true)}
            disabled={busy || !complete}
            className="w-full sm:w-auto"
          >
            {busy ? <LoadingDots size="sm" /> : "Sign off preflight"}
          </Button>
          <Button
            size="lg"
            variant="secondary"
            onClick={() => submit(false)}
            disabled={busy || checked === 0}
            className="w-full sm:w-auto"
          >
            Save progress
          </Button>
        </div>
      </div>

      <SquawkDraftModal
        open={squawkModalOpen}
        onClose={() => setSquawkModalOpen(false)}
        onAdd={(draft) => setSquawkDrafts((rows) => [...rows, draft])}
      />
    </div>
  );
}

function Check() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
      <path
        d="M5 13l4 4L19 7"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        // Drawn rather than popped in — see the check-draw keyframe.
        strokeDasharray="24"
        strokeDashoffset="24"
        className="animate-check-draw"
      />
    </svg>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${
        open ? "rotate-180" : ""
      }`}
    >
      <path
        d="M6 8l4 4 4-4"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
