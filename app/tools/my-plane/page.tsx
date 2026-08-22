"use client";
// Tools › My plane — the numbers out of the airplane's own manual, on a screen
// instead of in a book in the back of the cabin.
//
// The airplane's Owner's Manual is a 68-year-old paperback that lives in the
// airplane. That is exactly the wrong place for it: the questions it answers —
// what's the flap speed, what does it stall at in a steep turn, how much
// runway does it need at gross on a hot day — get asked in the clubhouse the
// night before, or in the right seat with a student, or in the car park while
// somebody decides whether the load fits. So the numbers live here as well,
// with the page of the manual printed beside each one so any of them can be
// checked in a minute.
//
// Three things about how it's built are deliberate.
//
//   • It refuses rather than guesses. The manual's data is keyed by the same
//     profile id the weight & balance tool uses (see lib/pohReference.ts), and
//     an airplane the app has no manual for gets a card saying so — never
//     another type's speeds under this tail number.
//
//   • Every figure carries an (i), and the (i) is the point. A pilot who reads
//     "Vx 60 MPH" and can't say why they'd fly it has been given a number, not
//     taught anything; the popover says what it's for and when it bites.
//
//   • Two figures a modern POH would print are MISSING from this one, and the
//     page says so out loud. See the "not in this manual" card — a Va guessed
//     off a later 172's book is the one thing this page must never contain.
//
// The header pairs the type's data with THIS airframe's own facts (empty
// weight, useful load, what its meters read), because "my plane" is both
// halves and a member reading one usually wants the other in the same glance.
import Link from "next/link";
import Badge from "@/components/common/Badge";
import Card from "@/components/common/Card";
import InfoTip from "@/components/common/InfoTip";
import { useAircraft } from "@/components/AircraftProvider";
import { usePageLoading } from "@/components/LoadingProvider";
import { useMe } from "@/components/MeProvider";
import { formatFullDate } from "@/lib/dates";
import {
  AIRSPEED_UNIT,
  BANK_ANGLES,
  CLIMB_CONDITIONS,
  CLIMB_NOTES,
  CLIMB_RATES,
  DISTANCES,
  DISTANCE_CONDITIONS,
  DISTANCE_NOTES,
  FROM_ELSEWHERE,
  MANUAL_AIRSPEED_UNIT,
  STALL_CONDITIONS,
  STALL_NOTES,
  STALL_SPEEDS,
  displaySpeed,
  formatMph,
  knots,
  pohReferenceFor,
  stallKnots,
  type ReferenceFigure,
  type ReferenceSection,
} from "@/lib/pohReference";
import { profileFor } from "@/lib/weightBalance";

