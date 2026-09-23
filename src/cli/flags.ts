import type { Command } from "commander";
import type { PresetName, RawConfig } from "../config/schema.ts";
import { parsePercentage, parsePositiveInt } from "../core/parse.ts";
import { ConfigError, InvalidValueError } from "../errors.ts";

/** Options shared by every command that talks to GitHub or prints output. */
export interface CommonFlags {
    token?: string;
    host?: string;
    apiUrl?: string;
    json?: boolean;
    quiet?: boolean;
    verbose?: boolean;
    color?: boolean;
    ascii?: boolean;
    yes?: boolean;
    force?: boolean;
}

/** Raw values commander produces for `retrocommit` / `retrocommit preview`. */
export interface GenerationFlags extends CommonFlags {
    from?: string;
    to?: string;
    year?: string;
    exclude?: string[];
    allowFuture?: boolean;
    commits?: string;
    distribution?: "uniform" | "normal" | "skewed";
    frequency?: string;
    days?: string;
    weights?: string;
    fill?: "all" | "gaps" | "top-up";
    preset?: PresetName;
    maxCommits?: string;
    seed?: string;
    time?: string;
    timezone?: string;
    text?: string;
    pattern?: string;
    intensity?: string;
    message?: string;
    messagesFile?: string;
    authorName?: string;
    authorEmail?: string;
    content?: "single" | "daily" | "empty";
    contentPath?: string;
    readme?: boolean | string;
    repo?: string;
    owner?: string;
    private?: boolean;
    public?: boolean;
    description?: string;
    topics?: string;
    branch?: string;
    ifExists?: "fail" | "append" | "replace";
    push?: boolean;
    output?: string;
    remote?: string;
    protocol?: "https" | "ssh";
    dryRun?: boolean;
    graph?: boolean;
    config?: string | false;
    interactive?: boolean;
}

/** Flags that map 1:1 to a config key and are passed through as strings. */
const STRING_KEYS = [
    "from",
    "to",
    "commits",
    "distribution",
    "days",
    "weights",
    "fill",
    "preset",
    "seed",
    "time",
    "timezone",
    "text",
    "pattern",
    "message",
    "messagesFile",
    "authorName",
    "authorEmail",
    "content",
    "contentPath",
    "repo",
    "owner",
    "description",
    "topics",
    "branch",
    "ifExists",
    "output",
    "remote",
    "protocol",
    "host",
    "apiUrl"
] as const satisfies ReadonlyArray<keyof GenerationFlags & keyof RawConfig>;

function kebab(key: string): string {
    return key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
}

export interface FlagValues {
    values: RawConfig;
    /** Problems found while converting the flags (reported together with the rest). */
    issues: string[];
}

/**
 * Converts the flags the user actually typed (not commander defaults) into a config
 * layer, coercing numbers and checking flag-only conflicts.
 */
export function flagsToConfig(command: Command): FlagValues {
    const flags = command.opts<GenerationFlags>();
    const typed = (key: string) => command.getOptionValueSource(key) === "cli";
    const config: Record<string, unknown> = {};
    const issues: string[] = [];

    const coerce = (key: keyof GenerationFlags, parse: (value: string) => unknown) => {
        if (!typed(key)) return;
        try {
            config[key] = parse(String(flags[key]));
        } catch (error) {
            if (!(error instanceof InvalidValueError)) throw error;
            issues.push(`--${kebab(key)}: ${error.message}`);
        }
    };

    for (const key of STRING_KEYS) {
        if (typed(key) && flags[key] !== undefined) config[key] = flags[key];
    }

    coerce("frequency", parsePercentage);
    coerce("maxCommits", (value) => parsePositiveInt(value));
    coerce("intensity", (value) => parsePositiveInt(value, 1000));
    coerce("year", (value) => {
        if (!/^\d{4}$/.test(value.trim())) throw new InvalidValueError(`"${value}" is not a year`);
        return Number(value);
    });

    if (typed("exclude") && flags.exclude) config.exclude = flags.exclude;
    if (typed("allowFuture")) config.allowFuture = Boolean(flags.allowFuture);
    if (typed("readme")) config.readme = flags.readme;
    if (typed("push")) config.push = flags.push;

    if (typed("public") && typed("private")) {
        issues.push("--public and --private can't be used together");
    } else if (typed("public")) {
        config.visibility = "public";
    } else if (typed("private")) {
        config.visibility = "private";
    }

    return { values: config as RawConfig, issues };
}

/** Throws the flag problems right away (for commands that don't resolve the full config). */
export function assertNoIssues(issues: readonly string[]): void {
    if (issues.length === 0) return;
    throw new ConfigError(
        issues.length === 1 ? (issues[0] ?? "") : `Found ${issues.length} problems:`,
        {
            details: issues.length === 1 ? [] : issues
        }
    );
}
