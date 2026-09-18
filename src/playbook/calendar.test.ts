import { describe, expect, test } from "bun:test";
import {
  isOpenDay,
  nextOpenDay,
  resolveWhenExactly,
  type ResolvedWhen,
} from "./calendar";

const REFERENCE_TIME = "2026-09-18T09:00:00+02:00";

function exact(
  date: string,
  timePreference: ResolvedWhen["timePreference"] = "any",
) {
  return { dateFrom: date, dateTo: date, timePreference };
}

describe("resolveWhenExactly", () => {
  test.each([
    ["tomorrow", exact("2026-09-19")],
    ["the day after tomorrow", exact("2026-09-20")],
    ["a week from today", exact("2026-09-25")],
    ["in a fortnight", exact("2026-10-02")],
    ["on Saturday morning", exact("2026-09-19", "morning")],
    ["this coming Sunday", exact("2026-09-20")],
    ["this coming Monday", exact("2026-09-21")],
    ["this coming Tuesday", exact("2026-09-22")],
    ["this coming Wednesday", exact("2026-09-23")],
    ["this coming Thursday", exact("2026-09-24")],
    ["this coming Friday", exact("2026-09-25")],
    ["this coming Saturday", exact("2026-09-19")],
    ["first thing Sunday", exact("2026-09-20", "morning")],
    ["first thing Monday", exact("2026-09-21", "morning")],
    ["first thing Tuesday", exact("2026-09-22", "morning")],
    ["first thing Wednesday", exact("2026-09-23", "morning")],
    ["first thing Thursday", exact("2026-09-24", "morning")],
    ["first thing Friday", exact("2026-09-25", "morning")],
    ["first thing Saturday", exact("2026-09-19", "morning")],
    ["Sunday afternoon", exact("2026-09-20", "afternoon")],
    ["Monday afternoon", exact("2026-09-21", "afternoon")],
    ["Tuesday afternoon", exact("2026-09-22", "afternoon")],
    ["Wednesday afternoon", exact("2026-09-23", "afternoon")],
    ["Thursday afternoon", exact("2026-09-24", "afternoon")],
    ["Friday afternoon", exact("2026-09-25", "afternoon")],
    ["Saturday afternoon", exact("2026-09-19", "afternoon")],
    [
      "first thing on Monday the twelfth of October",
      exact("2026-10-12", "morning"),
    ],
  ] as const)("%s", (phrase, expected) => {
    expect(resolveWhenExactly(phrase, REFERENCE_TIME)).toEqual(expected);
  });

  test("finds the official phrase inside a caller utterance", () => {
    expect(
      resolveWhenExactly(
        "Could I book General Practice at Centro THIS COMING THURSDAY, please?",
        REFERENCE_TIME,
      ),
    ).toEqual(exact("2026-09-24"));
  });

  test("also accepts day after tomorrow without the optional article", () => {
    expect(resolveWhenExactly("day after tomorrow", REFERENCE_TIME)).toEqual(
      exact("2026-09-20"),
    );
  });

  test("uses Europe/Madrid rather than the UTC calendar date", () => {
    expect(
      resolveWhenExactly("tomorrow", "2026-09-17T22:30:00Z"),
    ).toEqual(exact("2026-09-19"));
  });

  test("does not guess unsupported free-form dates", () => {
    expect(
      resolveWhenExactly("sometime next week", REFERENCE_TIME),
    ).toBeUndefined();
  });

  test("rejects an invalid reference time", () => {
    expect(() => resolveWhenExactly("tomorrow", "not-a-date")).toThrow(
      "Invalid reference time",
    );
  });

  test("weekdays are strictly later when referenceTime is Thursday", () => {
    const thursday = "2026-09-17T09:00:00+02:00";
    expect(resolveWhenExactly("this coming Thursday", thursday)).toEqual(
      exact("2026-09-24"),
    );
    expect(resolveWhenExactly("first thing Thursday", thursday)).toEqual(
      exact("2026-09-24", "morning"),
    );
    expect(resolveWhenExactly("Thursday afternoon", thursday)).toEqual(
      exact("2026-09-24", "afternoon"),
    );
    expect(resolveWhenExactly("this coming Friday", thursday)).toEqual(
      exact("2026-09-18"),
    );
  });
});

describe("isOpenDay", () => {
  test("the whole network is closed on Sundays", () => {
    for (const location of [undefined, "centro", "norte", "sur"] as const) {
      expect(isOpenDay("2026-09-20", location)).toBe(false);
    }
  });

  test("the whole network is closed every 12 October", () => {
    for (const location of [undefined, "centro", "norte", "sur"] as const) {
      expect(isOpenDay("2026-10-12", location, "morning")).toBe(false);
      expect(isOpenDay("2027-10-12", location, "afternoon")).toBe(false);
    }
  });

  test("only Centro opens on Saturdays", () => {
    expect(isOpenDay("2026-09-19")).toBe(true);
    expect(isOpenDay("2026-09-19", "centro")).toBe(true);
    expect(isOpenDay("2026-09-19", "norte")).toBe(false);
    expect(isOpenDay("2026-09-19", "sur")).toBe(false);
  });

  test("Sur closes from Friday midday", () => {
    expect(isOpenDay("2026-09-18", "sur", "morning")).toBe(true);
    expect(isOpenDay("2026-09-18", "sur", "any")).toBe(true);
    expect(isOpenDay("2026-09-18", "sur", "afternoon")).toBe(false);
    expect(isOpenDay("2026-09-18", "centro", "afternoon")).toBe(true);
    expect(isOpenDay("2026-09-18", "norte", "afternoon")).toBe(true);
  });

  test("rejects malformed ISO dates", () => {
    expect(() => isOpenDay("2026-02-30", "centro")).toThrow("Invalid ISO date");
    expect(() => isOpenDay("18-09-2026", "centro")).toThrow("Invalid ISO date");
  });
});

describe("nextOpenDay", () => {
  test.each([
    ["2026-09-20", "centro", "any", "2026-09-21"],
    ["2026-09-19", "norte", "morning", "2026-09-21"],
    ["2026-10-11", "centro", "morning", "2026-10-13"],
    ["2026-10-08", "sur", "afternoon", "2026-10-13"],
    ["2026-10-08", "sur", "morning", "2026-10-09"],
    ["2026-10-08", "sur", "any", "2026-10-09"],
  ] as const)(
    "after %s at %s in the %s => %s",
    (date, location, preference, expected) => {
      expect(nextOpenDay(date, location, preference)).toBe(expected);
    },
  );

  test("is strictly later even when the supplied date is open", () => {
    expect(nextOpenDay("2026-09-18", "centro", "morning")).toBe("2026-09-19");
  });
});
