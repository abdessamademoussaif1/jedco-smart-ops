import { describe, expect, it } from "vitest";
import {
    addMonths,
    dayFromYmd,
    formatDay,
    isInRanges,
    isValidYmd,
    parseDateInput,
    parseDateRanges,
    startOfWeek,
    weekdayOf,
    ymdFromDay
} from "../../src/core/dates.ts";
import { InvalidValueError } from "../../src/errors.ts";
import { d } from "../helpers.ts";

describe("day numbers", () => {
    it("counts days since the Unix epoch", () => {
        expect(dayFromYmd(1970, 1, 1)).toBe(0);
        expect(dayFromYmd(1970, 1, 2)).toBe(1);
        expect(dayFromYmd(2024, 1, 1)).toBe(19723);
    });

    it("round-trips through year/month/day", () => {
        for (const text of ["2000-02-29", "2024-12-31", "1999-01-01", "2038-01-19"]) {
            const day = d(text);
            expect(formatDay(day)).toBe(text);
            const { year, month, day: dom } = ymdFromDay(day);
            expect(dayFromYmd(year, month, dom)).toBe(day);
        }
    });

    it("knows the day of the week (0 = Sunday)", () => {
        expect(weekdayOf(0)).toBe(4); // 1970-01-01 was a Thursday
        expect(weekdayOf(d("2024-01-01"))).toBe(1);
        expect(weekdayOf(d("2024-06-09"))).toBe(0);
        expect(weekdayOf(d("2024-06-15"))).toBe(6);
    });

    it("finds the Sunday that starts the week", () => {
        expect(formatDay(startOfWeek(d("2024-01-03")))).toBe("2023-12-31");
        expect(formatDay(startOfWeek(d("2024-06-09")))).toBe("2024-06-09");
    });

    it("validates calendar dates", () => {
        expect(isValidYmd(2024, 2, 29)).toBe(true);
        expect(isValidYmd(2023, 2, 29)).toBe(false);
        expect(isValidYmd(2024, 13, 1)).toBe(false);
        expect(isValidYmd(2024, 4, 31)).toBe(false);
    });

    it("adds months clamping the day of month", () => {
        expect(formatDay(addMonths(d("2024-03-31"), -1))).toBe("2024-02-29");
        expect(formatDay(addMonths(d("2023-03-31"), -1))).toBe("2023-02-28");
        expect(formatDay(addMonths(d("2024-01-15"), -12))).toBe("2023-01-15");
        expect(formatDay(addMonths(d("2024-02-29"), -12))).toBe("2023-02-28");
        expect(formatDay(addMonths(d("2024-11-30"), 3))).toBe("2025-02-28");
    });
});

describe("parseDateInput", () => {
    const today = d("2024-06-15");

    it("parses full dates", () => {
        expect(parseDateInput("2024-01-05", "start", today)).toBe(d("2024-01-05"));
        expect(parseDateInput(" 2024-1-5 ", "end", today)).toBe(d("2024-01-05"));
    });

    it("expands months and years depending on the role", () => {
        expect(formatDay(parseDateInput("2024-02", "start", today))).toBe("2024-02-01");
        expect(formatDay(parseDateInput("2024-02", "end", today))).toBe("2024-02-29");
        expect(formatDay(parseDateInput("2023", "start", today))).toBe("2023-01-01");
        expect(formatDay(parseDateInput(2023, "end", today))).toBe("2023-12-31");
    });

    it("understands keywords and relative values", () => {
        expect(parseDateInput("today", "end", today)).toBe(today);
        expect(parseDateInput("Yesterday", "end", today)).toBe(today - 1);
        expect(parseDateInput("30d", "start", today)).toBe(today - 30);
        expect(parseDateInput("2w", "start", today)).toBe(today - 14);
        expect(formatDay(parseDateInput("6m", "start", today))).toBe("2023-12-15");
        expect(formatDay(parseDateInput("1y", "start", today))).toBe("2023-06-15");
        expect(formatDay(parseDateInput("2 years ago", "start", today))).toBe("2022-06-15");
        expect(parseDateInput("10 days", "start", today)).toBe(today - 10);
    });

    it("rejects impossible or malformed dates with a clear message", () => {
        expect(() => parseDateInput("2024-02-30", "start", today)).toThrow(
            /not a real calendar date/
        );
        expect(() => parseDateInput("2024-13", "start", today)).toThrow(/invalid month/);
        expect(() => parseDateInput("1969-12-31", "start", today)).toThrow(/between 1970 and 2099/);
        expect(() => parseDateInput("next friday", "start", today)).toThrow(InvalidValueError);
        expect(() => parseDateInput("", "start", today)).toThrow(/empty/);
    });
});

describe("parseDateRanges", () => {
    const today = d("2024-06-15");

    it("parses single days, months and ranges", () => {
        expect(parseDateRanges("2024-12-25", today)).toEqual([[d("2024-12-25"), d("2024-12-25")]]);
        expect(parseDateRanges("2024-08", today)).toEqual([[d("2024-08-01"), d("2024-08-31")]]);
        expect(parseDateRanges(["2024-08-01..2024-08-15", "2024-01-01"], today)).toEqual([
            [d("2024-08-01"), d("2024-08-15")],
            [d("2024-01-01"), d("2024-01-01")]
        ]);
        expect(parseDateRanges("2024-01-01, 2024-01-03", today)).toHaveLength(2);
    });

    it("rejects reversed or malformed ranges", () => {
        expect(() => parseDateRanges("2024-08-15..2024-08-01", today)).toThrow(/ends before/);
        expect(() => parseDateRanges("2024-01-01..2024-01-02..2024-01-03", today)).toThrow(
            /not a valid range/
        );
    });

    it("checks membership", () => {
        const ranges = parseDateRanges("2024-08-01..2024-08-15", today);
        expect(isInRanges(d("2024-08-01"), ranges)).toBe(true);
        expect(isInRanges(d("2024-08-15"), ranges)).toBe(true);
        expect(isInRanges(d("2024-08-16"), ranges)).toBe(false);
    });
});
