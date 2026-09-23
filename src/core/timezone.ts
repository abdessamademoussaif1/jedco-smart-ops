import { InvalidValueError } from "../errors.ts";
import { type Day, MS_PER_DAY, pad2, SECONDS_PER_DAY } from "./dates.ts";

/**
 * A time zone that can tell its UTC offset at any instant.
 * GitHub places each commit on the calendar using the offset stored in the
 * commit itself, so getting this right decides which square turns green.
 */
export interface Zone {
    /** IANA name (`Europe/Madrid`), `UTC` or a fixed offset (`+05:30`). */
    readonly name: string;
    /** Minutes east of UTC at the given instant. */
    offsetAt(epochMs: number): number;
    /** The offset of a whole local day, or `null` when it changes during that day (DST). */
    dayOffset(day: Day): number | null;
}

export interface Instant {
    epochSeconds: number;
    offsetMinutes: number;
}

const MAX_OFFSET_MS = 14 * 3_600_000;

class FixedZone implements Zone {
    readonly name: string;
    private readonly offset: number;

    constructor(name: string, offset: number) {
        this.name = name;
        this.offset = offset;
    }

    offsetAt(): number {
        return this.offset;
    }

    dayOffset(): number {
        return this.offset;
    }
}

class IanaZone implements Zone {
    readonly name: string;
    private readonly formatter: Intl.DateTimeFormat;
    private readonly dayCache = new Map<Day, number | null>();

    constructor(name: string, formatter: Intl.DateTimeFormat) {
        this.name = name;
        this.formatter = formatter;
    }

    offsetAt(epochMs: number): number {
        const instant = Math.floor(epochMs / 1000) * 1000;
        const fields: Record<string, number> = {};
        for (const part of this.formatter.formatToParts(instant)) {
            if (part.type !== "literal") fields[part.type] = Number(part.value);
        }
        const hour = fields.hour === 24 ? 0 : (fields.hour ?? 0);
        const asUtc = Date.UTC(
            fields.year ?? 1970,
            (fields.month ?? 1) - 1,
            fields.day ?? 1,
            hour,
            fields.minute ?? 0,
            fields.second ?? 0
        );
        return Math.round((asUtc - instant) / 60_000);
    }

    dayOffset(day: Day): number | null {
        const cached = this.dayCache.get(day);
        if (cached !== undefined) return cached;
        // The local day spans, at most, [start - 14h, end + 14h] in UTC. If the offset is
        // the same at both ends there is no DST transition that day.
        const before = this.offsetAt(day * MS_PER_DAY - MAX_OFFSET_MS);
        const after = this.offsetAt((day + 1) * MS_PER_DAY + MAX_OFFSET_MS);
        const result = before === after ? before : null;
        this.dayCache.set(day, result);
        return result;
    }
}

export function systemTimeZone(): string {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
        return "UTC";
    }
}

const FIXED_OFFSET_RE = /^(?:UTC|GMT)?\s*([+-])(\d{1,2})(?::?(\d{2}))?$/i;

/** Resolves a time zone name or offset. Defaults to the system time zone. */
export function resolveZone(input?: string): Zone {
    const raw = input?.trim() ?? "";
    if (raw === "") return resolveZone(systemTimeZone());

    const upper = raw.toUpperCase();
    if (upper === "UTC" || upper === "GMT" || upper === "Z" || upper === "ETC/UTC") {
        return new FixedZone("UTC", 0);
    }

    const fixed = FIXED_OFFSET_RE.exec(raw);
    if (fixed) {
        const hours = Number(fixed[2]);
        const minutes = Number(fixed[3] ?? "0");
        if (hours > 14 || minutes > 59 || (hours === 14 && minutes > 0)) {
            throw new InvalidValueError(
                `"${raw}" is not a valid UTC offset (range: -14:00 to +14:00)`
            );
        }
        const offset = (fixed[1] === "-" ? -1 : 1) * (hours * 60 + minutes);
        return new FixedZone(formatOffset(offset, "iso"), offset);
    }

    let formatter: Intl.DateTimeFormat;
    try {
        formatter = new Intl.DateTimeFormat("en-US", {
            timeZone: raw,
            hourCycle: "h23",
            year: "numeric",
            month: "numeric",
            day: "numeric",
            hour: "numeric",
            minute: "numeric",
            second: "numeric"
        });
    } catch {
        throw new InvalidValueError(
            `unknown time zone "${raw}". Use an IANA name like "America/Mexico_City" or "Europe/Madrid", "UTC", or an offset like "+05:30"`
        );
    }
    return new IanaZone(formatter.resolvedOptions().timeZone, formatter);
}

