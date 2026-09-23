import { describe, expect, it } from "vitest";
import { summarize } from "../../src/core/stats.ts";

describe("summarize", () => {
    it("computes totals and streaks", () => {
        expect(summarize([0, 1, 2, 0, 3, 3, 3])).toEqual({
            total: 12,
            days: 7,
            activeDays: 5,
            emptyDays: 2,
            max: 3,
            average: 2.4,
            longestStreak: 3,
            currentStreak: 3
        });
    });

    it("handles empty periods", () => {
        expect(summarize([])).toMatchObject({
            total: 0,
            activeDays: 0,
            average: 0,
            longestStreak: 0
        });
        expect(summarize([1, 1, 0])).toMatchObject({ longestStreak: 2, currentStreak: 0 });
    });
});
