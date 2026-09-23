import {
    type Day,
    endOfYear,
    MONTH_NAMES,
    startOfWeek,
    startOfYear,
    ymdFromDay
} from "../core/dates.ts";

export type ColorDepth = 1 | 4 | 8 | 24;

export interface GraphStyle {
    /** 1 = no colors, 4 = 16 colors, 8 = 256 colors, 24 = true color. */
    colorDepth: ColorDepth;
    /** Use Unicode squares; otherwise plain ASCII. */
    unicode: boolean;
}

export interface GraphOptions extends GraphStyle {
    /** Available terminal columns. */
    width: number;
}

// GitHub's dark-theme greens (level 0 slightly lighter so it shows on black terminals).
const TRUE_COLORS: ReadonlyArray<readonly [number, number, number]> = [
    [45, 51, 59],
    [14, 68, 41],
    [0, 109, 50],
    [38, 166, 65],
    [57, 211, 83]
];
const ANSI_256 = [237, 22, 28, 34, 40];
const ANSI_16 = [90, 32, 32, 92, 92];
const GLYPHS_16 = ["■", "▪", "■", "▪", "■"];
const SHADES = ["·", "░", "▒", "▓", "█"];
const ASCII = [".", "-", "+", "*", "#"];

const LABEL_WIDTH = 4;
const CELL_WIDTH = 2;
const DAY_LABELS = ["", "Mon", "", "Wed", "", "Fri", ""];

/** Intensity level 0–4 of a day, relative to the busiest day. */
export function levelFor(count: number, max: number): number {
    if (count <= 0 || max <= 0) return 0;
    return Math.min(4, Math.max(1, Math.ceil((count / max) * 4)));
}

/** One colored square for a level. */
export function paintCell(level: number, style: GraphStyle): string {
    const index = Math.min(4, Math.max(0, level));
    if (style.colorDepth === 1) return (style.unicode ? SHADES : ASCII)[index] ?? " ";
    if (!style.unicode) {
        const char = ASCII[index] ?? " ";
        return `\u001b[${ANSI_16[index]}m${char}\u001b[39m`;
    }
    if (style.colorDepth === 24) {
        const [r, g, b] = TRUE_COLORS[index] ?? [0, 0, 0];
        return `\u001b[38;2;${r};${g};${b}m■\u001b[39m`;
    }
    if (style.colorDepth === 8) return `\u001b[38;5;${ANSI_256[index]}m■\u001b[39m`;
    return `\u001b[${ANSI_16[index]}m${GLYPHS_16[index]}\u001b[39m`;
}

export function legend(style: GraphStyle): string {
    const cells = [0, 1, 2, 3, 4].map((level) => paintCell(level, style)).join(" ");
    return `${" ".repeat(LABEL_WIDTH)}Less ${cells} More`;
}

interface Segment {
    from: Day;
    to: Day;
    title?: string | undefined;
}

function segmentsFor(from: Day, to: Day): Segment[] {
    if (to - from + 1 <= 371) return [{ from, to }];
    const segments: Segment[] = [];
    const firstYear = ymdFromDay(from).year;
    const lastYear = ymdFromDay(to).year;
    for (let year = firstYear; year <= lastYear; year++) {
        segments.push({
            from: Math.max(from, startOfYear(year)),
            to: Math.min(to, endOfYear(year)),
            title: String(year)
        });
    }
    return segments;
}

function monthHeader(firstWeek: Day, weeks: number, segment: Segment): string {
    // One extra column lets a label start on the last week without being cut.
    const header = Array.from({ length: weeks * CELL_WIDTH + 1 }, () => " ");
    let nextFree = 0;
    let previousMonth = -1;
    for (let column = 0; column < weeks; column++) {
        const weekStart = firstWeek + column * 7;
        const visible = Math.max(weekStart, segment.from);
        const { month } = ymdFromDay(visible);
        if (month === previousMonth) continue;
        previousMonth = month;
        const position = column * CELL_WIDTH;
        const label = MONTH_NAMES[month - 1] ?? "";
        if (position < nextFree || position + label.length > header.length) continue;
        for (let i = 0; i < label.length; i++) header[position + i] = label[i] ?? " ";
        nextFree = position + label.length + 1;
    }
    return header.join("");
}

