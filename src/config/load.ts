import { access, readFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";
import YAML from "yaml";
import type { z } from "zod";
import { CONFIG_FILE_NAMES } from "../constants.ts";
import { ConfigError, errorMessage } from "../errors.ts";
import { CONFIG_KEYS, PATH_KEYS, type RawConfig, RawConfigSchema } from "./schema.ts";

export interface LoadedConfig {
    path: string;
    values: RawConfig;
}

/** Looks for a config file in `cwd` (see CONFIG_FILE_NAMES for the order). */
export async function findConfigFile(cwd: string): Promise<string | undefined> {
    for (const name of CONFIG_FILE_NAMES) {
        const path = join(cwd, name);
        try {
            await access(path);
            return path;
        } catch {
            // Not there; try the next name.
        }
    }
    return undefined;
}

export function levenshtein(a: string, b: string): number {
    const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
    for (let i = 1; i <= a.length; i++) {
        let diagonal = previous[0] ?? 0;
        previous[0] = i;
        for (let j = 1; j <= b.length; j++) {
            const above = previous[j] ?? 0;
            const cost = a[i - 1]?.toLowerCase() === b[j - 1]?.toLowerCase() ? 0 : 1;
            previous[j] = Math.min(above + 1, (previous[j - 1] ?? 0) + 1, diagonal + cost);
            diagonal = above;
        }
    }
    return previous[b.length] ?? 0;
}

/** The closest candidate, if it's close enough to be a likely typo. */
export function suggest(input: string, candidates: readonly string[]): string | undefined {
    let best: string | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    const normalized = input.replace(/[-_]/g, "").toLowerCase();
    for (const candidate of candidates) {
        const distance = levenshtein(normalized, candidate.toLowerCase());
        if (distance < bestDistance) {
            best = candidate;
            bestDistance = distance;
        }
    }
    return bestDistance <= Math.max(2, Math.floor(input.length / 3)) ? best : undefined;
}

/** Human-readable lines for zod issues. */
export function describeIssues(error: z.ZodError, label: (key: string) => string): string[] {
    const lines: string[] = [];
    for (const issue of error.issues) {
        if (issue.code === "unrecognized_keys") {
            for (const key of issue.keys) {
                const guess = suggest(key, CONFIG_KEYS);
                lines.push(`Unknown option "${key}"${guess ? ` (did you mean "${guess}"?)` : ""}`);
            }
            continue;
        }
        const [key = "", ...rest] = issue.path.map(String);
        const suffix = rest.length > 0 ? `.${rest.join(".")}` : "";
        lines.push(`${label(key)}${suffix}: ${issue.message}`);
    }
    return lines;
}

function parseText(text: string, path: string): unknown {
    const name = basename(path);
    if (extname(path).toLowerCase() === ".json") {
        try {
            return JSON.parse(text);
        } catch (error) {
            throw new ConfigError(`${name} is not valid JSON: ${errorMessage(error)}`);
        }
    }
    const document = YAML.parseDocument(text, { prettyErrors: true });
    if (document.errors.length > 0) {
        throw new ConfigError(`${name} is not valid YAML/JSON.`, {
            details: document.errors.map((error) => error.message.split("\n")[0] ?? error.message)
        });
    }
    return document.toJS();
}

function resolvePaths(values: RawConfig, base: string): RawConfig {
    const copy: RawConfig = { ...values };
    for (const key of PATH_KEYS) {
        const value = copy[key];
        if (typeof value === "string" && value.trim() !== "" && !isAbsolute(value)) {
            copy[key] = resolve(base, value);
        }
    }
    if (typeof copy.readme === "string" && !isAbsolute(copy.readme)) {
        copy.readme = resolve(base, copy.readme);
    }
    return copy;
}

/** Reads and validates a JSON or YAML configuration file. */
export async function loadConfigFile(path: string): Promise<LoadedConfig> {
    const name = basename(path);
    let text: string;
    try {
        text = await readFile(path, "utf8");
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        throw new ConfigError(
            code === "ENOENT"
                ? `Config file not found: ${path}`
                : `Could not read ${path}: ${errorMessage(error)}`
        );
    }

    const data = parseText(text.replace(/^﻿/, ""), path);
    if (data === null || data === undefined) return { path, values: {} };
    if (typeof data !== "object" || Array.isArray(data)) {
        throw new ConfigError(`${name} must contain an object with options.`);
    }
    if ("token" in data) {
        throw new ConfigError(`${name} contains a "token", which isn't allowed in config files.`, {
            hint: "Keep secrets out of files: use the RETROCOMMIT_TOKEN (or GH_TOKEN) environment variable instead."
        });
    }

    const result = RawConfigSchema.safeParse(data);
    if (!result.success) {
        throw new ConfigError(`${name} has invalid options:`, {
            details: describeIssues(result.error, (key) => `"${key}"`)
        });
    }
    return { path, values: resolvePaths(result.data, dirname(path)) };
}
