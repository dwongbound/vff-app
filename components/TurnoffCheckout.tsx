"use client";
// The turn-off checkout — the back of N8318B's card: after landing, shutdown,
// outside parking — rendered on the post-flight form.
//
// This is now a thin wrapper over CheckoutList, the component the preflight and
// runway pages use, and that is the whole point of it: a member meets this card
// minutes after walking the other two, and a checklist that changes shape
// between screens is one that has to be re-learned every time. Same collapsible
// sections, same headers, same segmented gauge, same tick rows.
//
// It used to render flat, on the reasoning that you're working down a list
// you've just done rather than navigating one. That reasoning was about this
// card in isolation; consistency across the three beat it.
//
// The one difference it keeps is `sticky={false}` — see CheckoutList's prop:
// this card is a section of a longer form rather than the whole page, so a
// pinned bar would follow the member down past the meters and the servicing
// fields, still counting turn-off items.
//
// It's optional to answer. Ticking the tie-downs, the chocks and the cabin is
// what sets the flight log's put-away flags (lib/checkouts.ts `derivePutAway`),
// so leaving it blank reads as "not confirmed" rather than "done".
import CheckoutList from "@/components/CheckoutList";
import { TURNOFF_CHECKOUT, type Answers, type Values } from "@/lib/checkouts";

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
  return (
    <CheckoutList
      checkout={TURNOFF_CHECKOUT}
      answers={answers}
      onChange={onChange}
      values={values}
      onValuesChange={onValuesChange}
      sticky={false}
    />
  );
}