/**
 * Draws a GitHub-style contribution graph (weeks as columns, Sunday → Saturday as
 * rows). Long ranges are split per year, and wide ones to fit the terminal.
 */
export function renderGraph(
    counts: ReadonlyMap<Day, number>,
    from: Day,
    to: Day,
    options: GraphOptions
): string {
    let max = 0;
    for (let day = from; day <= to; day++) max = Math.max(max, counts.get(day) ?? 0);

    const maxWeeks = Math.max(4, Math.floor((options.width - LABEL_WIDTH - 1) / CELL_WIDTH));
    const blocks: string[] = [];

    for (const segment of segmentsFor(from, to)) {
        const firstWeek = startOfWeek(segment.from);
        const totalWeeks = Math.floor((segment.to - firstWeek) / 7) + 1;
        const lines: string[] = [];
        if (segment.title) lines.push(`${" ".repeat(LABEL_WIDTH)}${segment.title}`);

        for (let start = 0; start < totalWeeks; start += maxWeeks) {
            const weeks = Math.min(maxWeeks, totalWeeks - start);
            const chunkFirst = firstWeek + start * 7;
            if (start > 0) lines.push("");
            lines.push(
                `${" ".repeat(LABEL_WIDTH)}${monthHeader(chunkFirst, weeks, segment)}`.trimEnd()
            );
            for (let row = 0; row < 7; row++) {
                let line = (DAY_LABELS[row] ?? "").padEnd(LABEL_WIDTH);
                for (let column = 0; column < weeks; column++) {
                    const day = chunkFirst + column * 7 + row;
                    if (day < segment.from || day > segment.to) {
                        line += "  ";
                    } else {
                        line += `${paintCell(levelFor(counts.get(day) ?? 0, max), options)} `;
                    }
                }
                lines.push(line.trimEnd());
            }
        }
        blocks.push(lines.join("\n"));
    }

    blocks.push(legend(options));
    return blocks.join("\n\n");
}

/** Detects how many colors the stream supports, honoring NO_COLOR / FORCE_COLOR / --no-color. */
export function detectColorDepth(
    stream: NodeJS.WriteStream,
    env: NodeJS.ProcessEnv,
    disabled: boolean
): ColorDepth {
    if (disabled) return 1;
    if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return 1;
    const force = env.FORCE_COLOR;
    if (!stream.isTTY) {
        if (force === undefined || force === "0" || force === "false") return 1;
        if (force === "3") return 24;
        if (force === "2") return 8;
        return 4;
    }
    const depth = typeof stream.getColorDepth === "function" ? stream.getColorDepth(env) : 4;
    if (depth >= 24) return 24;
    if (depth >= 8) return 8;
    if (depth >= 4) return 4;
    return 1;
}

/** Same heuristic as `is-unicode-supported`: modern terminals everywhere except legacy consoles. */
export function supportsUnicode(env: NodeJS.ProcessEnv, platform = process.platform): boolean {
    if (platform !== "win32") return env.TERM !== "linux";
    return Boolean(
        env.WT_SESSION ||
            env.TERMINUS_SUBLIME ||
            env.ConEmuTask === "{cmd::Cmder}" ||
            env.TERM_PROGRAM === "Terminus-Sublime" ||
            env.TERM_PROGRAM === "vscode" ||
            env.TERM === "xterm-256color" ||
            env.TERM === "alacritty" ||
            env.TERM === "rxvt-unicode" ||
            env.TERM === "rxvt-unicode-256color" ||
            env.TERMINAL_EMULATOR === "JetBrains-JediTerm"
    );
}
