// A half-filled post-flight entry, kept on the device it's being filled in on.
//
// Same promise the checkout cards make (see lib/checkoutDraft.ts): leave the
// page, come back, and your work is still there. It has to be the same promise
// because it's the same member on the same phone in the same hour — walking
// away from the turn-off checkout to move the airplane and coming back to a
// blank form is exactly the failure autosave was built to end.
//
// ONE store, though, not two, and that's the difference from a checkout draft.
// A preflight card syncs to a `Checkout` row, which is what lets a walk started
// on a phone be finished on the clubhouse iPad. The post-flight form has no
// such row to sync to: the turn-off answers belong to a `Flight`, and the
// flight does not exist until the form is filed. So this is the device's copy
// and nothing else, and the page says so rather than implying a sync that isn't
// happening.
//
// What is NOT kept: FILES. Photos and any pictures attached to a squawk are
// `File` handles, which don't survive a page load and would be megabytes of
// base64 in localStorage if they did. The squawk TEXT is kept — losing a
// reported fault is the worst thing this form could do — and `hadPhotos`
// records that pictures were attached, so the page can tell the member to
// attach them again rather than leaving them to assume.
//
// Nothing here touches `window`: every entry point takes its store, the same
// rule (and for the same reason) as lib/checkoutDraft.ts.
import {
  POSTFLIGHT_DRAFT_KEY_PREFIX,
  type DraftStore,
} from "@/lib/checkoutDraft";
import { parseAnswers, parseValues, type Answers, type Values } from "@/lib/checkouts";

/** A squawk raised on the flight, minus the files. */
export interface PostflightDraftSquawk {
  title: string;
  description: string;
  /** Pictures were attached and could not be kept — the page says so. */
  hadPhotos: boolean;
}

/**
 * Every field of the form, as the page holds it.
 *
 * Deliberately the STRINGS the inputs are bound to rather than parsed numbers:
 * a draft is a half-typed form, and "150" on its way to "1506.1" is a state the
 * member is entitled to walk away from. Parsing here would turn a partial entry
 * into a wrong one.
 */
export interface PostflightForm {
  reservationId: string;
  flownOn: string;
  tachStart: string;
  tachEnd: string;
  hobbsStart: string;
  hobbsEnd: string;
  landings: string;
  nightLandings: string;
  withInstructor: boolean;
  instructorId: string;
  departure: string;
  arrival: string;
  route: string;
  fuelAdded: string;
  fuelCost: string;
  oilAdded: string;
  /**
   * The landing fee, in dollars as typed. Prefilled from the arrival airport
   * (lib/landingFees.ts) until the member types in the box, which is why the
   * flag below sits alongside the meters' rather than in the typed-field list.
   */
  landingFee: string;
  notes: string;
  turnoffAnswers: Answers;
  turnoffValues: Values;
  /**
   * Which meter boxes the member typed into by hand.
   *
   * Kept because it decides whether a box still follows its checkout card. A
   * restored draft that forgot this would let the cards overwrite a correction
   * the member had deliberately made — silently, and in the numbers the club
   * bills on.
   */
  edited: {
    tachStart: boolean;
    tachEnd: boolean;
    hobbsStart: boolean;
    hobbsEnd: boolean;
    /**
     * Whether the member typed their own landing fee. Same job as the meters
     * above: without it, restoring a draft would let the airport's default
     * overwrite a figure the member had deliberately corrected — the $6 the
     * table expects silently replacing the $12 the desk actually took.
     */
    landingFee: boolean;
  };
  squawks: PostflightDraftSquawk[];
  /** Photos were attached to the flight itself and could not be kept. */
  hadPhotos: boolean;
}

export interface PostflightDraft extends PostflightForm {
  aircraftId: string;
  memberId: string;
  /** The turn-off card these ticks were made against. Mismatch ⇒ discard. */
  turnoffVersion: number;
  /** When this was last written to the device (ISO). */
  savedAt: string;
}

export interface PostflightDraftIdentity {
  memberId: string;
  aircraftId: string;
}

/**
 * Where one member's post-flight draft for one airplane lives.
 *
 * The member is in the key for the same reason as a checkout's: a shared
 * clubhouse iPad must never hand one member's flight entry to the next.
 */
