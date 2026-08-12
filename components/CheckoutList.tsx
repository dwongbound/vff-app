"use client";
// One checkout, rendered as a run of collapsible sections with a sticky
// progress bar above them.
//
// Shared by the preflight and runway pages, which are the same job on two
// different cards — the only thing that differs is which `Checkout` gets
// passed in. The turn-off checkout deliberately does NOT use this: it's
// answered standing at the tail with the airplane still ticking, working down
// a list you've just done, so it renders flat (see TurnoffCheckout).
//
// Design notes: this is used on a ramp, one-handed, often in sun. So big tap
// targets (the whole row toggles), one section open at a time, a running
// progress bar, and finishing a section offers the next one.
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import Card from "@/components/common/Card";
import InfoTip from "@/components/common/InfoTip";
import CheckoutFields from "@/components/CheckoutFields";
import {
  countChecked,
  countSectionChecked,
  totalItems,
  type Answers,
  type Checkout,
  type Values,
} from "@/lib/checkouts";

/**
 * An item whose answer is a FACT the app already holds, not a tap.
 *
 * "Preflight — complete" is the case this exists for: whether the airplane has
 * been walked and signed for is recorded, so asking the pilot to assert it
 * again is asking them to type a number the app can read. Worse, it's askable
 * — a member in a hurry can tick it with no preflight behind it, and the row
 * then says something untrue in a record the club keeps.
 *
 * So the row is never tappable. Satisfied, it ticks itself; unsatisfied it
 * goes red, states what's missing, and points at the page that fixes it. The
 * OWNER of the value (the page) is responsible for putting the answer into
 * `answers` when satisfied — this component only renders it.
 */
export interface DerivedItem {
  satisfied: boolean;
  /** What's missing, and where to go — shown on the row when unsatisfied. */
  message: ReactNode;
  /** Where to fix it. Rendered as a link on the row. */
  href?: string;
  linkLabel?: string;
}

/**
 * A live note under an ITEM — what the app already knows about the thing the
 * pilot is being asked to confirm.
 *
 * Different from `derived` on purpose: a derived item is one the app ANSWERS
 * (the row ticks itself and can't be tapped), while this is one the app can
 * only inform. "Open squawks — reviewed, airplane airworthy" is exactly that
 * shape: the club's squawk list is a fact the app holds, but whether you have
 * READ it is not, so the row stays yours to tick and the list comes to you.
 *
 * The tone is the traffic light, and it never travels alone — the note is
 * words, so it carries the same meaning with the colour switched off.
 */
export interface ItemNote {
  tone: "green" | "amber" | "red";
  children: ReactNode;
  /**
   * Where to read the whole story. The note is a SUMMARY — a member standing at
   * the wing wants "2 open squawks, one being worked", not four paragraphs of
   * defect history — so anything longer than that lives on its own page and the
   * row links to it.
   */
  href?: string;
  linkLabel?: string;
}

const NOTE_INK: Record<ItemNote["tone"], string> = {
  green: "text-green-700 dark:text-green-400",
  amber: "text-amber-700 dark:text-amber-400",
  red: "font-medium text-red-700 dark:text-red-400",
};

