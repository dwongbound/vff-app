// Resolving the CFI named on a booking or a flight — the database half of the
// instructor rules.
//
// Lives in lib/ rather than in the routes that use it for two reasons: three
// routes need the identical check (reservations POST and PATCH, flights POST),
// and a route.ts may only export Next's own handlers, so a shared helper has
// nowhere else to go.
//
// The pure rules it leans on are in lib/positions.ts (`isInstructor`) and
// lib/flightSignature.ts (what a signature means).
import { isInstructor, type Position } from "./positions";
import { prisma } from "./prisma";

/** Either a resolved id (possibly null, meaning "nobody") or a reason it failed. */
export type InstructorResolution =
  | { instructorId: string | null }
  | { error: string };

export function resolutionFailed(
  result: InstructorResolution
): result is { error: string } {
  return "error" in result;
}

/**
 * The CFI to record, or null.
 *
 * The named person must actually hold the CFI office — otherwise the picker is
 * advisory and any member id in a hand-rolled request body would do. An unknown
 * or non-instructor id is an ERROR rather than a silent null: somebody chose a
 * name, and quietly dropping it would leave a lesson that looks booked with an
 * instructor to the student and unbooked to the instructor.
 *
 * Note it does NOT require the instructor to be a club member: teaching here
 * without flying here is exactly what the instructor-only account is for.
 */
export async function resolveInstructor(
  raw: unknown
): Promise<InstructorResolution> {
  if (!raw) return { instructorId: null };

  const candidate = await prisma.user.findUnique({
    where: { id: String(raw) },
    select: { id: true, positions: true },
  });
  if (!candidate) {
    return { error: "That instructor is no longer in the club." };
  }
  if (!isInstructor({ positions: candidate.positions as Position[] })) {
    return { error: "That member isn't a flight instructor here." };
  }
  return { instructorId: candidate.id };
}

/**
 * The same, for a booking — where the purpose decides whether an instructor is
 * meaningful at all.
 *
 * Anything but TRAINING resolves to null without looking the person up, so
 * switching a lesson to a local flight drops the instructor rather than leaving
 * a stale name on a booking they have nothing to do with. That's a real edit
 * path, not a hypothetical: the member who books a lesson and then goes flying
 * on their own instead is the common case.
 */
export async function resolveBookingInstructor(
  purpose: string,
  raw: unknown
): Promise<InstructorResolution> {
  if (purpose !== "TRAINING") return { instructorId: null };
  return resolveInstructor(raw);
}