export default function MyPlanePage() {
  const { selected, loading: fleetLoading } = useAircraft();
  const { me } = useMe();
  usePageLoading(fleetLoading);

  const reference = pohReferenceFor(selected?.wbProfile);
  const wb = profileFor(selected?.wbProfile);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-bold">My plane</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {selected
            ? `${selected.tailNumber} — ${selected.model}`
            : "No airplane selected."}
        </p>
      </header>

      {!fleetLoading && selected && !reference ? (
        <NoManualCard
          tailNumber={selected.tailNumber}
          isAdmin={Boolean(me?.isAdmin)}
        />
      ) : reference && selected ? (
        <>
          {/* The unit note is the first thing on the page and is not a
              footnote anywhere else. The manual is MPH; the instrument is
              knots; both numbers are shown on every speed, and which is which
              has to be unmissable. */}
          <Card className="border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20">
            <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
              Speeds are shown in knots — what {selected.tailNumber}&rsquo;s
              airspeed indicator reads — with the manual&rsquo;s own MPH beside
              each one.
            </p>
            <p className="mt-0.5 text-sm text-amber-800 dark:text-amber-300">
              The 1958 manual is written in MPH throughout, so every knots
              figure here is a conversion this app did, not something out of the
              book. They round toward the safe side: a limit down, a stall or
              approach speed up, a range inward. Check the MPH column against
              the manual, and check both against the arcs actually painted on
              the dial — if the instrument was changed, its markings are the
              ones you fly.
            </p>
          </Card>

          <AirframeCard />

          {reference.sections.map((section) => (
            <SectionCard key={section.id} section={section} />
          ))}

          <StallCard />

          <ClimbCard />

          <DistanceCard />

          <ElsewhereCard />

          <Card className="space-y-2 text-xs text-gray-500 dark:text-gray-400">
            <p>
              Transcribed from the {reference.manual}. Page numbers are cited on
              every figure so any of them can be checked against the book, which
              is the authority — this page is a faster index into it, not a
              replacement for it, and it carries none of the airplane&rsquo;s
              placards, ADs or equipment list.
            </p>
            {wb ? (
              <p>
                Loading stations and the CG envelope come from the same manual
                and live in{" "}
                <Link
                  href="/tools/weight-balance"
                  className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                >
                  Weight &amp; Balance
                </Link>
                , which computes them against this airframe&rsquo;s own basis.
              </p>
            ) : null}
          </Card>
        </>
      ) : null}
    </div>
  );

  /**
   * THIS airframe, as opposed to the type.
   *
   * STATIC FACTS ONLY, and that rule is what the card is for. The tach and the
   * Hobbs were here at first and were wrong to be: a reading that changes every
   * time somebody flies belongs on Plane Status, which is the tab that answers
   * "what is the airplane doing today". This page is the airplane's spec
   * sheet — you read it to plan, you screenshot it, you quote it to a student —
   * and a number on it that was stale an hour after you looked makes the whole
   * page untrustworthy at a glance, because nothing on the page says which of
   * its numbers are the moving ones.
   *
   * What survives changes only when an A&P signs something: the empty weight
   * and the date it was weighed come off the latest Weight/Balance & Equipment
   * List Revision, and the tank and gross figures are the type's. Useful load
   * is shown beside gross because it's the difference between the two and is
   * otherwise a sum done in your head at the wrong moment.
   */
  function AirframeCard() {
    if (!selected) return null;
    const useful =
      wb && selected.emptyWeightLbs != null
        ? Math.round((wb.maxGrossLbs - selected.emptyWeightLbs) * 10) / 10
        : null;

    return (
      <Card className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">This airframe</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {reference?.type}
            </p>
          </div>
          {selected.homeBase ? (
            <Badge tone="gray">{selected.homeBase}</Badge>
          ) : null}
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
          <Fact label="Empty weight">
            {selected.emptyWeightLbs != null
              ? `${selected.emptyWeightLbs.toLocaleString("en-US")} lb`
              : "—"}
          </Fact>
          <Fact label="Useful load">
            {useful != null ? `${useful.toLocaleString("en-US")} lb` : "—"}
          </Fact>
          <Fact label="Gross weight">
            {wb ? `${wb.maxGrossLbs.toLocaleString("en-US")} lb` : "—"}
          </Fact>
          <Fact label="Fuel capacity">
            {selected.fuelCapacityGal != null
              ? `${selected.fuelCapacityGal} gal`
              : "—"}
          </Fact>
          <Fact label="Weighed">
            {selected.weighedOn ? formatFullDate(selected.weighedOn) : "—"}
          </Fact>
        </dl>

        <p className="text-xs text-gray-500 dark:text-gray-400">
          {selected.emptyWeightLbs != null
            ? "Empty weight is off this airframe's latest Weight/Balance & Equipment List Revision, and changes only when an A&P signs a new one. "
            : "No empty weight on file for this airframe. "}
          Nothing on this page moves with the flying —{" "}
          <Link
            href="/status"
            className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
          >
            Plane Status
          </Link>{" "}
          has the meters and what the airplane is due for.
        </p>
      </Card>
    );
  }
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider text-gray-400 dark:text-gray-500">
        {label}
      </dt>
      <dd className="font-mono text-sm font-medium">{children}</dd>
    </div>
  );
}

/**
 * One section of the manual's figures.
 *
 * Rendered flat rather than in an accordion, unlike the checkout pages: this
 * is a page you SCAN for one number, and a number behind a disclosure is a
 * number you can't find with ⌘F or with your thumb. The checkouts collapse
 * because they're a sequence you work down; this isn't one.
 */
