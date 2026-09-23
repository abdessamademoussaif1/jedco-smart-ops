import { InvalidValueError } from "../errors.ts";

/**
 * Calendar days are represented as integers: the number of days since 1970-01-01.
 * They carry no time zone, which keeps date arithmetic exact and DST-proof.
 */
export type Day = number;

export const MS_PER_DAY = 86_400_000;
export const SECONDS_PER_DAY = 86_400;

export const MIN_YEAR = 1970;
export const MAX_YEAR = 2099;

export const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export const WEEKDAY_NAMES = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday"
] as const;
export const MONTH_NAMES = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec"
] as const;

export interface Ymd {
    year: number;
    month: number;
    day: number;
}

export type DateRange = readonly [start: Day, end: Day];

export function pad2(value: number): string {
    return value.toString().padStart(2, "0");
}

export function dayFromYmd(year: number, month: number, day: number): Day {
    return Math.floor(Date.UTC(year, month - 1, day) / MS_PER_DAY);
}

export function ymdFromDay(value: Day): Ymd {
    const date = new Date(value * MS_PER_DAY);
    return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

/** Formats a day as `YYYY-MM-DD`. */
export function formatDay(value: Day): string {
    const { year, month, day } = ymdFromDay(value);
    return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** 0 = Sunday … 6 = Saturday (1970-01-01 was a Thursday). */
export function weekdayOf(value: Day): number {
    return (((value + 4) % 7) + 7) % 7;
}

export function daysInMonth(year: number, month: number): number {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isValidYmd(year: number, month: number, day: number): boolean {
    return (
        Number.isInteger(year) &&
        Number.isInteger(month) &&
        Number.isInteger(day) &&
        month >= 1 &&
        month <= 12 &&
        day >= 1 &&
        day <= daysInMonth(year, month)
    );
}

/** Adds calendar months, clamping the day of month (Mar 31 − 1 month = Feb 28/29). */
export function addMonths(value: Day, months: number): Day {
    const { year, month, day } = ymdFromDay(value);
    const total = year * 12 + (month - 1) + months;
    const targetYear = Math.floor(total / 12);
    const targetMonth = (((total % 12) + 12) % 12) + 1;
    return dayFromYmd(targetYear, targetMonth, Math.min(day, daysInMonth(targetYear, targetMonth)));
}

/** The Sunday that starts the week containing `value` (GitHub weeks start on Sunday). */
export function startOfWeek(value: Day): Day {
    return value - weekdayOf(value);
}

export function startOfYear(year: number): Day {
    return dayFromYmd(year, 1, 1);
}

export function endOfYear(year: number): Day {
    return dayFromYmd(year, 12, 31);
}

function checkYear(year: number, input: string): void {
    if (year < MIN_YEAR || year > MAX_YEAR) {
        throw new InvalidValueError(
            `"${input}" is out of range: years must be between ${MIN_YEAR} and ${MAX_YEAR}`
        );
    }
}

export type DateRole = "start" | "end";

const RELATIVE_RE = /^(\d{1,4})\s*(d|days?|w|weeks?|m|months?|y|years?)(?:\s+ago)?$/;

/**
 * Parses a user supplied date. `role` decides how partial dates expand:
 * `2024-03` is the 1st of March as a start and the 31st as an end.
 *
 * Accepted forms: `YYYY-MM-DD`, `YYYY-MM`, `YYYY`, `today`, `yesterday` and
 * relative values such as `30d`, `12w`, `6m` or `1y` (meaning "ago").
 */
export function parseDateInput(input: string | number, role: DateRole, today: Day): Day {
    const raw = String(input).trim();
    const text = raw.toLowerCase();
    if (text === "") throw new InvalidValueError("the date is empty");
    if (text === "today") return today;
    if (text === "yesterday") return today - 1;

    let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
    if (match) {
        const year = Number(match[1]);
        const month = Number(match[2]);
        const day = Number(match[3]);
        checkYear(year, raw);
        if (!isValidYmd(year, month, day)) {
            throw new InvalidValueError(`"${raw}" is not a real calendar date`);
        }
        return dayFromYmd(year, month, day);
    }

    match = /^(\d{4})-(\d{1,2})$/.exec(text);
    if (match) {
        const year = Number(match[1]);
        const month = Number(match[2]);
        checkYear(year, raw);
        if (month < 1 || month > 12) throw new InvalidValueError(`"${raw}" has an invalid month`);
        return role === "start"
            ? dayFromYmd(year, month, 1)
            : dayFromYmd(year, month, daysInMonth(year, month));
    }

    match = /^(\d{4})$/.exec(text);
    if (match) {
        const year = Number(match[1]);
        checkYear(year, raw);
        return role === "start" ? startOfYear(year) : endOfYear(year);
    }

    match = RELATIVE_RE.exec(text);
    if (match) {
        const amount = Number(match[1]);
        const unit = (match[2] ?? "d").charAt(0);
        switch (unit) {
            case "d":
                return today - amount;
            case "w":
                return today - amount * 7;
            case "m":
                return addMonths(today, -amount);
            default:
                return addMonths(today, -amount * 12);
        }
    }

    throw new InvalidValueError(
        `"${raw}" is not a valid date. Use YYYY-MM-DD, YYYY-MM, YYYY, "today", "yesterday" or a relative value like 30d, 12w, 6m or 1y`
    );
}

/**
 * Parses days to skip: single dates (`2024-12-25`), whole months (`2024-08`)
 * or ranges (`2024-08-01..2024-08-15`). Accepts one string (comma-separated) or a list.
 */
export function parseDateRanges(input: string | readonly string[], today: Day): DateRange[] {
    const entries = (typeof input === "string" ? [input] : input)
        .flatMap((item) => item.split(","))
        .map((item) => item.trim())
        .filter((item) => item.length > 0);

    return entries.map((entry): DateRange => {
        const parts = entry.split("..");
        if (parts.length > 2) {
            throw new InvalidValueError(`"${entry}" is not a valid range. Use START..END`);
        }
        const [first = "", second] = parts;
        const start = parseDateInput(first, "start", today);
        const end = parseDateInput(second ?? first, "end", today);
        if (end < start) {
            throw new InvalidValueError(`"${entry}" ends before it starts`);
        }
        return [start, end];
    });
}

export function isInRanges(value: Day, ranges: readonly DateRange[]): boolean {
    for (const [start, end] of ranges) {
        if (value >= start && value <= end) return true;
    }
    return false;
}
