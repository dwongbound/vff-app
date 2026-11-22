// Club roles.
//
// "Admin" is a single club-wide flag on User (isAdmin), not a per-aircraft
// permission: a flying club this size has one question — can this person manage
// the club or not — and one flag answers it. Admins manage the fleet, sign off
// squawks, edit anyone's booking, and hand the flag to somebody else.
//
// The rules below are the pure half of that; the route (app/api/members/[id])
// does the database work and re-checks the caller is an admin.

/**
 * Columns the roster routes select. Lives here rather than in a route file
 * because Next only allows its own known exports (GET, POST, dynamic, …) out of
 * a route module — anything else fails the generated route type check.
 *
 * Pilot paperwork is deliberately absent: see ApiMember in lib/types.ts.
 */
export const MEMBER_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  certificate: true,
  isAdmin: true,
  // Offices are public on the roster on purpose: the whole point of naming a
  // Safety Officer is that members can tell who to call. It's also what marks
  // the club's instructors, which the booking form's CFI picker reads.
  positions: true,
  // Public for the same reason: "teaches here but doesn't fly here" explains
  // why a name on the roster never appears on the schedule.
  clubMember: true,
  createdAt: true,
} as const;

/**
 * Why an admin may NOT remove this person from the club, or null when they may.
 *
 * Removing is a soft delete (User.removedAt): flights and statement lines stay,
 * the person stops signing in and stops being billed. Two refusals:
 * - yourself, since the button would sign you out of your own club mid-click,
 *   and "who removed the last admin" has no good answer;
 * - an admin, who must be demoted first. That is the same last-admin rule as
 *   `adminChangeError`, reached by a route that can't skip it, and it makes
 *   taking away the keys to the club two deliberate steps instead of one.
 */
export function removalError(target: {
  id: string;
  isAdmin: boolean;
  removedAt: Date | null;
}, actorId: string): string | null {
  if (target.removedAt) return "That member has already been removed.";
  if (target.id === actorId) return "You can't remove yourself — ask another admin.";
  if (target.isAdmin) return "Remove admin from this member first.";
  return null;
}

export interface AdminChange {
  /** The member whose flag is being changed, as they are stored today. */
  target: { id: string; isAdmin: boolean };
  /** What the flag should become. */
  nextIsAdmin: boolean;
  /** How many admins the club has right now, counting the target. */
  totalAdmins: number;
}

/**
 * Why a role change must be refused, or null when it's allowed.
 *
 * There is exactly one hard rule: the club can never be left without an admin.
 * Nobody else could sign off a grounding squawk, add an airplane, or promote a
 * replacement — the club would be locked out of its own app with no way back
 * in short of editing the database by hand.
 *
 * Demoting yourself is deliberately allowed as long as somebody else still
 * holds the flag, which is how an outgoing club officer hands over.
 */
export function adminChangeError(change: AdminChange): string | null {
  const { target, nextIsAdmin, totalAdmins } = change;

  // Setting the flag to what it already is changes nothing, so there is
  // nothing to refuse — including for the last admin.
  if (target.isAdmin === nextIsAdmin) return null;

  if (target.isAdmin && !nextIsAdmin && totalAdmins <= 1) {
    return "The club needs at least one admin — promote someone else first.";
  }

  return null;
}
