import { InvalidValueError } from "../errors.ts";
import { WEEKDAY_KEYS } from "./dates.ts";

export const MAX_COMMITS_PER_DAY = 1000;

export interface CountRange {
    min: number;
    max: number;
}

/** Parses `5`, `"5"`, `"1-10"`, `"1..10"` or `{ min, max }` into a commit range. */
export function parseCountRange(input: number | string | { min: number; max: number }): CountRange {
    let min: number;
    let max: number;
    if (typeof input === "number") {
        min = input;
        max = input;
    } else if (typeof input === "string") {
        const match = /^\s*(\d+)\s*(?:(?:-|\.\.)\s*(\d+)\s*)?$/.exec(input);
        if (!match) {
            throw new InvalidValueError(
                `"${input}" is not a valid amount. Use a number (5) or a range (1-10)`
            );
        }
        min = Number(match[1]);
        max = match[2] === undefined ? min : Number(match[2]);
    } else {
        min = input.min;
        max = input.max;
    }

    if (!Number.isInteger(min) || !Number.isInteger(max)) {
        throw new InvalidValueError("amounts must be whole numbers");
    }
    if (min < 0) throw new InvalidValueError("the minimum can't be negative");
    if (max < min)
        throw new InvalidValueError(`the minimum (${min}) is greater than the maximum (${max})`);
    if (max < 1) throw new InvalidValueError("the maximum must be at least 1");
    if (max > MAX_COMMITS_PER_DAY) {
        throw new InvalidValueError(`at most ${MAX_COMMITS_PER_DAY} commits per day are allowed`);
    }
    return { min, max };
}

/** Parses a percentage between 0 and 100 (`80`, `"80"`, `"80%"`). */
export function parsePercentage(input: number | string): number {
    const value = typeof input === "number" ? input : Number(input.trim().replace(/%$/, ""));
    if (!Number.isFinite(value) || value < 0 || value > 100) {
        throw new InvalidValueError(`"${input}" must be a number between 0 and 100`);
    }
    return value;
}

/** Parses a positive integer (used by --max-commits, --intensity…). */
export function parsePositiveInt(input: number | string, max = Number.MAX_SAFE_INTEGER): number {
    const value = typeof input === "number" ? input : Number(input.trim().replace(/[_,]/g, ""));
    if (!Number.isInteger(value) || value < 1 || value > max) {
        throw new InvalidValueError(`"${input}" must be a whole number between 1 and ${max}`);
    }
    return value;
}

const DAY_ALIASES: Readonly<Record<string, number>> = {
    sun: 0,
    sunday: 0,
    mon: 1,
    monday: 1,
    tue: 2,
    tues: 2,
    tuesday: 2,
    wed: 3,
    wednesday: 3,
    thu: 4,
    thur: 4,
    thurs: 4,
    thursday: 4,
    fri: 5,
    friday: 5,
    sat: 6,
    saturday: 6
};

const DAY_GROUPS: Readonly<Record<string, readonly number[]>> = {
    all: [0, 1, 2, 3, 4, 5, 6],
    every: [0, 1, 2, 3, 4, 5, 6],
    everyday: [0, 1, 2, 3, 4, 5, 6],
    weekdays: [1, 2, 3, 4, 5],
    workdays: [1, 2, 3, 4, 5],
    weekends: [0, 6],
    weekend: [0, 6]
};

function parseDayName(token: string): number {
    const value = DAY_ALIASES[token];
    if (value === undefined) {
        throw new InvalidValueError(
            `"${token}" is not a day. Use sun, mon, tue, wed, thu, fri, sat, weekdays, weekends or all`
        );
    }
    return value;
}

function tokenize(input: string | readonly string[]): string[] {
    return (typeof input === "string" ? [input] : input)
        .flatMap((item) => item.split(/[,\s]+/))
        .map((item) => item.trim().toLowerCase())
        .filter((item) => item.length > 0);
}

/**
 * Parses which days of the week get commits: `all`, `weekdays`, `weekends`,
 * lists (`mon,wed,fri`) and ranges (`mon-fri`, `fri-mon` wraps around).
 */
