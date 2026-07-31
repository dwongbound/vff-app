import { describe, expect, it } from "vitest";
import {
  PREFLIGHT_CHECKLIST,
  TOTAL_ITEMS,
  allItemIds,
  countChecked,
  countSectionChecked,
  isComplete,
  missingItems,
  parseAnswers,
} from "@/lib/checklist";

describe("checklist shape", () => {
  // Item ids are the storage keys for every PreflightCheck ever saved — a
  // duplicate would silently merge two different checks.
  it("has unique item ids", () => {
    const ids = allItemIds();
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has no empty sections", () => {
    for (const section of PREFLIGHT_CHECKLIST) {
      expect(section.items.length).toBeGreaterThan(0);
    }
  });
});

describe("parseAnswers", () => {
  it("keeps only live item ids that are true", () => {
    const first = allItemIds()[0];
    expect(parseAnswers({ [first]: true, "retired.item": true, [allItemIds()[1]]: false }))
      .toEqual({ [first]: true });
  });

  it("survives junk from the db", () => {
    expect(parseAnswers(null)).toEqual({});
    expect(parseAnswers("nope")).toEqual({});
    expect(parseAnswers([1, 2, 3])).toEqual({});
  });
});

describe("progress", () => {
  it("counts ticked items overall and per section", () => {
    const section = PREFLIGHT_CHECKLIST[0];
    const answers = { [section.items[0].id]: true, [section.items[1].id]: true };
    expect(countChecked(answers)).toBe(2);
    expect(countSectionChecked(section, answers)).toBe(2);
    expect(countSectionChecked(PREFLIGHT_CHECKLIST[1], answers)).toBe(0);
  });

  it("is only complete when every item is ticked", () => {
    const all = Object.fromEntries(allItemIds().map((id) => [id, true]));
    expect(isComplete(all)).toBe(true);
    expect(countChecked(all)).toBe(TOTAL_ITEMS);

    const oneShort = { ...all };
    delete oneShort[allItemIds()[3]];
    expect(isComplete(oneShort)).toBe(false);
    expect(missingItems(oneShort)).toHaveLength(1);
  });

  it("lists what's missing in walkaround order", () => {
    const missing = missingItems({});
    expect(missing[0].id).toBe(PREFLIGHT_CHECKLIST[0].items[0].id);
    expect(missing).toHaveLength(TOTAL_ITEMS);
  });
});
