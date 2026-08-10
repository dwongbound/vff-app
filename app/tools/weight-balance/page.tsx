"use client";
// Tools › Weight & Balance — the sum every pilot does before a loaded flight,
// for THIS airplane, with its own empty weight already filled in.
//
// The point isn't that the arithmetic is hard; it's that it's fiddly, done
// under time pressure at a table with people waiting, and wrong in ways that
// look right (a transposed digit in a moment still totals to something
// plausible). So the page does three things a paper form can't:
//
//   • starts from the airframe's CURRENT basis, off its latest W&B revision,
//     rather than whatever was photocopied into the binder years ago;
//   • checks where you LAND as well as where you take off — the tanks are aft
//     of the CG, so every flight drifts forward as it burns (see the chart);
//   • answers the question people actually ask next, which is not "am I
//     legal" but "how much more will it take" — per station, against whichever
//     limit bites first.
//
// It shows its working: the same line-by-line weight × arm = moment table a
// pilot would write out by hand, because a bare verdict is not something
// anyone should be asked to take on faith.
//
// Nothing here is stored. A W&B is true of one load on one day, and a saved
// one is a stale one — the airplane's persistent facts (empty weight, moment,
// the date it was weighed) live on the Aircraft row and are edited in Club
// settings, where changing them is a deliberate act.
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import Badge from "@/components/common/Badge";
import Button from "@/components/common/Button";
import Card from "@/components/common/Card";
import InfoTip from "@/components/common/InfoTip";
import Input from "@/components/common/Input";
import WeightBalanceChart from "@/components/WeightBalanceChart";
import { useAircraft } from "@/components/AircraftProvider";
import { usePageLoading } from "@/components/LoadingProvider";
import { useMe } from "@/components/MeProvider";
import { fetchJsonArray } from "@/lib/api";
// Both date formats, for two different jobs: formatFullDate for the WEIGHING
// date, where "Sat, Nov 27" leaves off the one part that decides anything
// (which year it was), and formatDay for "when was the fuel last dipped",
// where the year would be noise on a reading days old.
import { formatDay, formatFullDate } from "@/lib/dates";
import {
  allHeadroom,
  computeWeightBalance,
  describeBlocker,
  describeProblem,
  formatMoment,
  formatQuantity,
  profileFor,
  withStationEmptied,
  type Loading,
  type Station,
  type WeightBalanceBasis,
  type WeightBalanceProfile,
} from "@/lib/weightBalance";
import type { ApiCheckout } from "@/lib/types";

/**
 * What the airplane was last measured to be carrying — the same figures Plane
 * Status shows, off the last preflight checkout that actually recorded them.
 *
 * The tool is still pure arithmetic over what's in the boxes; this only decides
 * what the boxes OPEN at. Starting the fuel box at "full" was a guess that was
 * wrong more often than it was right (the airplane is rarely full), and a
 * member who forgot to correct it planned a flight 100 lb heavy at the tanks.
 */
interface RecordedConsumables {
  fuelGal: number | null;
  oilQts: number | null;
  /** Whose walkaround, and when — this is a measurement, so it's attributed. */
  fuelNote: string | null;
  oilNote: string | null;
}

