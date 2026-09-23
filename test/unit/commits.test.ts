import { describe, expect, it } from "vitest";
import { generateCommits } from "../../src/core/commits.ts";
import { formatDay } from "../../src/core/dates.ts";
import { buildPlan } from "../../src/core/planner.ts";
import { localSecondOfDay, resolveZone } from "../../src/core/timezone.ts";
import { d } from "../helpers.ts";

const zone = resolveZone("Europe/Madrid");
const time = { start: 9 * 3600, end: 18 * 3600 };

function plan(today = d("2024-12-31"), nowSecondOfDay = 0) {
    return buildPlan({
        from: d("2024-03-25"),
        to: d("2024-04-05"),
        seed: "commits",
        fill: "all",
        schedule: {
            commits: { min: 1, max: 6 },
            distribution: "uniform",
            frequency: 100,
            weekdays: new Set([0, 1, 2, 3, 4, 5, 6]),
            weights: [1, 1, 1, 1, 1, 1, 1],
            exclude: []
        },
        time,
        today,
        nowSecondOfDay,
        allowFuture: false
    });
}

describe("generateCommits", () => {
    it("creates one commit per planned unit, in chronological order", () => {
        const p = plan();
        const commits = [...generateCommits(p, { zone, time, message: "m" })];
        expect(commits).toHaveLength(p.total);
        for (let i = 1; i < commits.length; i++) {
            expect(commits[i]?.instant.epochSeconds).toBeGreaterThanOrEqual(
                commits[i - 1]?.instant.epochSeconds ?? 0
            );
        }
        expect(commits.map((commit) => commit.index)).toEqual(
            Array.from({ length: p.total }, (_, i) => i + 1)
        );
    });

    it("places every commit on its local day, inside the time window (across DST)", () => {
        for (const commit of generateCommits(plan(), { zone, time, message: "m" })) {
            const { epochSeconds, offsetMinutes } = commit.instant;
            expect(Math.floor((epochSeconds + offsetMinutes * 60) / 86_400)).toBe(commit.day);
            const second = localSecondOfDay(epochSeconds * 1000, zone);
            expect(second).toBeGreaterThanOrEqual(time.start - 3600);
            expect(second).toBeLessThan(time.end + 3600);
        }
    });

    it("renders message templates", () => {
        const p = plan();
        const [first] = generateCommits(p, {
            zone,
            time,
            message: "{date} {n}/{count} #{i} of {total} ({weekday})"
        });
        expect(first?.message).toBe(`2024-03-25 1/${first?.count} #1 of ${p.total} (Monday)`);
    });

    it("picks messages from a list deterministically", () => {
        const messages = ["one", "two", "three"];
        const a = [...generateCommits(plan(), { zone, time, message: "x", messages })];
        const b = [...generateCommits(plan(), { zone, time, message: "x", messages })];
        expect(a.map((commit) => commit.message)).toEqual(b.map((commit) => commit.message));
        expect(new Set(a.map((commit) => commit.message)).size).toBeGreaterThan(1);
    });

    it("keeps today's commits before the current time", () => {
        const today = d("2024-04-05");
        const now = 11 * 3600;
        const p = plan(today, now);
        const todays = [...generateCommits(p, { zone, time, message: "m" })].filter(
            (commit) => commit.day === today
        );
        expect(todays.length).toBeGreaterThan(0);
        for (const commit of todays) {
            expect(localSecondOfDay(commit.instant.epochSeconds * 1000, zone)).toBeLessThan(now);
            expect(formatDay(commit.day)).toBe("2024-04-05");
        }
    });
});
