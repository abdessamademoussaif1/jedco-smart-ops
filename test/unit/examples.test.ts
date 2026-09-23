import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfigFile } from "../../src/config/load.ts";
import { buildLayers, mergeLayers, resolveOptions } from "../../src/config/resolve.ts";
import { parsePattern } from "../../src/core/art.ts";
import { parseMessagesFile } from "../../src/core/messages.ts";

const EXAMPLES = join(import.meta.dirname, "..", "..", "examples");
const now = new Date("2026-09-22T12:00:00Z");

describe("examples/", () => {
    for (const name of [
        "retrocommit.config.yaml",
        "realistic.json",
        "weekdays.yaml",
        "text-art.yaml"
    ]) {
        it(`${name} is a valid configuration`, async () => {
            const file = await loadConfigFile(join(EXAMPLES, name));
            const options = await resolveOptions(
                mergeLayers(buildLayers({ file, flags: { timezone: "UTC" } })),
                { now, cwd: EXAMPLES }
            );
            expect(options.to).toBeGreaterThanOrEqual(options.from);
        });
    }

    it("heart.txt is a valid pattern", async () => {
        const grid = parsePattern(await readFile(join(EXAMPLES, "heart.txt"), "utf8"));
        expect(grid.width).toBe(9);
    });

    it("messages.txt is a valid messages file", async () => {
        expect(
            parseMessagesFile(await readFile(join(EXAMPLES, "messages.txt"), "utf8")).length
        ).toBeGreaterThan(3);
    });
});
