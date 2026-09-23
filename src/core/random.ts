import { randomInt } from "node:crypto";

/** A small, fast, seedable PRNG (sfc32 seeded with cyrb128). Not for cryptography. */
export interface Rng {
    /** A float in [0, 1). */
    next(): number;
    /** An integer in [min, max] (both inclusive). */
    int(min: number, max: number): number;
    chance(probability: number): boolean;
    pick<T>(items: readonly T[]): T;
    /** A sample of the standard normal distribution. */
    normal(): number;
}

export type Distribution = "uniform" | "normal" | "skewed";

function cyrb128(text: string): [number, number, number, number] {
    let h1 = 1779033703;
    let h2 = 3144134277;
    let h3 = 1013904242;
    let h4 = 2773480762;
    for (let i = 0; i < text.length; i++) {
        const k = text.charCodeAt(i);
        h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
        h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
        h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
        h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
    }
    h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
    h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
    h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
    h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
    h1 ^= h2 ^ h3 ^ h4;
    h2 ^= h1;
    h3 ^= h1;
    h4 ^= h1;
    return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

function sfc32(seed: [number, number, number, number]): () => number {
    let [a, b, c, d] = seed;
    return () => {
        a |= 0;
        b |= 0;
        c |= 0;
        d |= 0;
        const t = (((a + b) | 0) + d) | 0;
        d = (d + 1) | 0;
        a = b ^ (b >>> 9);
        b = (c + (c << 3)) | 0;
        c = (c << 21) | (c >>> 11);
        c = (c + t) | 0;
        return (t >>> 0) / 4294967296;
    };
}

/**
 * Creates an independent random stream. Using one stream per purpose and per day
 * (for example `time:19800`) keeps plans stable: changing one option never
 * reshuffles unrelated days.
 */
export function createRng(seed: string, stream = ""): Rng {
    const next = sfc32(cyrb128(`${seed}\u0000${stream}`));
    for (let i = 0; i < 12; i++) next();

    const rng: Rng = {
        next,
        int(min, max) {
            return min + Math.floor(next() * (max - min + 1));
        },
        chance(probability) {
            return next() < probability;
        },
        pick(items) {
            if (items.length === 0) throw new RangeError("Cannot pick from an empty list");
            return items[Math.floor(next() * items.length)] as (typeof items)[number];
        },
        normal() {
            const u = 1 - next();
            const v = next();
            return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
        }
    };
    return rng;
}

/** A short random seed, easy to copy from the terminal. */
export function randomSeed(): string {
    return String(randomInt(100_000, 1_000_000));
}

/**
 * Draws how many commits a day gets.
 * - `uniform`: every value between min and max is equally likely.
 * - `normal`: values cluster around the middle (bell curve).
 * - `skewed`: mostly low values with occasional busy days (looks the most natural).
 */
export function sampleCount(
    rng: Rng,
    min: number,
    max: number,
    distribution: Distribution
): number {
    if (max <= min) return min;
    switch (distribution) {
        case "normal": {
            const mean = (min + max) / 2;
            const deviation = (max - min) / 6;
            const value = Math.round(mean + rng.normal() * deviation);
            return Math.min(max, Math.max(min, value));
        }
        case "skewed": {
            const span = max - min + 1;
            return min + Math.min(span - 1, Math.floor(rng.next() ** 2.2 * span));
        }
        default:
            return rng.int(min, max);
    }
}
