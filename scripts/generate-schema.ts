/**
 * Writes schema.json (the JSON Schema of configuration files) from the zod schema,
 * so editors can autocomplete and validate retrocommit.config.json/yaml.
 *
 * Usage: npm run schema
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import { RawConfigSchema } from "../src/config/schema.ts";
import { SCHEMA_URL } from "../src/constants.ts";

export const SCHEMA_PATH = fileURLToPath(new URL("../schema.json", import.meta.url));

export function buildSchema(): Record<string, unknown> {
    const generated = z.toJSONSchema(RawConfigSchema, { target: "draft-07", io: "input" });
    return {
        ...generated,
        $id: SCHEMA_URL,
        title: "retrocommit configuration"
    };
}

export function renderSchema(): string {
    return `${JSON.stringify(buildSchema(), null, 4)}\n`;
}

const invokedDirectly =
    process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
    writeFileSync(SCHEMA_PATH, renderSchema());
    process.stdout.write(`Wrote ${SCHEMA_PATH}\n`);
}
