"use client";
// The turn-off checkout — the back of N8318B's card: after landing, shutdown,
// outside parking — rendered as tick rows on the post-flight form.
//
// Deliberately flatter than CheckoutList, which the other two checkouts share:
// you're filling this in standing at the tail with the airplane still ticking,
// working down a list you've just done, not navigating between sections. So no
// collapsing, no "next section" affordance — one column you can thumb straight
// down.
//
// It's optional to answer. Ticking the tie-downs, the chocks and the cabin is
// what sets the flight log's put-away flags (lib/checkouts.ts `derivePutAway`),
// so leaving it blank reads as "not confirmed" rather than "done".
import { useRef } from "react";
import InfoTip from "@/components/common/InfoTip";
import CheckoutFields from "@/components/CheckoutFields";
import {
  TURNOFF_CHECKOUT,
  countChecked,
  countSectionChecked,
  totalItems,
  type Answers,
  type Values,
} from "@/lib/checkouts";

export default function TurnoffCheckout({
  answers,
  onChange,
  values,
  onValuesChange,
}: {
  answers: Answers;
  onChange: (next: Answers) => void;
  values: Values;
  onValuesChange: (next: Values) => void;
}) {
  const total = totalItems("TURNOFF");
  const done = countChecked("TURNOFF", answers);
  const complete = done === total;
  const progress = total === 0 ? 100 : Math.round((done / total) * 100);

  // Per-section tallies, computed once — the gauge and every section header
  // want the same numbers, and counting twice is how they come to disagree.
  const sectionState = TURNOFF_CHECKOUT.sections.map((section) => {
    const sectionDone = countSectionChecked(section, answers);
    return {
      section,
      done: sectionDone,
      complete: sectionDone === section.items.length,
    };
  });

  // The gauge's segments scroll to their section. This card is FLAT — there's
  // nothing to expand — so a jump is the only navigation there is, and on a
  // 21-item list held at arm's length it's the one worth having.
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  function jumpToSection(id: string) {
    const el = sectionRefs.current[id];
    if (!el) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" });
  }

  function toggle(id: string) {
    const next = { ...answers };
    if (next[id]) delete next[id];
    else next[id] = true;
    onChange(next);
  }

  // Recording a reading ticks its item, same as the other two checkouts.
  function setValue(itemId: string, fieldId: string, value: number | string | null) {
    const nextValues = { ...values };
    if (value === null || value === "") delete nextValues[fieldId];
    else nextValues[fieldId] = value;
    onValuesChange(nextValues);
    if (value !== null && value !== "" && !answers[itemId]) {
      onChange({ ...answers, [itemId]: true });
    }
  }

  function toggleSection(ids: string[], on: boolean) {
    const next = { ...answers };
    for (const id of ids) {
      if (on) next[id] = true;
      else delete next[id];
    }
    onChange(next);
  }

  return (
    <div className="space-y-4">
      {/* The same progress gauge the other two cards get, for the same reason:
          this is a 21-item list and "how much is left" shouldn't have to be
          counted by eye. Two differences from CheckoutList's, both because this
          card is flat and lives inside a longer form — it doesn't stick to the
          top of the column (it would compete with the page's own scroll), and
          there's no "step N of M", because with nothing collapsed there is no
          step you're on. What's left is the honest half: how far down you are,
          and which sections are done.

          (The line that used to sit here — "Optional, but it's what records the
          airplane as put away" — is gone: the ticks are the record either way,
          and leading with "optional" invited skipping the one card that says the
          airplane was put away properly.) */}
      <div>
        <nav className="flex gap-1" aria-label="Turn-off checkout sections">
          {sectionState.map(({ section, done: sectionDone, complete: sectionComplete }) => {
            const fill =
              section.items.length === 0
                ? 100
                : Math.round((sectionDone / section.items.length) * 100);
            return (
              <button
                key={section.id}
                type="button"
                onClick={() => jumpToSection(section.id)}
                style={{ flexGrow: section.items.length }}
                // 8px is a fine thing to look at and a poor thing to hit with a
                // thumb; the padding gives it a 24px target and the negative
                // margin hands the layout its 8px back.
                className="-my-2 basis-0 py-2"
                // "Go to" first — see CheckoutList: a bare section title
                // collides with the field labels on the same card.
                aria-label={`Go to ${section.title} — ${sectionDone} of ${section.items.length} checked`}
                title={section.title}
              >
                <span className="block h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                  <span
                    className={`block h-full rounded-full transition-all duration-300 ${
                      sectionComplete ? "bg-green-500" : "bg-indigo-600"
                    }`}
                    style={{ width: `${fill}%` }}
                  />
                </span>
              </button>
            );
          })}
        </nav>

        <div className="mt-1.5 flex items-baseline justify-between gap-3 text-xs">
          <span className="text-gray-500 dark:text-gray-400">
            {done} of {total} checked
          </span>
          <span
            className={
              complete
                ? "shrink-0 font-semibold text-green-600 dark:text-green-400"
                : "shrink-0 text-gray-500 dark:text-gray-400"
            }
          >
            {complete ? "All confirmed" : `${progress}%`}
          </span>
        </div>
      </div>

      {sectionState.map(({ section, done: sectionDone, complete: sectionComplete }) => {
        const ids = section.items.map((i) => i.id);

        return (
          <div
            key={section.id}
            ref={(el) => {
              sectionRefs.current[section.id] = el;
            }}
            // Clears the app's top bar when the gauge scrolls to it.
            className="scroll-mt-20"
          >
            <div className="flex items-baseline justify-between gap-2 pb-1">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                {section.title}
                {section.subtitle && (
                  <span className="ml-2 font-normal normal-case tracking-normal">
                    {section.subtitle}
                  </span>
                )}
              </h3>
              <span className="flex shrink-0 items-baseline gap-3">
                <span className="text-xs tabular text-gray-500 dark:text-gray-400">
                  {sectionDone}/{section.items.length}
                </span>
                <button
                  type="button"
                  onClick={() => toggleSection(ids, !sectionComplete)}
                  className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                >
                  {sectionComplete ? "Clear" : "Check all"}
                </button>
              </span>
            </div>

            <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 dark:divide-gray-700 dark:border-gray-700">
              {section.items.map((item) => {
                const on = Boolean(answers[item.id]);
                // Tick target and (i) are siblings, not nested — a button
                // inside a button won't hydrate. Same rule as CheckoutList.
                return (
                  <li key={item.id} className="flex flex-wrap items-start gap-2 pr-2">
                    <button
                      type="button"
                      onClick={() => toggle(item.id)}
                      aria-pressed={on}
                      className="flex min-w-0 flex-1 items-start gap-3 py-2.5 pl-3 text-left"
                    >
                      <span
                        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition-colors ${
                          on
                            ? "border-green-500 bg-green-500 text-white"
                            : "border-gray-300 dark:border-gray-600"
                        }`}
                      >
                        {on && (
                          <svg
                            viewBox="0 0 20 20"
                            fill="currentColor"
                            className="h-3.5 w-3.5"
                            aria-hidden="true"
                          >
                            <path
                              fillRule="evenodd"
                              d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 1 1 1.4-1.4l3.8 3.8 6.8-6.8a1 1 0 0 1 1.4 0Z"
                              clipRule="evenodd"
                            />
                          </svg>
                        )}
                      </span>
                      <span
                        className={`min-w-0 text-sm ${
                          on
                            ? "text-gray-500 line-through dark:text-gray-500"
                            : "font-medium"
                        }`}
                      >
                        {item.label}
                      </span>
                    </button>
                    <span className="mt-3 shrink-0">
                      <InfoTip label={item.label}>{item.why}</InfoTip>
                    </span>
                    {item.fields && (
                      <div className="w-full pb-2 pl-[2.75rem] pr-2">
                        <CheckoutFields
                          fields={item.fields}
                          values={values}
                          onChange={(fieldId, value) =>
                            setValue(item.id, fieldId, value)
                          }
                        />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
