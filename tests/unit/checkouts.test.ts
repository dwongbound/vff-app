import { describe, expect, it } from "vitest";
import {
  CHECKOUTS,
  PREFLIGHT_CHECKOUT,
  RUNWAY_CHECKOUT,
  TURNOFF_CHECKOUT,
  allFields,
  allItemIds,
  checkoutFor,
  deriveFuelOil,
  fieldById,
  initialValues,
  outOfRange,
  parseValues,
  countChecked,
  countSectionChecked,
  derivePutAway,
  isCheckoutKind,
  isComplete,
  missingItems,
  parseAnswers,
  totalItems,
  type Checkout,
  type CheckoutKind,
} from "@/lib/checkouts";

const ALL: Checkout[] = [PREFLIGHT_CHECKOUT, RUNWAY_CHECKOUT, TURNOFF_CHECKOUT];
const KINDS: CheckoutKind[] = ["PREFLIGHT", "RUNWAY", "TURNOFF"];

describe("checkout shape", () => {
  // Item ids are the storage keys for every Checkout and Flight row ever
  // saved — a duplicate would silently merge two different checks. All three
  // checkouts share one id namespace so they can never collide either.
  it("has unique item ids across all three checkouts", () => {
    const ids = KINDS.flatMap(allItemIds);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has no empty sections", () => {
    for (const checkout of ALL) {
      for (const section of checkout.sections) {
        expect(section.items.length, `${checkout.kind}/${section.id}`).toBeGreaterThan(0);
      }
    }
  });

  // The (i) popover is only useful if nothing is missing one.
  it("explains why every single item is on the card", () => {
    for (const checkout of ALL) {
      for (const section of checkout.sections) {
        for (const item of section.items) {
          expect(item.why, `${item.id} has no why`).toBeTruthy();
          expect(item.why.length, item.id).toBeGreaterThan(30);
        }
      }
    }
  });

  it("indexes every kind under its own key", () => {
    for (const kind of KINDS) {
      expect(CHECKOUTS[kind].kind).toBe(kind);
      expect(checkoutFor(kind)).toBe(CHECKOUTS[kind]);
    }
  });

  it("narrows a kind coming off the wire", () => {
    expect(isCheckoutKind("PREFLIGHT")).toBe(true);
    expect(isCheckoutKind("TURNOFF")).toBe(true);
    expect(isCheckoutKind("preflight")).toBe(false);
    expect(isCheckoutKind(null)).toBe(false);
  });
});

// Section order is the card's own order, and the card is the airplane's, so a
// reordering here is a real change to how somebody walks the airplane.
describe("card order", () => {
  it("walks the preflight card: homework → consumables → cockpit → the walk", () => {
    expect(PREFLIGHT_CHECKOUT.sections.map((s) => s.id)).toEqual([
      "imsafe",
      "homework",
      "consumables",
      "cockpit",
      "left-wing",
      "nose",
      "right-wing",
      "empennage",
      "walkaround",
      "briefing",
    ]);
  });

  it("walks the runway card: sitting down to holding short", () => {
    expect(RUNWAY_CHECKOUT.sections.map((s) => s.id)).toEqual([
      "passengers",
      "before-start",
      "prelube",
      "starting",
      "runup",
      "pretakeoff",
      "fiveps",
    ]);
  });

  it("walks the turn-off card: after landing → shutdown → parking", () => {
    expect(TURNOFF_CHECKOUT.sections.map((s) => s.id)).toEqual([
      "after-landing",
      "shutdown",
      "parking",
    ]);
  });

  // The club's operating rules put I'M SAFE before anyone touches the airplane
  // and the 5 Ps at the runup, so the two mnemonics bracket the whole thing.
  it("brackets the airplane's own checks with the club's mnemonics", () => {
    expect(PREFLIGHT_CHECKOUT.sections[0].id).toBe("imsafe");
    const runway = RUNWAY_CHECKOUT.sections;
    expect(runway[runway.length - 1].id).toBe("fiveps");
  });

  // The version stamp is what keeps an old row interpretable. PREFLIGHT and
  // TURNOFF continue the versions their columns already held.
  it("keeps versions ahead of what the columns already hold", () => {
    expect(PREFLIGHT_CHECKOUT.version).toBeGreaterThanOrEqual(5);
    expect(TURNOFF_CHECKOUT.version).toBeGreaterThanOrEqual(2);
    expect(RUNWAY_CHECKOUT.version).toBeGreaterThanOrEqual(1);
  });
});

