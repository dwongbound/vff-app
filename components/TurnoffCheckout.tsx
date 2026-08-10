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
  const done = countChecked("TURNOFF", answers);

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
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Optional, but it's what records the airplane as put away.
        </p>
        <span className="shrink-0 text-xs tabular text-gray-500 dark:text-gray-400">
          {done}/{totalItems("TURNOFF")}
        </span>
      </div>

      {TURNOFF_CHECKOUT.sections.map((section) => {
        const ids = section.items.map((i) => i.id);
        const sectionDone = countSectionChecked(section, answers);
        const sectionComplete = sectionDone === section.items.length;

        return (
          <div key={section.id}>
            <div className="flex items-baseline justify-between gap-2 pb-1">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                {section.title}
                {section.subtitle && (
                  <span className="ml-2 font-normal normal-case tracking-normal">
                    {section.subtitle}
                  </span>
                )}
              </h3>
              <button
                type="button"
                onClick={() => toggleSection(ids, !sectionComplete)}
                className="shrink-0 text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
              >
                {sectionComplete ? "Clear" : "Check all"}
              </button>
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