export function parseWeekdays(input: string | readonly string[]): Set<number> {
    const tokens = tokenize(input);
    if (tokens.length === 0) throw new InvalidValueError("select at least one day of the week");
    const days = new Set<number>();
    for (const token of tokens) {
        const group = DAY_GROUPS[token];
        if (group) {
            for (const day of group) days.add(day);
            continue;
        }
        const range = /^([a-z]+)-([a-z]+)$/.exec(token);
        if (range) {
            const start = parseDayName(range[1] ?? "");
            const end = parseDayName(range[2] ?? "");
            for (let day = start; ; day = (day + 1) % 7) {
                days.add(day);
                if (day === end) break;
            }
            continue;
        }
        days.add(parseDayName(token));
    }
    return days;
}

/**
 * Parses per-weekday weights that scale the chance of committing on that day:
 * `"sat=0.3,sun=0.2"`, `"weekends=0.5"` or `{ sat: 0.3 }`. Unlisted days keep 1.
 */
export function parseWeights(input: string | Readonly<Record<string, number>>): number[] {
    const weights = [1, 1, 1, 1, 1, 1, 1];
    const entries: Array<[string, number | string]> =
        typeof input === "string"
            ? tokenize(input).map((token) => {
                  const [key = "", value, ...rest] = token.split(/[=:]/);
                  if (value === undefined || rest.length > 0) {
                      throw new InvalidValueError(
                          `"${token}" is not a valid weight. Use day=value, e.g. sat=0.3`
                      );
                  }
                  return [key, value];
              })
            : Object.entries(input);

    for (const [rawKey, rawValue] of entries) {
        const key = rawKey.trim().toLowerCase();
        const value = typeof rawValue === "number" ? rawValue : Number(rawValue);
        if (!Number.isFinite(value) || value < 0) {
            throw new InvalidValueError(`the weight for "${key}" must be a number ≥ 0`);
        }
        const days = DAY_GROUPS[key] ?? [parseDayName(key)];
        for (const day of days) weights[day] = value;
    }
    return weights;
}

export function describeWeekdays(days: ReadonlySet<number>): string {
    const sorted = [...days].sort((a, b) => a - b);
    if (sorted.length === 7) return "every day";
    if (sorted.join() === "1,2,3,4,5") return "weekdays";
    if (sorted.join() === "0,6") return "weekends";
    return sorted.map((day) => WEEKDAY_KEYS[day]).join(", ");
}

export interface TimeWindow {
    /** Seconds since local midnight (inclusive). */
    start: number;
    /** Seconds since local midnight (exclusive). */
    end: number;
}

function parseClock(hoursText: string, minutesText: string | undefined, input: string): number {
    const hours = Number(hoursText);
    const minutes = Number(minutesText ?? "0");
    if (hours > 24 || minutes > 59 || (hours === 24 && minutes > 0)) {
        throw new InvalidValueError(`"${input}" contains an invalid time`);
    }
    return hours * 3600 + minutes * 60;
}

/** Parses `09:00-18:30` or `9-18` into a local time window. */
export function parseTimeWindow(input: string): TimeWindow {
    const match = /^\s*(\d{1,2})(?::(\d{2}))?\s*-\s*(\d{1,2})(?::(\d{2}))?\s*$/.exec(input);
    if (!match) {
        throw new InvalidValueError(
            `"${input}" is not a valid time window. Use HH:MM-HH:MM, e.g. 09:00-18:00`
        );
    }
    const start = parseClock(match[1] ?? "", match[2], input);
    const end = parseClock(match[3] ?? "", match[4], input);
    if (start >= 86_400) throw new InvalidValueError(`"${input}" starts at or after midnight`);
    if (end <= start) throw new InvalidValueError(`"${input}" must end after it starts`);
    return { start, end };
}

export function formatClock(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
}

/** Splits a comma/space separated list (or passes through an array), trimming empties. */
export function parseList(input: string | readonly string[]): string[] {
    return (typeof input === "string" ? [input] : input)
        .flatMap((item) => item.split(","))
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
}
