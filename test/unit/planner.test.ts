import { describe, expect, it } from "vitest";
import { weekdayOf } from "../../src/core/dates.ts";
import { buildPlan, type PlanInput } from "../../src/core/planner.ts";
import { d } from "../helpers.ts";

function input(overrides: Partial<PlanInput> = {}): PlanInput {
    return {
        from: d("2024-01-01"),
        to: d("2024-01-31"),
        seed: "test",
        fill: "all",
        schedule: {
            commits: { min: 1, max: 5 },
            distribution: "uniform",
            frequency: 100,
            weekdays: new Set([0, 1, 2, 3, 4, 5, 6]),
            weights: [1, 1, 1, 1, 1, 1, 1],
            exclude: []
        },
        time: { start: 9 * 3600, end: 21 * 3600 },
        today: d("2024-12-31"),
        nowSecondOfDay: 0,
        allowFuture: false,
        ...overrides
    };
}

function schedule(overrides: Partial<PlanInput["schedule"]>): PlanInput["schedule"] {
    return { ...input().schedule, ...overrides };
}

describe("buildPlan", () => {
    it("fills every day of the range within bounds", () => {
        const plan = buildPlan(input());
        expect(plan.days).toHaveLength(31);
        for (const day of plan.days) {
            expect(day.count).toBeGreaterThanOrEqual(1);
            expect(day.count).toBeLessThanOrEqual(5);
        }
        expect(plan.total).toBe(plan.days.reduce((sum, day) => sum + day.count, 0));
    });

    it("is deterministic and depends on the seed", () => {
        expect(buildPlan(input())).toEqual(buildPlan(input()));
        const other = buildPlan(input({ seed: "other" }));
        expect(other.days.map((day) => day.count)).not.toEqual(
            buildPlan(input()).days.map((day) => day.count)
        );
    });

    it("keeps overlapping days identical when the range changes", () => {
        const month = buildPlan(input());
        const slice = buildPlan(input({ from: d("2024-01-10"), to: d("2024-01-20") }));
        for (const day of slice.days) {
            expect(day.count).toBe(month.days.find((item) => item.day === day.day)?.count);
        }
    });

    it("honours the frequency", () => {
        expect(buildPlan(input({ schedule: schedule({ frequency: 0 }) })).total).toBe(0);
        const plan = buildPlan(
            input({
                from: d("2022-01-01"),
                to: d("2023-12-31"),
                schedule: schedule({ frequency: 50 })
            })
        );
        const active = plan.days.filter((day) => day.count > 0).length / plan.days.length;
        expect(active).toBeGreaterThan(0.43);
        expect(active).toBeLessThan(0.57);
    });

    it("only uses the selected days of the week", () => {
        const plan = buildPlan(
            input({ schedule: schedule({ weekdays: new Set([1, 2, 3, 4, 5]) }) })
        );
        for (const day of plan.days) {
            const weekday = weekdayOf(day.day);
            if (weekday === 0 || weekday === 6) expect(day.count).toBe(0);
            else expect(day.count).toBeGreaterThan(0);
        }
    });

    it("applies weekday weights", () => {
        const plan = buildPlan(input({ schedule: schedule({ weights: [0, 1, 1, 1, 1, 1, 0] }) }));
        for (const day of plan.days) {
            if ([0, 6].includes(weekdayOf(day.day))) expect(day.count).toBe(0);
        }
    });

    it("skips excluded days", () => {
        const plan = buildPlan(
            input({ schedule: schedule({ exclude: [[d("2024-01-10"), d("2024-01-12")]] }) })
        );
        const excluded = plan.days.filter(
            (day) => day.day >= d("2024-01-10") && day.day <= d("2024-01-12")
        );
        expect(excluded.every((day) => day.count === 0)).toBe(true);
    });

    it("supports a fixed amount per day", () => {
        const plan = buildPlan(input({ schedule: schedule({ commits: { min: 3, max: 3 } }) }));
        expect(plan.days.every((day) => day.count === 3)).toBe(true);
        expect(plan.total).toBe(93);
    });

    it("uses drawings instead of the schedule", () => {
        const art = new Map([
            [d("2024-01-02"), 7],
            [d("2024-01-03"), 0]
        ]);
        const plan = buildPlan(input({ art }));
        expect(plan.total).toBe(7);
        expect(plan.days.find((day) => day.day === d("2024-01-02"))?.count).toBe(7);
    });

    it("fills only the gaps", () => {
        const existing = new Map([
            [d("2024-01-05"), 2],
            [d("2024-01-06"), 10]
        ]);
        const plan = buildPlan(input({ fill: "gaps", existing }));
        expect(plan.days.find((day) => day.day === d("2024-01-05"))?.count).toBe(0);
        expect(plan.days.find((day) => day.day === d("2024-01-06"))?.count).toBe(0);
        expect(plan.days.find((day) => day.day === d("2024-01-07"))?.count).toBeGreaterThan(0);
    });

    it("tops days up to the target", () => {
        const existing = new Map([
            [d("2024-01-05"), 2],
            [d("2024-01-06"), 10]
        ]);
        const plan = buildPlan(
            input({ fill: "top-up", existing, schedule: schedule({ commits: { min: 5, max: 5 } }) })
        );
        expect(plan.days.find((day) => day.day === d("2024-01-05"))?.count).toBe(3);
        expect(plan.days.find((day) => day.day === d("2024-01-06"))?.count).toBe(0);
        expect(plan.days.find((day) => day.day === d("2024-01-07"))?.count).toBe(5);
    });

    it("never dates commits in the future", () => {
        const early = buildPlan(input({ today: d("2024-01-31"), nowSecondOfDay: 8 * 3600 }));
        expect(early.days.at(-1)?.count).toBe(0);
        expect(early.notes[0]).toMatch(/skipped/);

        const noon = buildPlan(input({ today: d("2024-01-31"), nowSecondOfDay: 12 * 3600 }));
        expect(noon.days.at(-1)?.count).toBeGreaterThan(0);
        expect(noon.todayWindowEnd).toBe(12 * 3600);

        const future = buildPlan(
            input({ today: d("2024-01-31"), nowSecondOfDay: 8 * 3600, allowFuture: true })
        );
        expect(future.days.at(-1)?.count).toBeGreaterThan(0);
        expect(future.todayWindowEnd).toBeNull();
    });
});
