import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderSchema, SCHEMA_PATH } from "../../scripts/generate-schema.ts";
import { CONFIG_KEYS } from "../../src/config/schema.ts";

describe("schema.json", () => {
    it("is up to date (run `npm run schema` after changing the options)", () => {
        expect(readFileSync(SCHEMA_PATH, "utf8")).toBe(renderSchema());
    });

    it("documents every option", () => {
        const schema = JSON.parse(renderSchema()) as {
            properties: Record<string, { description?: string }>;
            additionalProperties: boolean;
        };
        expect(Object.keys(schema.properties).sort()).toEqual([...CONFIG_KEYS].sort());
        expect(schema.additionalProperties).toBe(false);
        for (const [key, property] of Object.entries(schema.properties)) {
            expect(property.description, key).toBeTruthy();
        }
    });
});
