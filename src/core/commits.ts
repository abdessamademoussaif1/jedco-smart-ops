import { type Day, formatDay, pad2, WEEKDAY_NAMES, weekdayOf, ymdFromDay } from "./dates.ts";
import { renderTemplate } from "./messages.ts";
import type { TimeWindow } from "./parse.ts";
import type { Plan } from "./planner.ts";
import { createRng } from "./random.ts";
import {
    formatInstant,
    formatLocalTime,
    type Instant,
    localToInstant,
    type Zone
} from "./timezone.ts";

export interface CommitSpec {
    /** 1-based position in the whole plan. */
    index: number;
    day: Day;
    /** 1-based position within its day. */
    n: number;
    /** Commits on that day. */
    count: number;
    instant: Instant;
    message: string;
}

export interface CommitOptions {
    zone: Zone;
    time: TimeWindow;
    /** Message template, used when `messages` is empty. */
    message: string;
    /** Messages to pick from at random (from --messages-file). */
    messages?: readonly string[] | undefined;
}

/**
 * Expands a plan into individual commits, in chronological order. Times are random
 * inside the time window (deterministic for the plan's seed) and sorted per day.
 */
export function* generateCommits(plan: Plan, options: CommitOptions): Generator<CommitSpec> {
    const messages = options.messages && options.messages.length > 0 ? options.messages : undefined;
    let index = 0;

    for (const { day, count } of plan.days) {
        if (count === 0) continue;

        const timeRng = createRng(plan.seed, `time:${day}`);
        const messageRng = createRng(plan.seed, `message:${day}`);
        const end =
            day === plan.today && plan.todayWindowEnd !== null
                ? plan.todayWindowEnd
                : options.time.end;
        const seconds = Array.from({ length: count }, () =>
            timeRng.int(options.time.start, end - 1)
        ).sort((a, b) => a - b);

        const { year, month, day: dayOfMonth } = ymdFromDay(day);
        const date = formatDay(day);
        const weekday = WEEKDAY_NAMES[weekdayOf(day)] ?? "";

        for (let n = 1; n <= count; n++) {
            index++;
            const instant = localToInstant(day, seconds[n - 1] ?? options.time.start, options.zone);
            const template = messages ? messageRng.pick(messages) : options.message;
            const message = renderTemplate(template, {
                date,
                time: formatLocalTime(instant),
                datetime: formatInstant(instant),
                n,
                count,
                i: index,
                total: plan.total,
                weekday,
                year,
                month: pad2(month),
                day: pad2(dayOfMonth)
            });
            yield { index, day, n, count, instant, message };
        }
    }
}
