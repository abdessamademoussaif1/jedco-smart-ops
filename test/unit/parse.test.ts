import { describe, expect, it } from "vitest";
import {
    describeWeekdays,
    formatClock,
    parseCountRange,
    parseList,
    parsePercentage,
    parsePositiveInt,
    parseTimeWindow,
    parseWeekdays,
    parseWeights
} from "../../src/core/parse.ts";

describe("parseCountRange", () => {
    it("accepts numbers, ranges and objects", () => {
        expect(parseCountRange(5)).toEqual({ min: 5, max: 5 });
        expect(parseCountRange("5")).toEqual({ min: 5, max: 5 });
        expect(parseCountRange("1-10")).toEqual({ min: 1, max: 10 });
        expect(parseCountRange("1..10")).toEqual({ min: 1, max: 10 });
        expect(parseCountRange(" 2 - 3 ")).toEqual({ min: 2, max: 3 });
        expect(parseCountRange({ min: 0, max: 4 })).toEqual({ min: 0, max: 4 });
    });

    it("rejects invalid amounts", () => {
        expect(() => parseCountRange("5-1")).toThrow(/greater than the maximum/);
        expect(() => parseCountRange("-1")).toThrow(/not a valid amount/);
        expect(() => parseCountRange("abc")).toThrow(/not a valid amount/);
        expect(() => parseCountRange("0")).toThrow(/at least 1/);
        expect(() => parseCountRange(1001)).toThrow(/at most 1000/);
        expect(() => parseCountRange(1.5)).toThrow(/whole numbers/);
    });
});

describe("numbers", () => {
    it("parses percentages", () => {
        expect(parsePercentage(80)).toBe(80);
        expect(parsePercentage("80%")).toBe(80);
        expect(parsePercentage("12.5")).toBe(12.5);
        expect(() => parsePercentage("101")).toThrow(/between 0 and 100/);
        expect(() => parsePercentage("-1")).toThrow();
        expect(() => parsePercentage("many")).toThrow();
    });

    it("parses positive integers with separators", () => {
        expect(parsePositiveInt("50,000")).toBe(50_000);
        expect(parsePositiveInt("1_000")).toBe(1000);
        expect(() => parsePositiveInt("0")).toThrow();
        expect(() => parsePositiveInt("1.5")).toThrow();
        expect(() => parsePositiveInt(20, 10)).toThrow(/between 1 and 10/);
    });
});

describe("parseWeekdays", () => {
    const sorted = (set: Set<number>) => [...set].sort((a, b) => a - b);

    it("understands groups, lists and ranges", () => {
        expect(sorted(parseWeekdays("all"))).toEqual([0, 1, 2, 3, 4, 5, 6]);
        expect(sorted(parseWeekdays("weekdays"))).toEqual([1, 2, 3, 4, 5]);
        expect(sorted(parseWeekdays("weekends"))).toEqual([0, 6]);
        expect(sorted(parseWeekdays("mon,wed,Friday"))).toEqual([1, 3, 5]);
        expect(sorted(parseWeekdays("mon-fri"))).toEqual([1, 2, 3, 4, 5]);
        expect(sorted(parseWeekdays("fri-mon"))).toEqual([0, 1, 5, 6]);
        expect(sorted(parseWeekdays(["Mon", "tue"]))).toEqual([1, 2]);
    });

    it("rejects unknown days", () => {
        expect(() => parseWeekdays("funday")).toThrow(/is not a day/);
        expect(() => parseWeekdays("")).toThrow(/at least one day/);
    });

    it("describes selections", () => {
        expect(describeWeekdays(parseWeekdays("all"))).toBe("every day");
        expect(describeWeekdays(parseWeekdays("weekdays"))).toBe("weekdays");
        expect(describeWeekdays(parseWeekdays("sat,sun"))).toBe("weekends");
        expect(describeWeekdays(parseWeekdays("wed,mon"))).toBe("mon, wed");
    });
});

describe("parseWeights", () => {
    it("parses strings and objects", () => {
        expect(parseWeights("sat=0.3,sun=0.2")).toEqual([0.2, 1, 1, 1, 1, 1, 0.3]);
        expect(parseWeights("weekends=0.5")).toEqual([0.5, 1, 1, 1, 1, 1, 0.5]);
        expect(parseWeights({ mon: 2 })).toEqual([1, 2, 1, 1, 1, 1, 1]);
        expect(parseWeights("Saturday:0")).toEqual([1, 1, 1, 1, 1, 1, 0]);
    });

    it("rejects invalid weights", () => {
        expect(() => parseWeights("sat=-1")).toThrow(/≥ 0/);
        expect(() => parseWeights("sat")).toThrow(/day=value/);
        expect(() => parseWeights("xyz=1")).toThrow(/is not a day/);
    });
});

describe("parseTimeWindow", () => {
    it("parses windows", () => {
        expect(parseTimeWindow("09:00-18:00")).toEqual({ start: 32_400, end: 64_800 });
        expect(parseTimeWindow("9-18")).toEqual({ start: 32_400, end: 64_800 });
        expect(parseTimeWindow("00:00-24:00")).toEqual({ start: 0, end: 86_400 });
        expect(parseTimeWindow("8:30 - 12:15")).toEqual({ start: 30_600, end: 44_100 });
    });

    it("rejects invalid windows", () => {
        expect(() => parseTimeWindow("18-9")).toThrow(/end after it starts/);
        expect(() => parseTimeWindow("25-26")).toThrow(/invalid time/);
        expect(() => parseTimeWindow("9:60-10")).toThrow(/invalid time/);
        expect(() => parseTimeWindow("24:00-24:00")).toThrow();
        expect(() => parseTimeWindow("morning")).toThrow(/HH:MM-HH:MM/);
    });

    it("formats clock times", () => {
        expect(formatClock(32_400)).toBe("09:00");
        expect(formatClock(86_400)).toBe("24:00");
    });
});

describe("parseList", () => {
    it("splits and trims", () => {
        expect(parseList("a, b,,c ")).toEqual(["a", "b", "c"]);
        expect(parseList(["a,b", "c"])).toEqual(["a", "b", "c"]);
    });
});