export default function WeightBalancePage() {
  const { selected, loading: fleetLoading } = useAircraft();
  const { me } = useMe();
  usePageLoading(fleetLoading);

  // The last few preflights, for the fuel and oil the airplane was left with.
  // Falling further back than the most recent one is deliberate: a checkout
  // where the pilot skipped the dip tells us nothing, and the reading before it
  // is a better answer than none.
  const aircraftId = selected?.id ?? null;
  const [recorded, setRecorded] = useState<RecordedConsumables>(EMPTY_RECORD);
  useEffect(() => {
    if (!aircraftId) return;
    let live = true;
    fetchJsonArray<ApiCheckout>(
      `/api/checkouts?aircraftId=${aircraftId}&kind=PREFLIGHT&limit=5`
    ).then((rows) => {
      if (!live) return;
      const fuel = rows.find((c) => c.fuelOnBoardGal != null) ?? null;
      const oil = rows.find((c) => c.oilQuarts != null) ?? null;
      const from = (c: ApiCheckout) =>
        `${c.user.name}'s preflight, ${formatDay(new Date(c.createdAt))}`;
      setRecorded({
        fuelGal: fuel?.fuelOnBoardGal ?? null,
        oilQts: oil?.oilQuarts ?? null,
        fuelNote: fuel ? from(fuel) : null,
        oilNote: oil ? from(oil) : null,
      });
    });
    return () => {
      live = false;
    };
  }, [aircraftId]);

  const profile = profileFor(selected?.wbProfile ?? null);
  const basis: WeightBalanceBasis | null =
    selected?.emptyWeightLbs != null && selected?.emptyMomentLbIn != null
      ? {
          emptyWeightLbs: selected.emptyWeightLbs,
          emptyMomentLbIn: selected.emptyMomentLbIn,
        }
      : null;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-bold">Weight &amp; Balance</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {selected
            ? `${selected.tailNumber} — ${selected.model}`
            : "No airplane selected."}
        </p>
      </header>

      {!fleetLoading && selected && (!profile || !basis) ? (
        <MissingBasisCard
          tailNumber={selected.tailNumber}
          hasProfile={Boolean(profile)}
          hasBasis={Boolean(basis)}
          isAdmin={Boolean(me?.isAdmin)}
        />
      ) : profile && basis && selected ? (
        <Calculator
          // Keyed on the recorded fuel as well as the airplane: the reading
          // arrives a moment after the page does, and the boxes are
          // initial-state, so the calculator has to be rebuilt to take it.
          key={`${selected.id}:${recorded.fuelGal ?? "?"}`}
          profile={profile}
          basis={basis}
          weighedOn={selected.weighedOn}
          recorded={recorded}
        />
      ) : null}
    </div>
  );
}

const EMPTY_RECORD: RecordedConsumables = {
  fuelGal: null,
  oilQts: null,
  fuelNote: null,
  oilNote: null,
};

/**
 * What the tool says when it can't do the sum.
 *
 * Refusing is the whole design: an airplane with no profile is one whose
 * stations the app does not know, and loading it against a 172's arms because
 * a 172 is what the club usually flies is the exact mistake worth being unable
 * to make.
 */
function MissingBasisCard({
  tailNumber,
  hasProfile,
  hasBasis,
  isAdmin,
}: {
  tailNumber: string;
  hasProfile: boolean;
  hasBasis: boolean;
  isAdmin: boolean;
}) {
  return (
    <Card className="space-y-3">
      <h2 className="text-sm font-semibold">
        No weight &amp; balance data for {tailNumber}
      </h2>
      <p className="text-sm text-gray-500 dark:text-gray-400">
        {!hasProfile
          ? "This airplane isn't matched to a weight & balance profile, so the app doesn't know where its seats, tanks and baggage compartment are. It won't guess — the arms of one type applied to another is exactly the error this page exists to prevent."
          : null}
        {!hasProfile && !hasBasis ? " " : null}
        {!hasBasis
          ? "This airplane has no empty weight and moment on file. They come off its most recent Weight/Balance & Equipment List Revision — the signed sheet an A&P produces after any equipment change."
          : null}
      </p>
      {isAdmin ? (
        <Link
          href="/settings"
          className="inline-block text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400"
        >
          Set it in Club settings →
        </Link>
      ) : (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Ask a club admin to add it in Club settings.
        </p>
      )}
    </Card>
  );
}

