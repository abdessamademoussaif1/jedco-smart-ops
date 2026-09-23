import { describe, expect, it } from "vitest";
import {
    levelToCommits,
    parsePattern,
    placeArt,
    rangeArtWindow,
    rollingArtWindow,
    textToGrid,
    yearArtWindow
} from "../../src/core/art.ts";
import { formatDay } from "../../src/core/dates.ts";
import { GLYPHS } from "../../src/core/font.ts";
import { d } from "../helpers.ts";

describe("font", () => {
    it("has 5 rows of equal width for every glyph", () => {
        for (const [char, glyph] of GLYPHS) {
            expect(glyph, char).toHaveLength(5);
            const width = glyph[0]?.length ?? 0;
            for (const row of glyph) expect(row, char).toHaveLength(width);
        }
    });
});

describe("textToGrid", () => {
    it("draws text between Monday and Friday with one column of spacing", () => {
        const grid = textToGrid("HI");
        expect(grid.width).toBe(8);
        expect(grid.rows).toHaveLength(7);
        expect(grid.rows[0]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
        expect(grid.rows[6]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
        expect(grid.rows[1]).toEqual([4, 0, 0, 4, 0, 4, 4, 4]);
        expect(grid.rows[3]).toEqual([4, 4, 4, 4, 0, 0, 4, 0]);
    });

    it("is case-insensitive and supports symbols and emoji hearts", () => {
        expect(textToGrid("hi")).toEqual(textToGrid("HI"));
        expect(textToGrid("I ❤️ GIT").width).toBeGreaterThan(10);
        expect(textToGrid("<3").width).toBeGreaterThan(0);
    });

    it("rejects unsupported characters and empty text", () => {
        expect(() => textToGrid("€uro")).toThrow(/isn't supported/);
        expect(() => textToGrid("   ")).toThrow(/empty/);
    });
});

describe("parsePattern", () => {
    it("centers short patterns vertically", () => {
        const grid = parsePattern("#.#\n.#.\n");
        expect(grid.width).toBe(3);
        expect(grid.rows[2]).toEqual([4, 0, 4]);
        expect(grid.rows[3]).toEqual([0, 4, 0]);
        expect(grid.rows[0]).toEqual([0, 0, 0]);
    });

    it("reads intensity levels and trims blank lines", () => {
        const grid = parsePattern("\n\n1234\r\n0 X.\n\n");
        expect(grid.rows[2]).toEqual([1, 2, 3, 4]);
        expect(grid.rows[3]).toEqual([0, 0, 4, 0]);
    });

    it("rejects invalid patterns", () => {
        expect(() => parsePattern("#\n#\n#\n#\n#\n#\n#\n#")).toThrow(/only has 7 rows/);
        expect(() => parsePattern("#\t#")).toThrow(/tabs/);
        expect(() => parsePattern("...\n...")).toThrow(/no filled squares/);
        expect(() => parsePattern("\n \n")).toThrow(/empty/);
    });
});

describe("art windows", () => {
    it("uses full weeks inside a range", () => {
        const window = rangeArtWindow(d("2024-01-01"), d("2024-01-31"));
        expect(formatDay(window.first)).toBe("2024-01-07");
        expect(formatDay(window.last)).toBe("2024-01-27");
        expect(window.weeks).toBe(3);
    });

    it("matches the 52 full weeks of a profile", () => {
        const window = rollingArtWindow(d("2024-06-12"));
        expect(formatDay(window.first)).toBe("2023-06-11");
        expect(formatDay(window.last)).toBe("2024-06-08");
        expect(window.weeks).toBe(52);
    });

    it("fits inside a calendar year and never passes today", () => {
        const full = yearArtWindow(2023, d("2030-01-01"));
        expect(formatDay(full.first)).toBe("2023-01-01");
        expect(formatDay(full.last)).toBe("2023-12-30");
        expect(full.weeks).toBe(52);
        const partial = yearArtWindow(2024, d("2024-03-01"));
        expect(partial.last).toBeLessThanOrEqual(d("2024-03-01"));
    });
});

describe("placeArt", () => {
    it("centers the drawing and maps pixels to days", () => {
        const window = rollingArtWindow(d("2024-06-12"));
        const levels = placeArt(textToGrid("HI"), window, "center");
        const offset = Math.floor((52 - 8) / 2);
        expect(levels.get(window.first + offset * 7 + 1)).toBe(4);
        expect(levels.get(window.first + offset * 7)).toBe(0);
        expect(levels.size).toBe(8 * 7);
    });

    it("aligns to the start when asked", () => {
        const window = rangeArtWindow(d("2024-01-01"), d("2024-12-31"));
        const levels = placeArt(parsePattern("#"), window, "start");
        expect(levels.get(window.first + 3)).toBe(4);
    });

    it("refuses drawings that don't fit", () => {
        const window = rangeArtWindow(d("2024-01-01"), d("2024-01-31"));
        expect(() => placeArt(textToGrid("HELLO"), window, "center")).toThrow(/needs \d+ weeks/);
    });

    it("converts levels to commits", () => {
        expect(levelToCommits(4, 12)).toBe(12);
        expect(levelToCommits(1, 12)).toBe(3);
        expect(levelToCommits(1, 2)).toBe(1);
        expect(levelToCommits(0, 12)).toBe(0);
    });
});