export function postflightDraftKey({
  memberId,
  aircraftId,
}: PostflightDraftIdentity): string {
  return `${POSTFLIGHT_DRAFT_KEY_PREFIX}:${memberId}:${aircraftId}`;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function bool(value: unknown): boolean {
  return value === true;
}

function squawks(value: unknown): PostflightDraftSquawk[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((row) =>
      row && typeof row === "object"
        ? {
            title: str((row as Record<string, unknown>).title),
            description: str((row as Record<string, unknown>).description),
            hadPhotos: bool((row as Record<string, unknown>).hadPhotos),
          }
        : { title: "", description: "", hadPhotos: false }
    )
    // A squawk with no title is one the member never actually wrote — it can't
    // be filed and it would show as a blank row on the list.
    .filter((row) => row.title.trim() !== "");
}

/**
 * Read a stored draft back, or null if it can't be trusted.
 *
 * Discards rather than repairs, on the same grounds as `parseDraft`: a
 * different member or airplane than the key promised is only reachable by
 * tampering, and a turn-off card that has been reworded since means these ticks
 * asserted something other than what the form now asks.
 *
 * The FIELDS, by contrast, are read leniently — every one falls back to empty.
 * They're free-text form state rather than assertions about an airplane, so a
 * draft missing a field the build has since added is worth keeping for the
 * fifteen other fields the member typed.
 */
export function parsePostflightDraft(
  raw: string | null,
  expect: PostflightDraftIdentity & { turnoffVersion: number }
): PostflightDraft | null {
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const row = parsed as Record<string, unknown>;

  if (row.aircraftId !== expect.aircraftId) return null;
  if (row.memberId !== expect.memberId) return null;
  if (row.turnoffVersion !== expect.turnoffVersion) return null;

  const savedAt = typeof row.savedAt === "string" ? row.savedAt : null;
  if (!savedAt || Number.isNaN(Date.parse(savedAt))) return null;

  const edited = (row.edited ?? {}) as Record<string, unknown>;

  return {
    aircraftId: expect.aircraftId,
    memberId: expect.memberId,
    turnoffVersion: expect.turnoffVersion,
    savedAt,
    reservationId: str(row.reservationId),
    flownOn: str(row.flownOn),
    tachStart: str(row.tachStart),
    tachEnd: str(row.tachEnd),
    hobbsStart: str(row.hobbsStart),
    hobbsEnd: str(row.hobbsEnd),
    landings: str(row.landings),
    nightLandings: str(row.nightLandings),
    withInstructor: bool(row.withInstructor),
    instructorId: str(row.instructorId),
    departure: str(row.departure),
    arrival: str(row.arrival),
    route: str(row.route),
    fuelAdded: str(row.fuelAdded),
    fuelCost: str(row.fuelCost),
    oilAdded: str(row.oilAdded),
    landingFee: str(row.landingFee),
    notes: str(row.notes),
    // Through the card itself, so an id this build no longer knows is dropped
    // here exactly as the API would drop it.
    turnoffAnswers: parseAnswers("TURNOFF", row.turnoffAnswers),
    turnoffValues: parseValues("TURNOFF", row.turnoffValues),
    edited: {
      tachStart: bool(edited.tachStart),
      tachEnd: bool(edited.tachEnd),
      hobbsStart: bool(edited.hobbsStart),
      hobbsEnd: bool(edited.hobbsEnd),
      landingFee: bool(edited.landingFee),
    },
    squawks: squawks(row.squawks),
    hadPhotos: bool(row.hadPhotos),
  };
}

/** Load this member's post-flight draft for this airplane. Never throws. */
export function readPostflightDraft(
  store: DraftStore | null,
  expect: PostflightDraftIdentity & { turnoffVersion: number }
): PostflightDraft | null {
  if (!store) return null;
  try {
    return parsePostflightDraft(store.getItem(postflightDraftKey(expect)), expect);
  } catch {
    return null;
  }
}

/** Write the draft. Returns whether it actually landed — see `writeDraft`. */
export function writePostflightDraft(
  store: DraftStore | null,
  draft: PostflightDraft
): boolean {
  if (!store) return false;
  try {
    store.setItem(postflightDraftKey(draft), JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

/** Throw this member's post-flight draft away. */
export function clearPostflightDraft(
  store: DraftStore | null,
  expect: PostflightDraftIdentity
): void {
  if (!store) return;
  try {
    store.removeItem(postflightDraftKey(expect));
  } catch {
    /* see readPostflightDraft */
  }
}

/**
 * Is there anything here worth saving?
 *
 * The form does NOT start empty — it opens with today's date, a landing count
 * of 1, a stopped flight timer, and meters prefilled from the checkouts — so
 * "any field is non-empty" would save a draft for a member who has done nothing
 * but open the tab, and then offer to restore it. What counts as work is
 * anything the member could only have got by typing, ticking or choosing.
 *
 * The METERS are the subtle case, and they go the other way. They arrive
 * prefilled — tach start from the airplane's last filed flight before anyone
 * has touched anything — so counting a non-empty meter box as work would save a
 * draft for a member who did nothing but open the tab, and then offer to
 * restore it. A meter counts only when the member typed in it (`edited`).
 *
 * Nothing is lost by that. A reading that came off the turn-off card is
 * recorded in `turnoffValues`, and recording it ticked its item, so the card's
 * own answers already make the form dirty — which is the honest reason to save
 * it, rather than the copy of that number sitting in the meter box.
 */
export function postflightDraftHasProgress(form: PostflightForm): boolean {
  if (form.squawks.length > 0 || form.hadPhotos) return true;
  if (Object.values(form.turnoffAnswers).some(Boolean)) return true;
  if (form.withInstructor || form.instructorId !== "") return true;
  if (form.reservationId !== "") return true;
  if (Object.values(form.edited).some(Boolean)) return true;

  const typed = [
    form.departure,
    form.arrival,
    form.route,
    form.fuelAdded,
    form.fuelCost,
    form.oilAdded,
    form.notes,
  ];
  return typed.some((value) => value.trim() !== "");
}