/** Converts a local wall-clock time (day + seconds since midnight) into an instant. */
export function localToInstant(day: Day, secondOfDay: number, zone: Zone): Instant {
    const localSeconds = day * SECONDS_PER_DAY + secondOfDay;
    const stable = zone.dayOffset(day);
    if (stable !== null) {
        return { epochSeconds: localSeconds - stable * 60, offsetMinutes: stable };
    }

    // DST transition that day: resolve the offset iteratively.
    const localMs = localSeconds * 1000;
    const guess = zone.offsetAt(localMs);
    let epochMs = localMs - guess * 60_000;
    const corrected = zone.offsetAt(epochMs);
    if (corrected !== guess) epochMs = localMs - corrected * 60_000;

    let offsetMinutes = zone.offsetAt(epochMs);
    // A wall time inside a DST gap can land on the neighbour day; nudge it back.
    const landed = Math.floor((epochMs + offsetMinutes * 60_000) / MS_PER_DAY);
    if (landed !== day) {
        epochMs += (day - landed) * 3_600_000;
        offsetMinutes = zone.offsetAt(epochMs);
    }
    return { epochSeconds: Math.floor(epochMs / 1000), offsetMinutes };
}

/** The local calendar day of an instant. */
export function localDayOf(epochMs: number, zone: Zone): Day {
    return Math.floor((epochMs + zone.offsetAt(epochMs) * 60_000) / MS_PER_DAY);
}

/** Seconds elapsed since local midnight at the given instant. */
export function localSecondOfDay(epochMs: number, zone: Zone): number {
    const localMs = epochMs + zone.offsetAt(epochMs) * 60_000;
    return Math.floor((((localMs % MS_PER_DAY) + MS_PER_DAY) % MS_PER_DAY) / 1000);
}

/** `+0530` (git) or `+05:30` (ISO 8601). */
export function formatOffset(minutes: number, style: "git" | "iso"): string {
    const sign = minutes < 0 ? "-" : "+";
    const abs = Math.abs(minutes);
    const hours = pad2(Math.floor(abs / 60));
    const mins = pad2(abs % 60);
    return style === "git" ? `${sign}${hours}${mins}` : `${sign}${hours}:${mins}`;
}

/** `2024-03-05T14:23:11+01:00` */
export function formatInstant(instant: Instant): string {
    const local = new Date((instant.epochSeconds + instant.offsetMinutes * 60) * 1000);
    const date = `${local.getUTCFullYear()}-${pad2(local.getUTCMonth() + 1)}-${pad2(local.getUTCDate())}`;
    const time = `${pad2(local.getUTCHours())}:${pad2(local.getUTCMinutes())}:${pad2(local.getUTCSeconds())}`;
    return `${date}T${time}${formatOffset(instant.offsetMinutes, "iso")}`;
}

/** `14:23:11` */
export function formatLocalTime(instant: Instant): string {
    const local = new Date((instant.epochSeconds + instant.offsetMinutes * 60) * 1000);
    return `${pad2(local.getUTCHours())}:${pad2(local.getUTCMinutes())}:${pad2(local.getUTCSeconds())}`;
}
