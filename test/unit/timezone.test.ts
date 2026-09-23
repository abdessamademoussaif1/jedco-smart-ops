import { describe, expect, it } from "vitest";
import { MS_PER_DAY } from "../../src/core/dates.ts";
import {
    formatInstant,
    formatOffset,
    localDayOf,
    localSecondOfDay,
    localToInstant,
    resolveZone
} from "../../src/core/timezone.ts";
import { InvalidValueError } from "../../src/errors.ts";
import { d } from "../helpers.ts";

describe("resolveZone", () => {
    it("supports UTC and fixed offsets", () => {
        expect(resolveZone("UTC").offsetAt(0)).toBe(0);
        expect(resolveZone("utc").name).toBe("UTC");
        expect(resolveZone("+05:30").offsetAt(0)).toBe(330);
        expect(resolveZone("+05:30").name).toBe("+05:30");
        expect(resolveZone("-0800").offsetAt(0)).toBe(-480);
        expect(resolveZone("UTC+2").offsetAt(0)).toBe(120);
        expect(resolveZone("GMT-3").offsetAt(0)).toBe(-180);
    });

    it("rejects offsets out of range", () => {
        expect(() => resolveZone("+15:00")).toThrow(InvalidValueError);
        expect(() => resolveZone("+14:30")).toThrow(InvalidValueError);
    });

    it("canonicalizes IANA names and rejects unknown ones", () => {
        expect(resolveZone("america/new_york").name).toBe("America/New_York");
        expect(() => resolveZone("Mars/Olympus_Mons")).toThrow(/unknown time zone/);
    });

    it("falls back to the system time zone", () => {
        expect(resolveZone().name.length).toBeGreaterThan(0);
        expect(resolveZone("  ").name).toBe(resolveZone().name);
    });

    it("computes offsets with daylight saving time", () => {
        const newYork = resolveZone("America/New_York");
        expect(newYork.offsetAt(Date.UTC(2024, 0, 15, 12))).toBe(-300);
        expect(newYork.offsetAt(Date.UTC(2024, 6, 15, 12))).toBe(-240);
        expect(resolveZone("Asia/Kolkata").offsetAt(Date.UTC(2024, 0, 1))).toBe(330);
        expect(resolveZone("Asia/Kathmandu").offsetAt(Date.UTC(2024, 0, 1))).toBe(345);
    });
});

describe("localToInstant", () => {
    it("converts local wall-clock time to an instant", () => {
        const zone = resolveZone("America/New_York");
        const instant = localToInstant(d("2024-06-01"), 12 * 3600, zone);
        expect(instant.offsetMinutes).toBe(-240);
        expect(formatInstant(instant)).toBe("2024-06-01T12:00:00-04:00");
    });

    it("keeps times inside a DST gap on the same day", () => {
        const zone = resolveZone("America/New_York");
        const day = d("2024-03-10");
        const instant = localToInstant(day, 2 * 3600 + 30 * 60, zone); // 02:30 doesn't exist
        const localDay = Math.floor((instant.epochSeconds + instant.offsetMinutes * 60) / 86_400);
        expect(localDay).toBe(day);
        expect(zone.offsetAt(instant.epochSeconds * 1000)).toBe(instant.offsetMinutes);
    });

    it("always lands on the requested local day, in any zone", () => {
        const zones = [
            "America/New_York",
            "Europe/Madrid",
            "America/Santiago",
            "Australia/Lord_Howe",
            "Pacific/Chatham",
            "Asia/Tokyo",
            "Asia/Kathmandu",
            "America/Mexico_City",
            "UTC",
            "+05:45",
            "-09:30"
        ].map((name) => resolveZone(name));
        const days = [];
        for (let day = d("2023-01-01"); day <= d("2024-12-31"); day += 3) days.push(day);
        const seconds = [0, 1, 3600, 2 * 3600 + 30 * 60, 43_200, 86_399];

        for (const zone of zones) {
            for (const day of days) {
                for (const second of seconds) {
                    const { epochSeconds, offsetMinutes } = localToInstant(day, second, zone);
                    const localDay = Math.floor((epochSeconds + offsetMinutes * 60) / 86_400);
                    expect(localDay, `${zone.name} ${day} ${second}`).toBe(day);
                    expect(zone.offsetAt(epochSeconds * 1000)).toBe(offsetMinutes);
                }
            }
        }
    });

    it("preserves the exact wall-clock time outside DST transitions", () => {
        const zone = resolveZone("Europe/Madrid");
        for (const second of [0, 3661, 50_000, 86_399]) {
            const instant = localToInstant(d("2024-02-10"), second, zone);
            expect(localSecondOfDay(instant.epochSeconds * 1000, zone)).toBe(second);
        }
    });
});

describe("helpers", () => {
    it("formats offsets for git and ISO 8601", () => {
        expect(formatOffset(330, "git")).toBe("+0530");
        expect(formatOffset(-480, "iso")).toBe("-08:00");
        expect(formatOffset(0, "git")).toBe("+0000");
        expect(formatOffset(-570, "git")).toBe("-0930");
    });

    it("finds the local day of an instant", () => {
        const tokyo = resolveZone("Asia/Tokyo");
        // 2024-01-01T20:00Z is already Jan 2 in Tokyo (+09:00).
        expect(localDayOf(Date.UTC(2024, 0, 1, 20), tokyo)).toBe(d("2024-01-02"));
        expect(localDayOf(d("2024-01-01") * MS_PER_DAY, resolveZone("UTC"))).toBe(d("2024-01-01"));
    });
});