function SectionCard({ section }: { section: ReferenceSection }) {
  return (
    <Card className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold">{section.title}</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400">{section.blurb}</p>
      </div>
      <ul className="divide-y divide-gray-100 dark:divide-gray-700">
        {section.figures.map((figure) => (
          <FigureRow key={figure.id} figure={figure} />
        ))}
      </ul>
    </Card>
  );
}

/**
 * Colour by how hard the figure bites, and RED IS RESERVED for a limit you may
 * not cross — the same rule the checkout pages' squawk notes follow. Painting
 * a caution-range figure red teaches members to read past the colour that
 * actually stops something.
 */
const SEVERITY_VALUE_CLASSES: Record<string, string> = {
  limit: "text-red-600 dark:text-red-400",
  caution: "text-amber-600 dark:text-amber-400",
};

function FigureRow({ figure }: { figure: ReferenceFigure }) {
  // Knots big, the manual's MPH small underneath. The MPH line is not
  // decoration: it is what you check the book against, and it is the figure
  // that is actually published — the knots above it is this app's arithmetic.
  const shown = displaySpeed(figure);
  return (
    <li className="flex items-baseline justify-between gap-3 py-2">
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-1.5">
          {figure.code ? (
            <span className="font-mono text-sm font-semibold text-indigo-600 dark:text-indigo-400">
              {figure.code}
            </span>
          ) : null}
          <span className="text-sm">{figure.label}</span>
          {/* The (i) sits OUTSIDE any interactive element — an <a> or a button
              inside another is the invalid nesting CheckoutList documents. */}
          <InfoTip label={`Why: ${figure.label}`}>
            <span className="block">{figure.why}</span>
            <span className="mt-2 block text-xs text-gray-400 dark:text-gray-500">
              {figure.source}
              {shown.manual
                ? ` · published as ${shown.manual}, converted to knots here`
                : ""}
            </span>
          </InfoTip>
        </div>
        {figure.condition ? (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {figure.condition}
          </p>
        ) : null}
      </div>
      <span className="shrink-0 text-right">
        <span
          className={`block font-mono text-sm font-semibold ${
            figure.severity ? SEVERITY_VALUE_CLASSES[figure.severity] : ""
          }`}
        >
          {shown.primary}
        </span>
        {shown.manual ? (
          <span className="block font-mono text-[11px] text-gray-400 dark:text-gray-500">
            {shown.manual}
          </span>
        ) : null}
      </span>
    </li>
  );
}

/**
 * The stall table, kept as a table.
 *
 * A list of eleven separate speeds would hide the one thing the table is for:
 * what happens along the BANK axis. 51 kt clean and level becomes 72 kt in a
 * 60° turn, and a steep slow turn onto final is where that catches people — so
 * the bank angles are columns and the eye runs along them.
 *
 * Knots lead and the manual's MPH sits under each one in grey. Every knots
 * figure here is rounded UP: a stall speed rounded down is the one conversion
 * error in this file that could hurt somebody.
 */
