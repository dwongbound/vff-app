"use client";
// A bordered row with a switch and ONE label — an on/off assertion ("flown
// with an instructor", "send me calendar invites"). Big enough to answer with
// a thumb, which is why the whole row is the button.
//
// Deliberately not `Toggle`, which names BOTH sides and is for a choice
// between two things. Here there is no second thing to name: the opposite is
// the ordinary case and doesn't want a word. Moved here from the post-flight
// page when /profile's calendar-invites switch needed the same thing.
export default function SwitchRow({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
      className="flex w-full items-center gap-3 rounded-lg border border-gray-200 px-3 py-2.5 text-left text-sm transition-colors hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700/50"
    >
      <span
        className={`flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors ${
          checked ? "bg-green-500" : "bg-gray-300 dark:bg-gray-600"
        }`}
      >
        <span
          className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-5" : ""
          }`}
        />
      </span>
      <span className={checked ? "" : "text-gray-500 dark:text-gray-400"}>{label}</span>
    </button>
  );
}