function Calculator({
  profile,
  basis,
  weighedOn,
  recorded,
}: {
  profile: WeightBalanceProfile;
  basis: WeightBalanceBasis;
  weighedOn: string | null;
  recorded: RecordedConsumables;
}) {
  /**
   * What each box opens at: the airplane's OWN last-measured fuel where there
   * is one, otherwise the profile's preset.
   *
   * Only the fuel station is prefilled from a measurement, and the oil is the
   * reason why. This airframe's basis is a modern BASIC empty weight, which
   * already includes its full 8 quarts — typing the dipstick reading in again
   * would add 15 lb at arm −20 (the furthest forward station on the airplane)
   * to every result. So the recorded oil is SHOWN under that box rather than
   * put in it; see the station's own `why`, and lib/weightBalance.ts.
   */
  const openingEntries = () =>
    Object.fromEntries(
      profile.stations.map((s) => {
        if (s.id === "fuel" && recorded.fuelGal != null) {
          return [s.id, String(recorded.fuelGal)];
        }
        return [s.id, s.preset != null ? String(s.preset) : ""];
      })
    );

  // Held as STRINGS so an empty box stays empty. Storing numbers means a
  // cleared field becomes 0 and immediately renders as "0", which you then
  // have to select and overwrite to type your own weight into.
  const [entries, setEntries] = useState<Record<string, string>>(openingEntries);

  const loading: Loading = useMemo(
    () =>
      Object.fromEntries(
        profile.stations.map((s) => [s.id, Number(entries[s.id] ?? "")])
      ),
    [entries, profile.stations]
  );

  const takeoff = useMemo(
    () => computeWeightBalance(profile, basis, loading),
    [profile, basis, loading]
  );
  // Same load, no usable fuel: where the CG sits on the last gallon.
  const landing = useMemo(
    () => computeWeightBalance(profile, basis, withStationEmptied(loading, "fuel")),
    [profile, basis, loading]
  );
  const headroom = useMemo(
    () => allHeadroom(profile, basis, loading),
    [profile, basis, loading]
  );

  // The case worth calling out separately: legal at the pump, illegal on the
  // last gallon. A takeoff-only check waves it straight through.
  const landsOutOfLimits = takeoff.withinLimits && !landing.withinLimits;

  const groups = useMemo(() => {
    const byGroup = new Map<string, Station[]>();
    for (const station of profile.stations) {
      byGroup.set(station.group, [...(byGroup.get(station.group) ?? []), station]);
    }
    return [...byGroup.entries()];
  }, [profile.stations]);

  // Back to what the page opened at — including the measured fuel, which is
  // the airplane as it stands rather than a default worth clearing.
  const reset = () => setEntries(openingEntries());

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* ── What's aboard ───────────────────────────────────────────────── */}
      <div className="space-y-4">
        <Card className="space-y-4">
          <div className="flex items-start justify-between gap-2">
            <h2 className="text-sm font-semibold">What&rsquo;s aboard</h2>
            <Button size="sm" variant="secondary" onClick={reset}>
              Reset
            </Button>
          </div>

          {groups.map(([group, stations]) => (
            <div key={group} className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                {group}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {stations.map((station) => (
                  <Input
                    key={station.id}
                    label={station.label}
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step={station.unit === "lb" ? "1" : "0.5"}
                    max={station.max}
                    value={entries[station.id] ?? ""}
                    onChange={(e) =>
                      setEntries((prev) => ({ ...prev, [station.id]: e.target.value }))
                    }
                    placeholder="0"
                    hint={
                      <span className="flex flex-col gap-0.5">
                        <span className="flex items-center gap-1">
                          <span>
                            {UNIT_LABELS[station.unit]} · arm {station.arm} in
                            {station.max != null
                              ? ` · max ${station.max} ${station.unit}`
                              : ""}
                          </span>
                          <InfoTip label={`Why: ${station.label}`}>
                            {station.why}
                          </InfoTip>
                        </span>
                        {/* What the airplane was last measured to be carrying.
                            Under the FUEL box it explains where the number in
                            it came from; under the OIL box it's a note and not
                            a prefill, because this airframe's empty weight
                            already includes its oil. */}
                        {station.id === "fuel" && recorded.fuelNote && (
                          <span className="text-indigo-600 dark:text-indigo-400">
                            {recorded.fuelGal} gal from {recorded.fuelNote}
                          </span>
                        )}
                        {station.id === "oil" && recorded.oilNote && (
                          <span>
                            {recorded.oilQts} qt on the dipstick (
                            {recorded.oilNote}) — leave this at 0 unless the
                            basis is a licensed empty weight.
                          </span>
                        )}
                      </span>
                    }
                  />
                ))}
              </div>
            </div>
          ))}
        </Card>

        <BasisCard profile={profile} basis={basis} weighedOn={weighedOn} takeoff={takeoff} />
      </div>

      {/* ── What it comes to ────────────────────────────────────────────── */}
      <div className="space-y-4">
        <VerdictCard takeoff={takeoff} landsOutOfLimits={landsOutOfLimits} landing={landing} />

        <Card className="space-y-3">
          <h2 className="text-sm font-semibold">Where that puts the CG</h2>
          <WeightBalanceChart profile={profile} takeoff={takeoff} landing={landing} />
        </Card>

        <Card className="space-y-3">
          <h2 className="text-sm font-semibold">Room left</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            How much more each station will take, against whichever limit stops
            it first.
          </p>
          <ul className="divide-y divide-gray-100 text-sm dark:divide-gray-700">
            {headroom.map((room) => (
              <li
                key={room.station.id}
                className="flex items-baseline justify-between gap-3 py-1.5"
              >
                <span className="text-gray-600 dark:text-gray-300">
                  {room.station.label}
                </span>
                <span className="text-right">
                  <span
                    className={`font-mono font-medium ${
                      room.maxAdditional === 0
                        ? "text-red-600 dark:text-red-400"
                        : ""
                    }`}
                  >
                    +{formatQuantity(room.maxAdditional)} {room.station.unit}
                  </span>
                  <span className="ml-2 text-xs text-gray-400 dark:text-gray-500">
                    {describeBlocker(room.blockedBy)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Card>

        <WorkingCard takeoff={takeoff} />
      </div>
    </div>
  );
}

const UNIT_LABELS: Record<Station["unit"], string> = {
  lb: "pounds",
  gal: "US gallons",
  qt: "quarts",
};

/** The headline: is this load legal, and by how much. */
function VerdictCard({
  takeoff,
  landing,
  landsOutOfLimits,
}: {
  takeoff: ReturnType<typeof computeWeightBalance>;
  landing: ReturnType<typeof computeWeightBalance>;
  landsOutOfLimits: boolean;
}) {
  const ok = takeoff.withinLimits;
  return (
    <Card
      className={`space-y-3 ${
        ok
          ? "border-green-300 dark:border-green-800"
          : "border-red-300 dark:border-red-800"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">At takeoff</h2>
        <Badge tone={ok ? "green" : "red"}>
          {ok ? "Within limits" : "Out of limits"}
        </Badge>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <Figure label="Weight" value={formatQuantity(takeoff.totalWeightLbs)} unit="lb" />
        <Figure
          label="CG"
          value={takeoff.cgIn === null ? "—" : String(takeoff.cgIn)}
          unit="in"
        />
        <Figure
          label={takeoff.remainingLbs < 0 ? "Over by" : "Spare"}
          value={formatQuantity(Math.abs(takeoff.remainingLbs))}
          unit="lb"
          tone={takeoff.remainingLbs < 0 ? "bad" : undefined}
        />
      </div>

      {!ok && (
        <ul className="space-y-1 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
          {takeoff.problems.map((problem, i) => (
            <li key={i}>{describeProblem(problem)}</li>
          ))}
        </ul>
      )}

      {/* Fuel burn moves the CG forward, so a load can pass here and fail on
          the last gallon. That case gets its own line rather than being
          folded into the verdict — it's a different flight phase. */}
      {landsOutOfLimits && (
        <div className="space-y-1 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
          <p className="font-medium">Legal at takeoff, out of limits on landing.</p>
          {landing.problems.map((problem, i) => (
            <p key={i}>
              With the fuel burned off: {describeProblem(problem).toLowerCase()}
            </p>
          ))}
        </div>
      )}

      {ok && !landsOutOfLimits && landing.cgIn !== null && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          With the usable fuel burned off it lands at{" "}
          {formatQuantity(landing.totalWeightLbs)} lb, CG {landing.cgIn} in — also
          within limits.
        </p>
      )}
    </Card>
  );
}

function Figure({
  label,
  value,
  unit,
  tone,
}: {
  label: string;
  value: string;
  unit: string;
  tone?: "bad";
}) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-gray-400 dark:text-gray-500">
        {label}
      </p>
      <p
        className={`font-mono text-xl font-semibold ${
          tone === "bad" ? "text-red-600 dark:text-red-400" : ""
        }`}
      >
        {value}
        <span className="ml-0.5 text-xs font-normal text-gray-400">{unit}</span>
      </p>
    </div>
  );
}

/** The line-by-line table — the same one you'd write out by hand. */
function WorkingCard({ takeoff }: { takeoff: ReturnType<typeof computeWeightBalance> }) {
  return (
    <Card className="space-y-3">
      <h2 className="text-sm font-semibold">The working</h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[20rem] text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider text-gray-400 dark:text-gray-500">
              <th className="pb-1 font-semibold">Item</th>
              <th className="pb-1 text-right font-semibold">Weight</th>
              <th className="pb-1 text-right font-semibold">Arm</th>
              <th className="pb-1 text-right font-semibold">Moment/1000</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            <tr>
              <td className="py-1.5 text-gray-600 dark:text-gray-300">
                Empty weight
              </td>
              <td className="py-1.5 text-right font-mono">
                {formatQuantity(takeoff.emptyWeightLbs)}
              </td>
              <td className="py-1.5 text-right font-mono text-gray-500">
                {takeoff.emptyArmIn}
              </td>
              <td className="py-1.5 text-right font-mono">
                {formatMoment(takeoff.emptyMomentLbIn)}
              </td>
            </tr>
            {takeoff.lines.map((line) => (
              <tr
                key={line.station.id}
                className={line.weightLbs === 0 ? "text-gray-400 dark:text-gray-500" : ""}
              >
                <td className="py-1.5 text-gray-600 dark:text-gray-300">
                  {line.station.label}
                  {line.station.unit !== "lb" && line.amount > 0 && (
                    <span className="ml-1 text-xs text-gray-400">
                      ({line.amount} {line.station.unit})
                    </span>
                  )}
                </td>
                <td className="py-1.5 text-right font-mono">
                  {formatQuantity(line.weightLbs)}
                </td>
                <td className="py-1.5 text-right font-mono text-gray-500">
                  {line.station.arm}
                </td>
                <td className="py-1.5 text-right font-mono">
                  {formatMoment(line.momentLbIn)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-200 font-semibold dark:border-gray-600">
              <td className="pt-1.5">Total</td>
              <td className="pt-1.5 text-right font-mono">
                {formatQuantity(takeoff.totalWeightLbs)}
              </td>
              <td className="pt-1.5 text-right font-mono">
                {takeoff.cgIn === null ? "—" : takeoff.cgIn}
              </td>
              <td className="pt-1.5 text-right font-mono">
                {formatMoment(takeoff.totalMomentLbIn)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  );
}

/** What the sum was computed FROM — the half a pilot has to be able to check. */
function BasisCard({
  profile,
  basis,
  weighedOn,
  takeoff,
}: {
  profile: WeightBalanceProfile;
  basis: WeightBalanceBasis;
  weighedOn: string | null;
  takeoff: ReturnType<typeof computeWeightBalance>;
}) {
  return (
    <Card className="space-y-3 text-sm">
      <h2 className="text-sm font-semibold">What this is computed from</h2>

      <dl className="space-y-1.5 text-gray-600 dark:text-gray-300">
        <Row label="Empty weight">
          {formatQuantity(basis.emptyWeightLbs)} lb at {takeoff.emptyArmIn} in
        </Row>
        <Row label="Useful load">{formatQuantity(takeoff.usefulLoadLbs)} lb</Row>
        <Row label="Gross weight">
          {profile.maxGrossLbs.toLocaleString("en-US")} lb (normal category)
        </Row>
        <Row label="CG limits">
          {profile.forwardCgIn} to {profile.aftCgIn} in aft of datum
        </Row>
        <Row label="Weighed">
          {weighedOn ? (
            formatFullDate(weighedOn)
          ) : (
            <span className="text-amber-600 dark:text-amber-400">
              no date on file
            </span>
          )}
        </Row>
      </dl>

      <p className="text-xs text-gray-500 dark:text-gray-400">
        Stations and envelope: {profile.source}. Empty weight and moment come
        from this airframe&rsquo;s latest Weight/Balance &amp; Equipment List
        Revision, kept in Club settings — if an A&amp;P has signed a newer one,
        it needs entering there before this page is right.
      </p>

      <ul className="list-disc space-y-1 pl-4 text-xs text-gray-500 dark:text-gray-400">
        {profile.notes.map((note, i) => (
          <li key={i}>{note}</li>
        ))}
      </ul>
    </Card>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  );
}
