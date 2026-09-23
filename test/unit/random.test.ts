import { describe, expect, it } from "vitest";
import { createRng, randomSeed, sampleCount } from "../../src/core/random.ts";

function draw(seed: string, stream: string, n = 20): number[] {
    const rng = createRng(seed, stream);
    return Array.from({ length: n }, () => rng.next());
}

describe("createRng", () => {
    it("is deterministic for the same seed and stream", () => {
        expect(draw("42", "a")).toEqual(draw("42", "a"));
    });

    it("gives independent sequences for other seeds and streams", () => {
        expect(draw("42", "a")).not.toEqual(draw("43", "a"));
        expect(draw("42", "a")).not.toEqual(draw("42", "b"));
    });

    it("produces floats in [0, 1)", () => {
        for (const value of draw("seed", "range", 5000)) {
            expect(value).toBeGreaterThanOrEqual(0);
            expect(value).toBeLessThan(1);
        }
    });

    it("draws integers covering both ends of the range", () => {
        const rng = createRng("ints");
        const seen = new Set<number>();
        for (let i = 0; i < 2000; i++) seen.add(rng.int(3, 7));
        expect([...seen].sort()).toEqual([3, 4, 5, 6, 7]);
    });

    it("picks items and refuses empty lists", () => {
        const rng = createRng("pick");
        const items = ["a", "b", "c"];
        for (let i = 0; i < 100; i++) expect(items).toContain(rng.pick(items));
        expect(() => rng.pick([])).toThrow(RangeError);
    });

    it("samples a roughly standard normal distribution", () => {
        const rng = createRng("normal");
        const values = Array.from({ length: 20_000 }, () => rng.normal());
        const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
        const variance =
            values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
        expect(Math.abs(mean)).toBeLessThan(0.05);
        expect(Math.abs(variance - 1)).toBeLessThan(0.05);
    });
});

describe("sampleCount", () => {
    const average = (distribution: "uniform" | "normal" | "skewed") => {
        const rng = createRng("avg", distribution);
        let total = 0;
        for (let i = 0; i < 10_000; i++) {
            const value = sampleCount(rng, 1, 10, distribution);
            expect(value).toBeGreaterThanOrEqual(1);
            expect(value).toBeLessThanOrEqual(10);
            total += value;
        }
        return total / 10_000;
    };

    it("stays within bounds for every distribution", () => {
        const uniform = average("uniform");
        const normal = average("normal");
        const skewed = average("skewed");
        expect(uniform).toBeGreaterThan(5.2);
        expect(uniform).toBeLessThan(5.8);
        expect(normal).toBeGreaterThan(5.2);
        expect(normal).toBeLessThan(5.8);
        expect(skewed).toBeLessThan(4.5);
    });

    it("returns the only possible value when min equals max", () => {
        const rng = createRng("fixed");
        expect(sampleCount(rng, 4, 4, "uniform")).toBe(4);
        expect(sampleCount(rng, 4, 4, "skewed")).toBe(4);
    });
});

describe("randomSeed", () => {
    it("returns a short numeric seed", () => {
        expect(randomSeed()).toMatch(/^\d{6}$/);
    });
});