function StallCard() {
  return (
    <Card className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold">Stall speeds</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {STALL_CONDITIONS}
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[22rem] text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wider text-gray-400 dark:text-gray-500">
              <th className="pb-1 text-left font-semibold">Configuration</th>
              {BANK_ANGLES.map((bank) => (
                <th key={bank} className="pb-1 text-right font-semibold">
                  {bank}° bank
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {STALL_SPEEDS.map((row) => {
              const kt = stallKnots(row);
              return (
                <tr key={row.flaps}>
                  <td className="py-1.5 align-top">
                    <span className="flex items-center gap-1">
                      <span className="text-gray-600 dark:text-gray-300">
                        {row.flaps}
                      </span>
                      <InfoTip label={`Why: ${row.flaps}`}>{row.why}</InfoTip>
                    </span>
                  </td>
                  {kt.map((speed, i) => (
                    <td key={BANK_ANGLES[i]} className="py-1.5 text-right align-top">
                      <span className="block font-mono font-medium">
                        {speed} {AIRSPEED_UNIT}
                      </span>
                      <span className="block font-mono text-[11px] text-gray-400 dark:text-gray-500">
                        {row.mph[i]} {MANUAL_AIRSPEED_UNIT}
                      </span>
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ul className="list-disc space-y-1 pl-4 text-xs text-gray-500 dark:text-gray-400">
        {STALL_NOTES.map((note, i) => (
          <li key={i}>{note}</li>
        ))}
      </ul>
    </Card>
  );
}

/**
 * How fast it goes UP, which the airspeed section can't tell you.
 *
 * Its own table because the shape is the lesson: 660 ft/min at sea level is
 * 240 by 10,000 ft and 30 by 15,000. This airplane runs out of climb a long
 * way below where a pilot used to a modern 172 would expect it to, and that is
 * a planning fact about crossing anything on the way to the desert.
 */
function ClimbCard() {
  return (
    <Card className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold">Climb rate</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {CLIMB_CONDITIONS}
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[22rem] text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wider text-gray-400 dark:text-gray-500">
              <th className="pb-1 text-left font-semibold">Altitude</th>
              <th className="pb-1 text-right font-semibold">Best rate speed</th>
              <th className="pb-1 text-right font-semibold">Rate of climb</th>
              <th className="pb-1 text-right font-semibold">Fuel from S.L.</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {CLIMB_RATES.map((row) => (
              <tr key={row.altitude}>
                <td className="py-1.5 text-gray-600 dark:text-gray-300">
                  {row.altitude}
                  <span className="ml-1 text-xs text-gray-400">
                    {row.temperature}
                  </span>
                </td>
                <td className="py-1.5 text-right align-top">
                  <span className="block font-mono font-medium">
                    {knots(row.bestRateMph, "target")} {AIRSPEED_UNIT}
                  </span>
                  <span className="block font-mono text-[11px] text-gray-400 dark:text-gray-500">
                    {formatMph(row.bestRateMph)}
                  </span>
                </td>
                <td className="py-1.5 text-right font-mono font-medium">
                  {row.feetPerMinute.toLocaleString("en-US")} ft/min
                </td>
                <td className="py-1.5 text-right font-mono text-gray-500 dark:text-gray-400">
                  {row.fuelUsedGal != null ? `${row.fuelUsedGal} gal` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="list-disc space-y-1 pl-4 text-xs text-gray-500 dark:text-gray-400">
        {CLIMB_NOTES.map((note, i) => (
          <li key={i}>{note}</li>
        ))}
      </ul>
    </Card>
  );
}

/** Runway needed at gross — the heavy column only. See lib/pohReference.ts. */
function DistanceCard() {
  return (
    <Card className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold">Runway needed at gross</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {DISTANCE_CONDITIONS}
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[26rem] text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wider text-gray-400 dark:text-gray-500">
              <th className="pb-1 text-left font-semibold">Altitude</th>
              <th className="pb-1 text-right font-semibold">T/O roll</th>
              <th className="pb-1 text-right font-semibold">T/O over 50 ft</th>
              <th className="pb-1 text-right font-semibold">Ldg roll</th>
              <th className="pb-1 text-right font-semibold">Ldg over 50 ft</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {DISTANCES.map((row) => (
              <tr key={row.altitude}>
                <td className="py-1.5 text-gray-600 dark:text-gray-300">
                  {row.altitude}
                  <span className="ml-1 text-xs text-gray-400">
                    {row.temperature}
                  </span>
                </td>
                <td className="py-1.5 text-right font-mono">
                  {row.takeoffGroundRun.toLocaleString("en-US")}
                </td>
                <td className="py-1.5 text-right font-mono font-medium">
                  {row.takeoffOver50.toLocaleString("en-US")}
                </td>
                <td className="py-1.5 text-right font-mono">
                  {row.landingGroundRoll.toLocaleString("en-US")}
                </td>
                <td className="py-1.5 text-right font-mono font-medium">
                  {row.landingOver50.toLocaleString("en-US")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-400 dark:text-gray-500">All figures in feet.</p>

      <ul className="list-disc space-y-1 pl-4 text-xs text-gray-500 dark:text-gray-400">
        {DISTANCE_NOTES.map((note, i) => (
          <li key={i}>{note}</li>
        ))}
      </ul>
    </Card>
  );
}

/**
 * The three figures this manual doesn't print, filled in from elsewhere.
 *
 * Leaving them blank was the first version of this card and it wasn't good
 * enough. A pilot who can't find Va does not conclude the airplane hasn't got
 * one — they fill it in from a later 172's book, or a forum, or memory, and
 * say nothing. So the numbers are here, sourced, with the airframe they
 * actually belong to named.
 *
 * Which makes the LABELLING the load-bearing part of this component, not the
 * numbers. Every one of these gets an amber "found online" chip, a line
 * saying what N8318B's own manual gives instead, a line naming where the
 * figure came from, and a line on why it can't simply be adopted. A reader
 * skimming must not be able to mistake one of these for something out of the
 * book — which is why they sit in their own card, after everything the manual
 * does say, in a different colour, rather than mixed in with the sections
 * above.
 */
function ElsewhereCard() {
  return (
    <Card className="space-y-4 border-amber-300 dark:border-amber-800">
      <div>
        <h2 className="text-sm font-semibold">
          Not in this manual — found online
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          A 1958 owner&rsquo;s manual predates a lot of what a modern POH
          prints. These three are missing from it entirely, so the figures below
          come from published sources for RELATED airframes and from general
          practice — not from {`N8318B`}&rsquo;s book, and not adopted by the
          club. Each says where it came from. Treat them as the start of a
          conversation with an instructor, not as limits.
        </p>
      </div>

      <ul className="space-y-4">
        {FROM_ELSEWHERE.map((gap) => (
          <li
            key={gap.id}
            className="space-y-1 border-t border-gray-100 pt-3 first:border-0 first:pt-0 dark:border-gray-700"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
              <span className="flex flex-wrap items-baseline gap-x-1.5">
                {gap.code ? (
                  <span className="font-mono text-sm font-semibold text-gray-400 dark:text-gray-500">
                    {gap.code}
                  </span>
                ) : null}
                <span className="text-sm font-medium">{gap.label}</span>
                <Badge tone="amber">Found online</Badge>
              </span>
              <span className="text-right">
                <span className="block font-mono text-sm font-semibold text-amber-700 dark:text-amber-300">
                  {gap.value}
                </span>
                {gap.manualUnits ? (
                  <span className="block font-mono text-[11px] text-gray-400 dark:text-gray-500">
                    {gap.manualUnits}
                  </span>
                ) : null}
              </span>
            </div>

            <Sourced label="This manual says">{gap.instead}</Sourced>
            <Sourced label="Found">{gap.found}</Sourced>
            <Sourced label="Before you fly it">{gap.caution}</Sourced>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** One labelled line inside a found-online figure. */
function Sourced({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <p className="text-xs text-gray-600 dark:text-gray-300">
      <span className="font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
        {label}:
      </span>{" "}
      {children}
    </p>
  );
}

/**
 * What the page says when it has no manual for the airplane.
 *
 * Same refusal as the weight & balance tool's, and for the same reason: a
 * Piper's stall speeds printed under a 172's tail number is the exact mistake
 * worth being unable to make.
 */
function NoManualCard({
  tailNumber,
  isAdmin,
}: {
  tailNumber: string;
  isAdmin: boolean;
}) {
  return (
    <Card className="space-y-3">
      <h2 className="text-sm font-semibold">No manual data for {tailNumber}</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400">
        This airplane isn&rsquo;t matched to a type the app holds a manual for,
        so there are no speeds or limits to show. It won&rsquo;t fall back to
        another type&rsquo;s — a stall speed off the wrong airframe is worse
        than no page at all. The type is the same setting the weight &amp;
        balance profile uses.
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
          Ask a club admin to set it in Club settings.
        </p>
      )}
    </Card>
  );
}