describe("parseAnswers", () => {
  it("keeps only live item ids that are true", () => {
    const ids = allItemIds("PREFLIGHT");
    expect(
      parseAnswers("PREFLIGHT", {
        [ids[0]]: true,
        "retired.item": true,
        [ids[1]]: false,
      })
    ).toEqual({ [ids[0]]: true });
  });

  it("survives junk from the db", () => {
    expect(parseAnswers("PREFLIGHT", null)).toEqual({});
    expect(parseAnswers("PREFLIGHT", "nope")).toEqual({});
    expect(parseAnswers("PREFLIGHT", [1, 2, 3])).toEqual({});
  });

  // Each checkout is stored on its own row (or, for TURNOFF, its own column),
  // so answers from one can never leak into another's progress.
  it("keeps every checkout in its own namespace", () => {
    const preflightId = allItemIds("PREFLIGHT")[0];
    const runwayId = allItemIds("RUNWAY")[0];
    const turnoffId = allItemIds("TURNOFF")[0];

    expect(parseAnswers("RUNWAY", { [runwayId]: true, [preflightId]: true })).toEqual({
      [runwayId]: true,
    });
    expect(parseAnswers("PREFLIGHT", { [turnoffId]: true })).toEqual({});
    expect(parseAnswers("TURNOFF", { [runwayId]: true })).toEqual({});
  });
});

describe("progress", () => {
  it("counts ticked items overall and per section", () => {
    const section = PREFLIGHT_CHECKOUT.sections[0];
    const answers = { [section.items[0].id]: true, [section.items[1].id]: true };
    expect(countChecked("PREFLIGHT", answers)).toBe(2);
    expect(countSectionChecked(section, answers)).toBe(2);
    expect(countSectionChecked(PREFLIGHT_CHECKOUT.sections[1], answers)).toBe(0);
  });

  it("is only complete when every required item is ticked", () => {
    for (const kind of KINDS) {
      const all = Object.fromEntries(allItemIds(kind).map((id) => [id, true]));
      expect(isComplete(kind, all), kind).toBe(true);
      expect(countChecked(kind, all), kind).toBe(totalItems(kind));

      const oneShort = { ...all };
      delete oneShort[missingItems(kind, {})[3].id];
      expect(isComplete(kind, oneShort), kind).toBe(false);
      expect(missingItems(kind, oneShort), kind).toHaveLength(1);
    }
  });

  it("lists what's missing in card order", () => {
    const missing = missingItems("PREFLIGHT", {});
    expect(missing[0].id).toBe(PREFLIGHT_CHECKOUT.sections[0].items[0].id);
    expect(missing).toHaveLength(totalItems("PREFLIGHT"));
  });
});

// The cold-start pre-lube doesn't apply on a warm engine and the VOR/GPS check
// doesn't apply to a VFR flight, so neither may ever stand between a pilot and
// a sign-off.
describe("optional items and sections", () => {
  const optionalIds = ALL.flatMap((c) =>
    c.sections.flatMap((s) =>
      s.items.filter((i) => s.optional || i.optional).map((i) => i.id)
    )
  );

  it("has the pre-lube as the only optional section", () => {
    const optional = ALL.flatMap((c) =>
      c.sections.filter((s) => s.optional).map((s) => s.id)
    );
    expect(optional).toEqual(["prelube"]);
  });

  it("has the card's IFR-only line as the only optional item", () => {
    const items = ALL.flatMap((c) =>
      c.sections.flatMap((s) => s.items.filter((i) => i.optional).map((i) => i.id))
    );
    expect(items).toEqual(["consumables.ifr"]);
  });

  it("leaves optional items out of progress and sign-off", () => {
    for (const kind of KINDS) {
      const ids = allItemIds(kind);
      const skipped = ids.filter((id) => optionalIds.includes(id));
      expect(totalItems(kind), kind).toBe(ids.length - skipped.length);

      const required = Object.fromEntries(
        ids.filter((id) => !skipped.includes(id)).map((id) => [id, true])
      );
      expect(isComplete(kind, required), kind).toBe(true);
      expect(missingItems(kind, required), kind).toHaveLength(0);
    }
  });

  it("still stores an optional item that was ticked", () => {
    const answers = parseAnswers("PREFLIGHT", { "consumables.ifr": true });
    expect(answers).toEqual({ "consumables.ifr": true });
    // …but ticking it can't push progress past 100%.
    expect(countChecked("PREFLIGHT", answers)).toBe(0);
  });
});

