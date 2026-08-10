"use client";
// The Status tab's frame: which airplane, whether it flies, and the two views
// of it (Overview / Squawks).
//
// The header and the dispatch banner live HERE rather than on Overview because
// they're true of the airplane, not of a view — a member who walked into the
// Squawks tab to read why the airplane is down should not have to go back to
// Overview to see that it is.
//
// Overview and Squawks are RAIL children under Plane Status (see Navbar's NAV),
// exactly like Preflight/Runway/Post-flight under Checkouts — not tabs drawn
// inside the page. So this layout carries no navigation at all: just the two
// things both children need above them.
import Link from "next/link";
import Badge from "@/components/common/Badge";
import { useAircraft } from "@/components/AircraftProvider";


export default function StatusLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { selected } = useAircraft();

  const grounded = selected?.groundingSquawks ?? [];
  const inWork = selected?.inWorkSquawks ?? [];
  const airworthy = grounded.length === 0;

  return (
    <div className="space-y-4">
      {selected && (
        <header className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold">{selected.tailNumber}</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {[selected.model, selected.year, selected.homeBase]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <Badge tone={airworthy ? "green" : "red"}>
            {airworthy ? "Airworthy" : "Grounded"}
          </Badge>
        </header>
      )}

      {/* The dispatch answer, in priority order: grounded outranks in-work,
          because an airplane that is both is simply not flying and saying
          "in maintenance" underneath would soften it. */}
      {grounded.length > 0 ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-500/40 dark:bg-red-900/20">
          <h2 className="text-sm font-semibold text-red-800 dark:text-red-200">
            Do not fly — {grounded.length}{" "}
            {grounded.length === 1 ? "squawk has" : "squawks have"} grounded{" "}
            {selected?.tailNumber ?? "the airplane"}
          </h2>
          <ul className="mt-3 space-y-1.5 text-sm text-red-800 dark:text-red-200">
            {grounded.map((s) => (
              <li key={s.id} className="flex gap-2">
                <span aria-hidden="true" className="text-lg leading-5 opacity-70">
                  ·
                </span>
                <span>{s.title}</span>
              </li>
            ))}
          </ul>
          <Link
            href="/status/squawks"
            className="mt-3 inline-block text-sm font-medium text-red-800 underline dark:text-red-200"
          >
            See the squawks
          </Link>
        </div>
      ) : (
        inWork.length > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-500/40 dark:bg-amber-900/20">
            <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
              In maintenance — {inWork.length}{" "}
              {inWork.length === 1 ? "squawk is" : "squawks are"} being worked
            </h2>
            <ul className="mt-3 space-y-1.5 text-sm text-amber-900 dark:text-amber-200">
              {inWork.map((s) => (
                <li key={s.id} className="flex gap-2">
                  <span aria-hidden="true" className="text-lg leading-5 opacity-70">
                    ·
                  </span>
                  <span>{s.title}</span>
                </li>
              ))}
            </ul>
            {/* Deliberately not "do not fly": in-work means the shop has it,
                not that it's unairworthy. The Safety Officer grounds it
                explicitly if that's what they mean. */}
            <p className="mt-3 text-xs text-amber-900/80 dark:text-amber-200/80">
              Not a grounding on its own — check with the Safety Officer before
              you book it.
            </p>
          </div>
        )
      )}


      {children}
    </div>
  );
}
