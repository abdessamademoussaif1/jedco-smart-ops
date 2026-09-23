import { type DateRange, type Day, formatDay, isInRanges, weekdayOf } from "./dates.ts";
import { type CountRange, formatClock, type TimeWindow } from "./parse.ts";
import { createRng, type Distribution, sampleCount } from "./random.ts";

export type FillMode = "all" | "gaps" | "top-up";

export interface Schedule {
    commits: CountRange;
    distribution: Distribution;
    /** Percentage (0–100) of eligible days that get commits. */
    frequency: number;
    /** Days of the week that can get commits (0 = Sunday). */
    weekdays: ReadonlySet<number>;
    /** Multiplies the frequency on each day of the week (index 0 = Sunday). */
    weights: readonly number[];
    exclude: readonly DateRange[];
}

export interface PlanInput {
    from: Day;
    to: Day;
    seed: string;
    fill: FillMode;
    /** How days and amounts are chosen. Ignored when `art` is set. */
    schedule: Schedule;
    /** Target commits per day for drawings (text or pattern). */
    art?: ReadonlyMap<Day, number> | undefined;
    /** Contributions already on the user's graph (used by the `gaps` and `top-up` modes). */
    existing?: ReadonlyMap<Day, number> | undefined;
    time: TimeWindow;
    today: Day;
    /** Seconds elapsed today in the target time zone; commits are never placed in the future. */
    nowSecondOfDay: number;
    allowFuture: boolean;
}

export interface PlannedDay {
    day: Day;
    /** Commits that will be created. */
    count: number;
    /** What the schedule or drawing asked for, before looking at existing contributions. */
    target: number;
    /** Contributions that already exist that day (0 when unknown). */
    existing: number;
}

export interface Plan {
    from: Day;
    to: Day;
    seed: string;
    today: Day;
    days: PlannedDay[];
    total: number;
    /** End of today's time window (seconds) when it's cut short by the current time. */
    todayWindowEnd: number | null;
    notes: string[];
}

/**
 * Decides how many commits each day gets. This is a pure function: the same input
 * (including the seed) always produces the same plan, so a preview is exactly what
 * a real run will create. Every day draws from its own random stream, so changing
 * the date range never changes the days that stay in it.
 */
export function buildPlan(input: PlanInput): Plan {
    const { schedule } = input;
    const days: PlannedDay[] = [];
    const notes: string[] = [];
    let total = 0;
    let todayWindowEnd: number | null = null;

    for (let day = input.from; day <= input.to; day++) {
        let target = 0;
        if (input.art) {
            target = input.art.get(day) ?? 0;
        } else {
            const weekday = weekdayOf(day);
            if (schedule.weekdays.has(weekday) && !isInRanges(day, schedule.exclude)) {
                const rng = createRng(input.seed, `day:${day}`);
                const weight = schedule.weights[weekday] ?? 1;
                const probability = Math.min(1, (schedule.frequency / 100) * weight);
                const roll = rng.next();
                const amount = sampleCount(
                    rng,
                    schedule.commits.min,
                    schedule.commits.max,
                    schedule.distribution
                );
                if (roll < probability) target = amount;
            }
        }

        const existing = input.existing?.get(day) ?? 0;
        let count = target;
        if (input.fill === "gaps") count = existing > 0 ? 0 : target;
        else if (input.fill === "top-up") count = Math.max(0, target - existing);

        if (day === input.today && !input.allowFuture && count > 0) {
            const end = Math.min(input.time.end, input.nowSecondOfDay);
            if (end <= input.time.start) {
                notes.push(
                    `Today (${formatDay(day)}) was skipped: its time window starts at ${formatClock(input.time.start)} and commits are never dated in the future.`
                );
                count = 0;
            } else if (end < input.time.end) {
                todayWindowEnd = end;
            }
        }

        days.push({ day, count, target, existing });
        total += count;
    }

    return {
        from: input.from,
        to: input.to,
        seed: input.seed,
        today: input.today,
        days,
        total,
        todayWindowEnd,
        notes
    };
}