// The club adds a handful of items to the airplane's three cards, and each one
// is marked so a member comparing the app against the laminated card can see
// which lines aren't printed on it.
describe("the club's own additions", () => {
  it("marks them, and adds nothing else", () => {
    // Whole sections the club added, as opposed to single lines it slipped
    // into one of the airplane's own: I'M SAFE, the 5 Ps, and the closing 360.
    const clubSections = new Set(["imsafe", "fiveps", "walkaround"]);
    const extra = ALL.flatMap((c) =>
      c.sections.flatMap((s) =>
        clubSections.has(s.id) ? [] : s.items.filter((i) => i.club).map((i) => i.id)
      )
    );
    expect(extra).toEqual([
      "homework.squawks",
      "cockpit.meters",
      // Not on the card: the card's tail items check that the elevator, trim
      // and rudder are ATTACHED, which is a different question from whether
      // they move.
      "empennage.controls-free",
      // Switched on at the end of the before-start flow, and off again after
      // the master on the turn-off card. The detector is the club's, not the
      // airframe's, so neither line is printed on the laminated card.
      "start.co-detector",
      // The starter turn at the end of the cold-start pre-lube: the card's
      // hand pull moves oil off the cylinder walls, the crank works the pump.
      "prelube.crank",
      "shutdown.co-detector",
      "parking.cabin",
    ]);
  });
});