export default function CheckoutList({
  checkout,
  answers,
  onChange,
  values,
  onValuesChange,
  hints,
  derived,
  itemNotes,
  status,
  resumed = false,
  /** Bump this to collapse back to the first section (after a sign-off). */
  resetKey = 0,
}: {
  checkout: Checkout;
  answers: Answers;
  onChange: (next: Answers) => void;
  values: Values;
  onValuesChange: (next: Values) => void;
  /** Muted notes under a field, by field id — see CheckoutFields. */
  hints?: Record<string, ReactNode>;
  /** Items the app answers for itself, by item id. */
  derived?: Record<string, DerivedItem>;
  /** Live notes under an item, by item id — see ItemNote. */
  itemNotes?: Record<string, ItemNote>;
  /**
   * A last line INSIDE the sticky bar, under the step counts.
   *
   * The pages put CheckoutDraftBar here — how far down the card you are and
   * whether that work is safe are the two things a member wants without
   * hunting, so they travel together rather than one of them scrolling off the
   * top. Kept as an opaque slot: this component knows about a checkout and
   * nothing about drafts, autosave or what Reset would delete.
   */
  status?: ReactNode;
  /**
   * A half-walked card was picked up — `answers` is somebody's work in
   * progress rather than a fresh start. Flips false→true once, when the resume
   * lands, and that edge is what re-aims the accordion (see below).
   */
  resumed?: boolean;
  resetKey?: number;
}) {
  const [openSection, setOpenSection] = useState<string>(
    checkout.sections[0].id
  );
  // Remember which reset we last honoured, so re-opening the first section
  // happens once per sign-off rather than fighting the member for the rest of
  // the page's life. (Cheaper and less surprising than an effect that runs
  // after paint and visibly snaps the accordion shut.)
  const [seenReset, setSeenReset] = useState(resetKey);
  if (resetKey !== seenReset) {
    setSeenReset(resetKey);
    setOpenSection(checkout.sections[0].id);
  }

  // Opening a section scrolls it up to the top of the column.
  //
  // Without this, tapping the header of a section that's sitting near the
  // bottom of the screen expands it entirely BELOW the fold: the accordion
  // dutifully opens somewhere you can't see, and the page looks like it did
  // nothing. Worse on a phone, where a long section pushes its own header off
  // the top as it grows.
  //
  // Only when the open section actually CHANGES — a page that scrolls itself
  // the moment it appears is disorienting, and section one is already at the
  // top anyway. The guard remembers the section rather than "have I run once":
  // React's Strict Mode runs every effect twice on mount in development, refs
  // survive that simulated remount, so a run-once flag was already spent by
  // the second pass and the page opened scrolled a thousand pixels down, past
  // its own heading and the member's limits card.
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const scrolledFor = useRef(openSection);
  useEffect(() => {
    if (scrolledFor.current === openSection) return;
    scrolledFor.current = openSection;
    scrollToSection(openSection);
  }, [openSection]);

  /** Put a section's header at the top of the column. "" collapses everything
   *  and has nothing to scroll to. */
  function scrollToSection(id: string) {
    const el = id ? sectionRefs.current[id] : null;
    if (!el) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" });
  }

  /**
   * Jump to a section from the gauge.
   *
   * Opening a different one is enough — the effect above scrolls it. Tapping
   * the segment you're ALREADY on has to scroll by hand, because nothing
   * changed and that effect won't run: on a long section the member is usually
   * somewhere in the middle of it, and "take me back to the top of this one" is
   * exactly what they meant by tapping their own segment.
   */
  function jumpToSection(id: string) {
    if (id === openSection) scrollToSection(id);
    else setOpenSection(id);
  }

  const total = totalItems(checkout.kind);
  const checked = countChecked(checkout.kind, answers);
  const complete = checked === total;
  const progress = total === 0 ? 100 : Math.round((checked / total) * 100);

  // Per-section tallies, computed once: the sticky bar, the segmented gauge and
  // every section header all want them, and walking the card three times to get
  // the same numbers is how they end up disagreeing.
  const sectionState = checkout.sections.map((section) => {
    const done = countSectionChecked(section, answers);
    return { section, done, complete: done === section.items.length };
  });

  // Coming back to a half-walked card, open the section that still has work in
  // it rather than section 1 — which on a resumed card is usually the one
  // that's finished, so the member's first act is scrolling past their own
  // ticks to find where they got to.
  //
  // Only on the resume EDGE. After that the accordion belongs to the member,
  // and a list that re-aims itself every time a section fills up would move
  // under the thumb of somebody working down it out of order.
  //
  // Optional sections and optional items don't count as work left: a card signs
  // off without them, so counting them would park every July resume on the
  // cold-start pre-lube.
  const [seenResume, setSeenResume] = useState(resumed);
  if (resumed !== seenResume) {
    setSeenResume(resumed);
    const next = resumed
      ? sectionState.find(
          ({ section }) =>
            !section.optional &&
            section.items.some((item) => !item.optional && !answers[item.id])
        )
      : undefined;
    // A card with nothing left is left where it is: it's about to be signed
    // off, and the sign-off is below the list anyway.
    if (next) setOpenSection(next.section.id);
  }

  // Which step the member is ON.
  //
  // The open section when there is one — that's literally what they're looking
  // at. When everything is collapsed, the first UNFINISHED section is the
  // honest answer to "where am I", and it's also where the accordion would send
  // them next. A finished card falls back to the last section rather than
  // reporting step 1 of 8 under a full green bar.
  const current =
    sectionState.find((s) => s.section.id === openSection) ??
    sectionState.find((s) => !s.complete) ??
    sectionState[sectionState.length - 1];
  const currentIndex = sectionState.indexOf(current);

  function toggle(id: string) {
    // A derived item's answer isn't the pilot's to give — see DerivedItem.
    if (derived?.[id]) return;
    const next = { ...answers };
    if (next[id]) delete next[id];
    else next[id] = true;
    onChange(next);
  }

  // Recording a reading ticks its item — see CheckoutFields for why.
  function setValue(itemId: string, fieldId: string, value: number | string | null) {
    const nextValues = { ...values };
    if (value === null || value === "") delete nextValues[fieldId];
    else nextValues[fieldId] = value;
    onValuesChange(nextValues);
    if (value !== null && value !== "" && !answers[itemId]) {
      onChange({ ...answers, [itemId]: true });
    }
  }

  function toggleSection(sectionId: string, on: boolean) {
    const section = checkout.sections.find((s) => s.id === sectionId);
    if (!section) return;
    const next = { ...answers };
    for (const item of section.items) {
      // "Check all" must not be a back door around a derived item — that's
      // the exact tick this whole mechanism exists to refuse.
      if (derived?.[item.id]) continue;
      if (on) next[item.id] = true;
      else delete next[item.id];
    }
    onChange(next);
  }

  return (
    <div className="space-y-4">
      {/* Sticky progress bar. It answers WHERE AM I, which on a card walked
          one-handed round an airplane is a different question from how much is
          left: scrolled into the middle of a 15-item section with the header
          off the top of the screen, "26%" doesn't tell you which section you're
          in or how close you are to the end of it.
          So: the section you're on, your position inside it, and — as the gauge
          — the whole card broken into its sections, which puts the overall
          figure and the current step in one picture. */}
      {/* `top-0`, not the header height: this sticks to the content column,
          which already starts below the header. */}
      {/* Deliberately NOT `role="status"`. It looks like one — it's a strip
          that updates by itself — but a live region here would re-announce the
          whole "step 3 of 8, Consumables, 4 of 6, 26%" on EVERY tap, over the
          top of the checkbox's own state change. The numbers are plain text in
          reading order, which is what a screen reader wants; the live region on
          this page is the draft bar — which now sits INSIDE this strip as
          `status`, and is a live region because it changes when nobody touched
          anything. Nesting one inside a non-live container is fine: `aria-live`
          isn't inherited, so only the save line announces. */}
      <div className="sticky top-0 z-10 -mx-4 bg-gray-50/95 px-4 py-2 backdrop-blur dark:bg-gray-900/95">
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <span className="min-w-0 truncate font-semibold">
            {current.section.title}
          </span>
          <span className="shrink-0 tabular text-gray-500 dark:text-gray-400">
            {current.done}/{current.section.items.length}
          </span>
        </div>

        {/* One segment per section, each as wide as the section is long, so the
            gauge is a true picture of the card rather than eight equal boxes
            that make the 3-item briefing look like the 15-item cockpit. The
            section you're on is outlined — that's the "you are here".
            Each segment is also the way BACK to its section: it's the one
            control that's on screen the whole way down the card, so the thing
            it most obviously ought to do when tapped is take you there.
            The bar itself is therefore no longer `aria-hidden` — you can't
            hide a row of buttons from a keyboard or a screen reader — and each
            one carries the name and count that its shape is drawing. */}
        <nav className="mt-1.5 flex gap-1" aria-label={`${checkout.title} sections`}>
          {sectionState.map(({ section, done, complete: sectionComplete }) => {
            const fill =
              section.items.length === 0
                ? 100
                : Math.round((done / section.items.length) * 100);
            const here = section.id === current.section.id;
            return (
              <button
                key={section.id}
                onClick={() => jumpToSection(section.id)}
                style={{ flexGrow: section.items.length }}
                // The bar is 8px tall, which is a fine thing to LOOK at and a
                // poor thing to hit with a thumb on a ramp. The padding gives
                // it a 24px target and the negative margin hands the layout
                // back its 8px, so nothing below moves.
                className="-my-2 basis-0 py-2"
                // "Go to" first, and not just for politeness: a section title
                // is often also a FIELD label on the card ("Left wing" is a
                // section AND the fuel box in it), and a segment labelled with
                // the bare title makes `getByLabel(/^Left wing/)` — which is
                // how anything finds that box — ambiguous. The prefix says
                // what the control does and keeps the two apart.
                aria-label={`Go to ${section.title} — ${done} of ${section.items.length} checked`}
                aria-current={here ? "step" : undefined}
                title={section.title}
              >
                <span
                  className={`block h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700 ${
                    here
                      ? "ring-2 ring-indigo-500 ring-offset-1 ring-offset-gray-50 dark:ring-offset-gray-900"
                      : ""
                  }`}
                >
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

        <div className="mt-1 flex items-baseline justify-between gap-3 text-xs">
          <span className="text-gray-500 dark:text-gray-400">
            Step {currentIndex + 1} of {sectionState.length} · {checked} of {total}{" "}
            checked
          </span>
          <span
            className={
              complete
                ? "shrink-0 font-semibold text-green-600 dark:text-green-400"
                : "shrink-0 text-gray-500 dark:text-gray-400"
            }
          >
            {complete ? "Ready to sign off" : `${progress}%`}
          </span>
        </div>

        {/* The save state, hairlined off from the counts above it — same strip,
            different question ("where am I" vs "is this kept"). The rule for
            what may go here is the height: this bar follows the member down the
            whole card, so anything added to it is paid for on every screen. */}
        {status && (
          <div className="mt-1.5 border-t border-gray-200 pt-1.5 dark:border-gray-700">
            {status}
          </div>
        )}
      </div>

      <div className="space-y-3">
        {/* Same tallies the sticky bar above is drawn from, so a section header
            and the gauge can never report different numbers for one section. */}
        {sectionState.map(({ section, done, complete: sectionComplete }, sectionIndex) => {
          const expanded = openSection === section.id;

          return (
            <Card
              key={section.id}
              ref={(el) => {
                sectionRefs.current[section.id] = el;
              }}
              // Scroll target for the effect above. The margin is what keeps
              // the sticky progress bar from parking on top of the header it
              // just scrolled to, so it has to clear the bar's HEIGHT — which
              // grew when the save state moved inside (roughly 100px now, and
              // ~115 while the two-line resume line is up).
              className="scroll-mt-28 p-0"
            >
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
                  <span className="block font-medium">
                    {section.title}
                    {/* An optional section (the cold-start pre-lube) doesn't
                        hold up the sign-off, so say so on the header rather
                        than let a warm-start pilot hunt for what's missing. */}
                    {section.optional && (
                      <span className="ml-2 text-xs font-normal text-gray-500 dark:text-gray-400">
                        if it applies
                      </span>
                    )}
                  </span>
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
                      const fact = derived?.[item.id];
                      const note = itemNotes?.[item.id];
                      const on = Boolean(answers[item.id]);
                      // A derived item that isn't satisfied is the one row on
                      // the card that reads as a problem rather than as work
                      // left to do, so it takes red rather than the neutral
                      // unticked grey.
                      // A red NOTE tints the row the same way, and means the
                      // same thing: this row is a problem, not work left to do.
                      const blocked =
                        Boolean(fact && !fact.satisfied) || note?.tone === "red";
                      // The row's tick target and its (i) are SIBLINGS, not
                      // nested: a button inside a button is invalid HTML and
                      // React refuses to hydrate it. The tick target still
                      // takes all the leftover width, so it stays a
                      // thumb-sized target on a ramp.
                      return (
                        <li
                          key={item.id}
                          className={`flex flex-wrap items-start gap-2 pr-3 transition-colors ${
                            blocked
                              ? "bg-red-50 dark:bg-red-900/20"
                              : "hover:bg-gray-50 dark:hover:bg-gray-700/50"
                          }`}
                        >
                          <button
                            onClick={() => toggle(item.id)}
                            aria-pressed={on}
                            // Disabled rather than merely inert: a row the app
                            // answers for you should not look tappable, and a
                            // keyboard shouldn't land on it either.
                            disabled={Boolean(fact)}
                            className={`flex min-w-0 flex-1 items-start gap-3 py-3 pl-4 text-left ${
                              fact ? "cursor-default" : ""
                            }`}
                          >
                            <span
                              className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 transition-colors ${
                                on
                                  ? "border-green-500 bg-green-500 text-white"
                                  : blocked
                                    ? "border-red-400 dark:border-red-500"
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
                                {/* Which items came off the airplane's card
                                    and which are the club's own additions —
                                    worth knowing when you're comparing the
                                    app against the laminated card in your
                                    hand. */}
                                {item.club && (
                                  <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 align-middle text-[10px] font-medium uppercase tracking-wide text-gray-500 dark:bg-gray-700 dark:text-gray-400">
                                    club
                                  </span>
                                )}
                                {item.optional && (
                                  <span className="ml-2 text-xs font-normal text-gray-500 dark:text-gray-400">
                                    if it applies
                                  </span>
                                )}
                              </span>
                              {item.detail && (
                                <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
                                  {item.detail}
                                </span>
                              )}
                              {/* Why the app answered it the way it did —
                                  either way, since "this ticked itself" is
                                  worth explaining too. */}
                              {fact && (
                                <span
                                  className={`mt-1 block text-xs ${
                                    fact.satisfied
                                      ? "text-green-700 dark:text-green-400"
                                      : "font-medium text-red-700 dark:text-red-400"
                                  }`}
                                >
                                  {fact.message}
                                </span>
                              )}
                              {/* What the app knows about this item right now.
                                  Inside the tick target, so the thing you're
                                  confirming and the evidence for it are one
                                  block rather than two. */}
                              {note && (
                                <span
                                  className={`mt-1 block text-xs ${NOTE_INK[note.tone]}`}
                                >
                                  {note.children}
                                </span>
                              )}
                            </span>
                          </button>
                          {/* Outside the disabled button, or it isn't
                              clickable — and this link is the entire point of
                              the red row. */}
                          {fact && !fact.satisfied && fact.href && (
                            <Link
                              href={fact.href}
                              className="mt-3 shrink-0 text-xs font-semibold text-red-700 underline dark:text-red-400"
                            >
                              {fact.linkLabel ?? "Fix this"} →
                            </Link>
                          )}
                          {/* Same reason, and the same place: a note's link is
                              how the summary stays a summary. */}
                          {note?.href && (
                            <Link
                              href={note.href}
                              className={`mt-3 shrink-0 text-xs font-semibold underline ${NOTE_INK[note.tone]}`}
                            >
                              {note.linkLabel ?? "Read them"} →
                            </Link>
                          )}
                          <span className="mt-4 shrink-0">
                            <InfoTip label={item.label}>{item.why}</InfoTip>
                          </span>
                          {/* Fields break to their own full-width line under
                              the row (the <li> is a flex-wrap container), so
                              the tick target keeps its full width and the
                              inputs never squeeze it on a phone. */}
                          {item.fields && (
                            <div className="w-full pb-3 pl-[3.25rem] pr-3">
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

                  <div className="flex items-center justify-between gap-2 border-t border-gray-100 px-4 py-2 dark:border-gray-700">
                    <button
                      onClick={() => toggleSection(section.id, !sectionComplete)}
                      className="text-xs font-medium text-gray-500 hover:underline dark:text-gray-400"
                    >
                      {sectionComplete ? "Clear" : "Check all"}
                    </button>
                    {sectionIndex < checkout.sections.length - 1 && (
                      <button
                        onClick={() =>
                          setOpenSection(checkout.sections[sectionIndex + 1].id)
                        }
                        className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                      >
                        Next: {checkout.sections[sectionIndex + 1].title} →
                      </button>
                    )}
                  </div>
                </div>
              )}
            </Card>
          );
        })}
      </div>
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
