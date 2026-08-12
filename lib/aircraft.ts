// Aircraft identity rules, shared by the admin API and the org-settings form so
// both reject the same input with the same wording.

/**
 * What `serializeAircraft` needs off the row, as a Prisma `include`.
 *
 * Here rather than in each route because an airplane now carries two lists that
 * the CLIENT treats as facts about it — the open squawks and the maintenance
 * sheet — and a route that forgot one would serialise an airplane with nothing
 * due and no squawks, which reads as "all clear" rather than as a bug. (It
 * can't live in a route.ts either: only Next's own exports may leave one.)
 */
export const AIRCRAFT_INCLUDE = {
  squawks: {
    where: { status: { not: "CLOSED" as const } },
    select: { id: true, title: true, status: true },
    orderBy: { createdAt: "desc" as const },
  },
  maintenance: {
    where: { active: true },
    orderBy: { createdAt: "asc" as const },
  },
} as const;

/** Longest real registration is ~7 characters; 12 leaves room for oddities. */
const MAX_TAIL_LENGTH = 12;

/**
 * Tail numbers are stored upper-case and space-free, so "nb 3188" and "NB3188"
 * are the same airplane. Registrations are written with dashes in most of the
 * world (G-ABCD, D-EFGH), so dashes survive.
 */
export function normalizeTailNumber(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase();
}

/**
 * Why a tail number can't be used, or null when it's fine. Deliberately loose
 * about *format* — this app is not the registry, and a club flying a foreign
 * or experimental registration shouldn't have to fight the validator.
 */
export function tailNumberError(raw: string): string | null {
  const tail = normalizeTailNumber(raw);
  if (!tail) return "Tail number is required.";
  if (tail.length > MAX_TAIL_LENGTH) {
    return `Tail number can be at most ${MAX_TAIL_LENGTH} characters.`;
  }
  if (!/^[A-Z0-9-]+$/.test(tail)) {
    return "Tail number can only contain letters, numbers and dashes.";
  }
  return null;
}

/** Why an aircraft's model can't be used, or null. */
export function modelError(raw: string): string | null {
  if (!raw.trim()) return "Model is required.";
  return null;
}