// A few items are questions the app can already answer, and the card links out
// to the page that answers them. Pinned as a LIST for the same reason the club
// additions above are: this is a promise about what the card sends a member
// away to do mid-walk, so a new one should be a deliberate edit here too.
describe("items that link out to a tool", () => {
  it("links weight and balance to the tool, and links nothing else", () => {
    const linked = ALL.flatMap((c) =>
      c.sections.flatMap((s) =>
        s.items.filter((i) => i.link).map((i) => [i.id, i.link!.href])
      )
    );
    expect(linked).toEqual([["homework.wb", "/tools/weight-balance"]]);
  });

  it("links in-app, with something to press", () => {
    // A relative href would resolve against whichever page the card is on, and
    // an external one would take a member off the app mid-preflight.
    for (const checkout of ALL) {
      for (const item of checkout.sections.flatMap((s) => s.items)) {
        if (!item.link) continue;
        expect(item.link.href.startsWith("/")).toBe(true);
        expect(item.link.label.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("does not tick, block, or otherwise change the item", () => {
    // The app can compute the numbers; it cannot know you looked at them. So
    // the row is still the pilot's to tick, and still counts toward sign-off.
    const wb = PREFLIGHT_CHECKOUT.sections
      .flatMap((s) => s.items)
      .find((i) => i.id === "homework.wb")!;
    expect(wb.optional).toBeUndefined();
    expect(missingItems("PREFLIGHT", {}).map((i) => i.id)).toContain(
      "homework.wb"
    );
  });
});

// The flight log's put-away nags are derived from the parking section, so
// "tied down" means the pilot confirmed it rather than left a toggle alone.
describe("derivePutAway", () => {
  it("needs both the tie-downs and the chocks", () => {
    expect(derivePutAway({}).tiedDown).toBe(false);
    expect(derivePutAway({ "parking.tiedowns": true }).tiedDown).toBe(false);
    expect(
      derivePutAway({ "parking.tiedowns": true, "parking.chocks": true }).tiedDown
    ).toBe(true);
  });

  it("reads the cabin from its own item", () => {
    expect(derivePutAway({}).cabinClean).toBe(false);
    expect(derivePutAway({ "parking.cabin": true }).cabinClean).toBe(true);
  });

  it("is satisfied by a fully ticked turn-off checkout", () => {
    const all = Object.fromEntries(allItemIds("TURNOFF").map((id) => [id, true]));
    expect(derivePutAway(all)).toEqual({ tiedDown: true, cabinClean: true });
  });
});

// Readings recorded ON the items — the numbers the card tells you to write
// down, instead of ticking a box and re-typing them somewhere else.
describe("recorded values", () => {
  it("namespaces every field id under the item that owns it", () => {
    for (const kind of KINDS) {
      const items = new Set(allItemIds(kind));
      for (const field of allFields(kind)) {
        const owner = field.id.slice(0, field.id.lastIndexOf("."));
        expect(items.has(owner), `${field.id} has no owning item`).toBe(true);
      }
    }
  });

  it("keeps field ids unique across all three checkouts", () => {
    const ids = KINDS.flatMap((k) => allFields(k).map((f) => f.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("puts the fuel and oil readings on the consumables items", () => {
    // Fuel is dipped a wing at a time, which is how you actually do it.
    expect(fieldById("PREFLIGHT", "consumables.dip.left")?.unit).toBe("gal");
    expect(fieldById("PREFLIGHT", "consumables.dip.right")?.unit).toBe("gal");
    expect(fieldById("PREFLIGHT", "consumables.oil.qts")?.unit).toBe("qts");
    expect(fieldById("PREFLIGHT", "nope.nope")).toBeUndefined();
  });

  // The club checks the tires but doesn't log a gauge reading — a box nobody
  // fills in teaches people that boxes are optional.
  it("records nothing on the tire item", () => {
    expect(fieldById("PREFLIGHT", "consumables.tires.nose")).toBeUndefined();
    expect(fieldById("PREFLIGHT", "consumables.tires.mains")).toBeUndefined();
    expect(allItemIds("PREFLIGHT")).toContain("consumables.tires");
  });
});

describe("parseValues", () => {
  it("keeps live fields and coerces numbers", () => {
    expect(
      parseValues("PREFLIGHT", { "consumables.dip.left": "17.5" })
    ).toEqual({ "consumables.dip.left": 17.5 });
  });

  it("drops ids that aren't on this card", () => {
    expect(
      parseValues("PREFLIGHT", {
        "consumables.dip.left": 20,
        "shutdown.tach.hours": 12, // a TURNOFF field
        "consumables.dip.gal": 34.5, // the pre-v6 single total
        "consumables.tires.nose": 26, // dropped in v6
      })
    ).toEqual({ "consumables.dip.left": 20 });
  });

  // NaN would survive into the column as JSON null, and then every reader has
  // to guard it. Better never to store it.
  it("drops a number that won't parse rather than storing NaN", () => {
    expect(parseValues("PREFLIGHT", { "consumables.dip.left": "abc" })).toEqual({});
  });

  it("trims times and drops blanks", () => {
    expect(parseValues("PREFLIGHT", { "cockpit.time.at": " 09:30 " })).toEqual({
      "cockpit.time.at": "09:30",
    });
    expect(parseValues("PREFLIGHT", { "cockpit.time.at": "  " })).toEqual({});
  });

  it("survives junk from the db", () => {
    expect(parseValues("PREFLIGHT", null)).toEqual({});
    expect(parseValues("PREFLIGHT", "nope")).toEqual({});
    expect(parseValues("PREFLIGHT", [1, 2])).toEqual({});
  });
});

// Advisory only: the app says a reading looks unusual, it never decides
// whether the flight happens.
describe("outOfRange", () => {
  const oil = fieldById("PREFLIGHT", "consumables.oil.qts")!;
  // The runup's RPM boxes are gone (a judgement at the tachometer, not a
  // figure typed at 1600 RPM), so the max-side example is now the fuel dip.
  const dip = fieldById("PREFLIGHT", "consumables.dip.left")!;

  it("flags a reading below the card's minimum", () => {
    expect(outOfRange(oil, 3)).toBeTruthy();
    expect(outOfRange(oil, 4)).toBeNull();
    expect(outOfRange(oil, 6)).toBeNull();
  });

  it("flags a reading above the card's maximum", () => {
    expect(outOfRange(dip, 24)).toBeTruthy();
    expect(outOfRange(dip, 17.5)).toBeNull();
  });

  it("says nothing about a field with no expected range, or no value", () => {
    const time = fieldById("PREFLIGHT", "cockpit.time.at")!;
    expect(outOfRange(time, "09:30")).toBeNull();
    expect(outOfRange(oil, undefined)).toBeNull();
  });
});

// The two columns Plane Status queries. Same pattern as derivePutAway: the
// pilot records them once, on the card, and the API derives the columns.
describe("deriveFuelOil", () => {
  it("totals the two wings into the airplane's fuel", () => {
    expect(
      deriveFuelOil({
        "consumables.dip.left": 17.5,
        "consumables.dip.right": 17,
        "consumables.oil.qts": 6,
      })
    ).toEqual({ fuelOnBoardGal: 34.5, oilQuarts: 6 });
  });

  it("is null for anything not recorded", () => {
    expect(deriveFuelOil({})).toEqual({
      fuelOnBoardGal: null,
      oilQuarts: null,
    });
  });

  // Half an answer is still a reading. Dropping it would take the Status tab's
  // fuel meter down to nothing over one un-dipped wing.
  it("takes one wing when that's all that was dipped", () => {
    expect(deriveFuelOil({ "consumables.dip.left": 12 }).fuelOnBoardGal).toBe(12);
    expect(deriveFuelOil({ "consumables.dip.right": 9 }).fuelOnBoardGal).toBe(9);
  });

  // Zero gallons is a real, alarming reading — it must not read as "unrecorded".
  it("keeps a recorded zero", () => {
    expect(deriveFuelOil({ "consumables.dip.left": 0 }).fuelOnBoardGal).toBe(0);
    expect(
      deriveFuelOil({ "consumables.dip.left": 0, "consumables.dip.right": 0 })
        .fuelOnBoardGal
    ).toBe(0);
  });

  // The pre-v6 id. It is NOT read as a left tank or as a total: that would be
  // inventing a reading, and the column it produced is still on the row.
  it("ignores the superseded single-total field", () => {
    expect(deriveFuelOil({ "consumables.dip.gal": 34.5 }).fuelOnBoardGal).toBeNull();
  });
});

// The clock readings a card asks for, pre-filled so nobody types the time they
// are standing there reading off their own phone.
describe("initialValues", () => {
  const at = new Date("2026-08-08T20:30:00Z"); // 13:30 Pacific (PDT)

  it("opens each card's time field at the club's current clock", () => {
    expect(initialValues("PREFLIGHT", at)).toEqual({ "cockpit.time.at": "13:30" });
    expect(initialValues("RUNWAY", at)).toEqual({ "starting.timer.at": "13:30" });
    expect(initialValues("TURNOFF", at)).toEqual({ "shutdown.timer.at": "13:30" });
  });

  // Club time, not the device's — a member whose laptop is still on Eastern
  // would otherwise write a time three hours out onto the airplane's card.
  it("uses the club's zone rather than the machine's", () => {
    const winter = new Date("2026-01-15T20:30:00Z"); // 12:30 Pacific (PST)
    expect(initialValues("PREFLIGHT", winter)).toEqual({
      "cockpit.time.at": "12:30",
    });
  });

  it("fills nothing that isn't a defaulted time field", () => {
    for (const kind of KINDS) {
      for (const id of Object.keys(initialValues(kind, at))) {
        expect(fieldById(kind, id)?.defaultNow).toBe(true);
      }
    }
  });

  // A pre-filled box is not an answer. Nobody confirmed anything by opening a
  // page, so the item it sits on stays unticked.
  it("ticks nothing", () => {
    expect(countChecked("PREFLIGHT", parseAnswers("PREFLIGHT", initialValues("PREFLIGHT", at)))).toBe(0);
  });
});
