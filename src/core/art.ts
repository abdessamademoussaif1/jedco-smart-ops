import { InvalidValueError } from "../errors.ts";
import { type Day, endOfYear, formatDay, startOfWeek, startOfYear, weekdayOf } from "./dates.ts";
import { FONT_HEIGHT, GLYPHS, glyphKey, stripInvisible, supportedCharacters } from "./font.ts";

/** A drawing for the contribution graph: 7 rows (Sunday → Saturday) of levels 0–4. */
export interface ArtGrid {
    readonly width: number;
    readonly rows: readonly (readonly number[])[];
}

export const GRAPH_ROWS = 7;
export const MAX_LEVEL = 4;
/** Maximum width of a pattern file, in weeks (≈ 10 years). */
const MAX_PATTERN_WIDTH = 530;

function emptyRows(width: number): number[][] {
    return Array.from({ length: GRAPH_ROWS }, () => Array.from({ length: width }, () => 0));
}

/** Renders text with the built-in 5-pixel font (rows Monday → Friday). */
export function textToGrid(text: string): ArtGrid {
    const characters = [...stripInvisible(text).trim()];
    if (characters.length === 0) throw new InvalidValueError("the text is empty");

    const glyphs = characters.map((char) => {
        const glyph = GLYPHS.get(glyphKey(char));
        if (!glyph) {
            throw new InvalidValueError(
                `the character "${char}" isn't supported. Supported: A-Z 0-9 and ${supportedCharacters().replace(/[A-Z0-9]/g, "")}`
            );
        }
        return glyph;
    });

    const width =
        glyphs.reduce((total, glyph) => total + (glyph[0]?.length ?? 0), 0) + glyphs.length - 1;
    const rows = emptyRows(width);
    const top = Math.floor((GRAPH_ROWS - FONT_HEIGHT) / 2);
    let column = 0;
    for (const glyph of glyphs) {
        const glyphWidth = glyph[0]?.length ?? 0;
        glyph.forEach((pixels, rowIndex) => {
            pixels.forEach((lit, columnIndex) => {
                if (lit) (rows[top + rowIndex] as number[])[column + columnIndex] = MAX_LEVEL;
            });
        });
        column += glyphWidth + 1;
    }
    return { width, rows };
}

/**
 * Parses a pattern file: up to 7 lines (Sunday → Saturday), one character per week.
 * `.`, space or `0` = empty, `1`–`4` = intensity level, any other character = level 4.
 * Fewer than 7 lines are centered vertically.
 */
export function parsePattern(source: string): ArtGrid {
    const lines = source.replace(/\r/g, "").split("\n");
    while (lines.length > 0 && (lines[0] ?? "").trim() === "") lines.shift();
    while (lines.length > 0 && (lines[lines.length - 1] ?? "").trim() === "") lines.pop();

    if (lines.length === 0) throw new InvalidValueError("the pattern is empty");
    if (lines.length > GRAPH_ROWS) {
        throw new InvalidValueError(
            `the pattern has ${lines.length} lines but the graph only has ${GRAPH_ROWS} rows (Sunday → Saturday)`
        );
    }
    if (lines.some((line) => line.includes("\t"))) {
        throw new InvalidValueError(
            "the pattern contains tabs; use spaces or dots for empty squares"
        );
    }

    const width = Math.max(...lines.map((line) => [...line.replace(/\s+$/, "")].length));
    if (width === 0) throw new InvalidValueError("the pattern is empty");
    if (width > MAX_PATTERN_WIDTH) {
        throw new InvalidValueError(
            `the pattern is ${width} columns wide (max ${MAX_PATTERN_WIDTH})`
        );
    }

    const rows = emptyRows(width);
    const top = Math.floor((GRAPH_ROWS - lines.length) / 2);
    let lit = 0;
    lines.forEach((line, lineIndex) => {
        [...line].forEach((char, column) => {
            if (column >= width) return;
            let level: number;
            if (char === " " || char === "." || char === "0") level = 0;
            else if (char >= "1" && char <= "4") level = Number(char);
            else level = MAX_LEVEL;
            if (level > 0) lit++;
            (rows[top + lineIndex] as number[])[column] = level;
        });
    });
    if (lit === 0) throw new InvalidValueError("the pattern has no filled squares");
    return { width, rows };
}

/** Full weeks available to draw on: from a Sunday to a Saturday. */
export interface ArtWindow {
    readonly first: Day;
    readonly last: Day;
    readonly weeks: number;
}

function windowFrom(first: Day, last: Day): ArtWindow {
    const weeks = last >= first ? Math.floor((last - first + 1) / 7) : 0;
    return { first, last: first + weeks * 7 - 1, weeks };
}

/** First Sunday on/after `from` → last Saturday on/before `to`. */
export function rangeArtWindow(from: Day, to: Day): ArtWindow {
    const first = from + ((7 - weekdayOf(from)) % 7);
    const last = to - ((weekdayOf(to) + 1) % 7);
    return windowFrom(first, last);
}

/**
 * The 52 full weeks shown on a GitHub profile by default ("last year" view),
 * excluding the current, incomplete week.
 */
export function rollingArtWindow(today: Day): ArtWindow {
    const currentWeek = startOfWeek(today);
    return windowFrom(currentWeek - 52 * 7, currentWeek - 1);
}

/** Full weeks inside a calendar year, capped at `lastAllowed` (usually today). */
export function yearArtWindow(year: number, lastAllowed: Day): ArtWindow {
    return rangeArtWindow(startOfYear(year), Math.min(endOfYear(year), lastAllowed));
}

export type ArtAlign = "center" | "start";

/** Maps every lit pixel of the grid to a day inside the window. */
export function placeArt(grid: ArtGrid, window: ArtWindow, align: ArtAlign): Map<Day, number> {
    if (grid.width > window.weeks) {
        throw new InvalidValueError(
            `the drawing needs ${grid.width} weeks but only ${window.weeks} full weeks are available between ${formatDay(window.first)} and ${formatDay(window.last)}. Use a shorter text or a longer date range`
        );
    }
    const offset = align === "center" ? Math.floor((window.weeks - grid.width) / 2) : 0;
    const levels = new Map<Day, number>();
    grid.rows.forEach((row, weekday) => {
        row.forEach((level, column) => {
            levels.set(window.first + (offset + column) * 7 + weekday, level);
        });
    });
    return levels;
}

/** Commits for a pixel: level 4 gets `intensity` commits, lower levels proportionally less. */
export function levelToCommits(level: number, intensity: number): number {
    if (level <= 0) return 0;
    return Math.max(1, Math.round((intensity * level) / MAX_LEVEL));
}
