"use client";
// Plane Status › Maintenance — the club's maintenance sheet, and where it gets
// written.
//
// The Overview tab shows the same items as a row of dials: a glance, for
// somebody deciding whether to fly today. This is the other half of the job —
// recording that the shop signed something off, correcting an interval, adding
// an item — and it's a tab of its own for the same reason Squawks is: the
// people who READ this and the people who MAINTAIN it come to it with
// different questions, and one screen that did both would serve neither.
//
// Editing needs `maintenance:manage` (the Maintenance Officer, or an admin).
// Reading is open to every member: what the airplane is due for is not
// privileged information.
import { useAircraft } from "@/components/AircraftProvider";
import { usePageLoading } from "@/components/LoadingProvider";
import { useMe } from "@/components/MeProvider";
import Card from "@/components/common/Card";
import MaintenancePanel from "@/components/status/MaintenancePanel";

export default function MaintenancePage() {
  const { selected, loading: fleetLoading } = useAircraft();
  const { me } = useMe();
  usePageLoading(fleetLoading || me === null);

  if (!selected) {
    return (
      <Card>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          No airplane set up yet — an admin can add one from Club settings.
        </p>
      </Card>
    );
  }

  const canManage = Boolean(me?.capabilities.includes("maintenance:manage"));

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-500 dark:text-gray-400">
        {canManage
          ? "Mark an item done when the shop hands the airplane back — that restarts both of its clocks."
          : "Read-only — the Maintenance Officer records what's been signed off."}
      </p>
      <MaintenancePanel aircraft={selected} canManage={canManage} />
    </div>
  );
}
