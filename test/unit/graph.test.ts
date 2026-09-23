import { describe, expect, it } from "vitest";
import {
    detectColorDepth,
    legend,
    levelFor,
    paintCell,
    renderGraph,
    supportsUnicode
} from "../../src/ui/graph.ts";
import { d } from "../helpers.ts";

const plain = { colorDepth: 1 as const, unicode: false };

function counts(entries: Array<[string, number]>): Map<number, number> {
    return new Map(entries.map(([date, count]) => [d(date), count]));
}

describe("levels and cells", () => {
    it("maps counts to GitHub-like levels", () => {
        expect(levelFor(0, 10)).toBe(0);
        expect(levelFor(1, 10)).toBe(1);
        expect(levelFor(5, 10)).toBe(2);
        expect(levelFor(7, 10)).toBe(3);
        expect(levelFor(10, 10)).toBe(4);
        expect(levelFor(3, 0)).toBe(0);
    });

    it("paints cells for every terminal capability", () => {
        expect(paintCell(4, plain)).toBe("#");
        expect(paintCell(0, { colorDepth: 1, unicode: true })).toBe("·");
        expect(paintCell(4, { colorDepth: 24, unicode: true })).toBe(
            "\u001b[38;2;57;211;83m■\u001b[39m"
        );
        expect(paintCell(2, { colorDepth: 8, unicode: true })).toBe("\u001b[38;5;28m■\u001b[39m");
        expect(paintCell(1, { colorDepth: 4, unicode: true })).toBe("\u001b[32m▪\u001b[39m");
        expect(paintCell(3, { colorDepth: 4, unicode: false })).toBe("\u001b[92m*\u001b[39m");
        expect(legend(plain)).toBe("    Less . - + * # More");
    });
});

describe("renderGraph", () => {
    it("draws weeks as columns and days as rows", () => {
        const graph = renderGraph(
            counts([
                ["2024-01-07", 4],
                ["2024-01-08", 1]
            ]),
            d("2024-01-07"),
            d("2024-01-13"),
            { ...plain, width: 80 }
        );
        const lines = graph.split("\n");
        expect(lines[0]).toBe("    Jan");
        expect(lines[1]).toBe("    #");
        expect(lines[2]).toBe("Mon -");
        expect(lines[3]).toBe("    .");
        expect(lines[4]).toBe("Wed .");
        expect(lines[6]).toBe("Fri .");
        expect(lines.at(-1)).toBe("    Less . - + * # More");
    });

    it("leaves days outside the range blank", () => {
        const graph = renderGraph(new Map(), d("2024-01-10"), d("2024-01-10"), {
            ...plain,
            width: 80
        });
        const rows = graph.split("\n").slice(1, 8);
        expect(rows.filter((row) => row.includes(".")).length).toBe(1);
    });

    it("splits wide graphs to fit the terminal", () => {
        const narrow = renderGraph(new Map(), d("2024-01-01"), d("2024-12-31"), {
            ...plain,
            width: 60
        });
        const wide = renderGraph(new Map(), d("2024-01-01"), d("2024-12-31"), {
            ...plain,
            width: 120
        });
        const longest = (text: string) => Math.max(...text.split("\n").map((line) => line.length));
        expect(longest(narrow)).toBeLessThanOrEqual(60);
        expect(narrow.split("\n").length).toBeGreaterThan(wide.split("\n").length);
        expect(longest(wide)).toBeLessThanOrEqual(120);
    });

    it("draws one block per year for long ranges", () => {
        const graph = renderGraph(new Map(), d("2022-06-01"), d("2024-02-01"), {
            ...plain,
            width: 120
        });
        expect(graph).toContain("    2022");
        expect(graph).toContain("    2023");
        expect(graph).toContain("    2024");
    });
});

describe("terminal detection", () => {
    const stream = (isTTY: boolean, depth = 24) =>
        ({ isTTY, getColorDepth: () => depth }) as unknown as NodeJS.WriteStream;

    it("honors NO_COLOR, FORCE_COLOR and --no-color", () => {
        expect(detectColorDepth(stream(true), {}, true)).toBe(1);
        expect(detectColorDepth(stream(true), { NO_COLOR: "1" }, false)).toBe(1);
        expect(detectColorDepth(stream(false), {}, false)).toBe(1);
        expect(detectColorDepth(stream(false), { FORCE_COLOR: "3" }, false)).toBe(24);
        expect(detectColorDepth(stream(false), { FORCE_COLOR: "2" }, false)).toBe(8);
        expect(detectColorDepth(stream(false), { FORCE_COLOR: "1" }, false)).toBe(4);
        expect(detectColorDepth(stream(true, 8), {}, false)).toBe(8);
        expect(detectColorDepth(stream(true, 24), {}, false)).toBe(24);
    });

    it("detects Unicode support", () => {
        expect(supportsUnicode({}, "darwin")).toBe(true);
        expect(supportsUnicode({ TERM: "linux" }, "linux")).toBe(false);
        expect(supportsUnicode({}, "win32")).toBe(false);
        expect(supportsUnicode({ WT_SESSION: "1" }, "win32")).toBe(true);
    });
});
