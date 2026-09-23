import { readdir, readFile, stat } from "node:fs/promises";
import { basename, resolve as resolvePath } from "node:path";
import { PROJECT_URL } from "../constants.ts";
import {
    type ArtGrid,
    type ArtWindow,
    levelToCommits,
    parsePattern,
    placeArt,
    rangeArtWindow,
    rollingArtWindow,
    textToGrid,
    yearArtWindow
} from "../core/art.ts";
import {
    type DateRange,
    type Day,
    dayFromYmd,
    endOfYear,
    formatDay,
    MAX_YEAR,
    MIN_YEAR,
    parseDateInput,
    parseDateRanges,
    startOfYear
} from "../core/dates.ts";
import { parseMessagesFile, validateTemplate } from "../core/messages.ts";
import {
    type CountRange,
    parseCountRange,
    parseList,
    parsePercentage,
    parsePositiveInt,
    parseTimeWindow,
    parseWeekdays,
    parseWeights,
    type TimeWindow
} from "../core/parse.ts";
import type { FillMode, Schedule } from "../core/planner.ts";
import { type Distribution, randomSeed } from "../core/random.ts";
import { localDayOf, localSecondOfDay, resolveZone, type Zone } from "../core/timezone.ts";
import { ConfigError, errorMessage, InvalidValueError } from "../errors.ts";
import type { ContentMode } from "../git/fast-import.ts";
import { type Endpoints, resolveEndpoints } from "../github/client.ts";
import type { LoadedConfig } from "./load.ts";
import { type ConfigKey, DEFAULTS, PRESETS, type PresetName, type RawConfig } from "./schema.ts";
import {
    validateApiUrl,
    validateAuthorName,
    validateBranchName,
    validateContentPath,
    validateDescription,
    validateEmail,
    validateHost,
    validateOwnerName,
    validateRemoteUrl,
    validateRepoName,
    validateTopics
} from "./validate.ts";

export type SourceKind = "default" | "preset" | "file" | "wizard" | "flag";

export interface Source {
    kind: SourceKind;
    /** Preset name or config file path. */
    detail?: string | undefined;
}

export interface Layer {
    source: Source;
    values: RawConfig;
}

export interface MergedConfig {
    values: RawConfig;
    sources: ReadonlyMap<ConfigKey, Source>;
}

/** Later layers win. `undefined` values never override. */
export function mergeLayers(layers: readonly Layer[]): MergedConfig {
    const values: Record<string, unknown> = {};
    const sources = new Map<ConfigKey, Source>();
    for (const layer of layers) {
        for (const [key, value] of Object.entries(layer.values)) {
            if (value === undefined || key === "$schema") continue;
            values[key] = value;
            sources.set(key as ConfigKey, layer.source);
        }
    }
    return { values: values as RawConfig, sources };
}

/** defaults < preset < config file < wizard answers < flags */
export function buildLayers(options: {
    file?: LoadedConfig | undefined;
    wizard?: RawConfig | undefined;
    flags?: RawConfig | undefined;
}): Layer[] {
    const preset = options.flags?.preset ?? options.wizard?.preset ?? options.file?.values.preset;
    const layers: Layer[] = [{ source: { kind: "default" }, values: DEFAULTS }];
    if (preset)
        layers.push({ source: { kind: "preset", detail: preset }, values: PRESETS[preset] });
    if (options.file) {
        layers.push({
            source: { kind: "file", detail: options.file.path },
            values: options.file.values
        });
    }
    if (options.wizard) layers.push({ source: { kind: "wizard" }, values: options.wizard });
    if (options.flags) layers.push({ source: { kind: "flag" }, values: options.flags });
    return layers;
}

const FLAG_NAMES: Partial<Record<ConfigKey, string>> = {
    visibility: "--public/--private",
    push: "--no-push",
    readme: "--readme"
};

function kebab(key: string): string {
    return key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
}

/** How to name an option in messages, depending on where its value came from. */
export function optionLabel(key: ConfigKey, source: Source | undefined): string {
    switch (source?.kind) {
        case "flag":
            return FLAG_NAMES[key] ?? `--${kebab(key)}`;
        case "file":
            return `"${key}" in ${basename(source.detail ?? "config")}`;
        case "preset":
            return `"${key}" (preset ${source.detail})`;
        default:
            return `"${key}"`;
    }
}

export interface ResolvedArt {
    kind: "text" | "pattern";
    /** The text, or the pattern file name. */
    label: string;
    grid: ArtGrid;
    window: ArtWindow;
    /** Commits wanted per day. */
    targets: Map<Day, number>;
    intensity: number;
}

export interface ResolvedOptions {
    zone: Zone;
    today: Day;
    nowSecondOfDay: number;
    from: Day;
    to: Day;
    allowFuture: boolean;
    schedule: Schedule;
    fill: FillMode;
    maxCommits: number;
    seed: string;
    time: TimeWindow;
    art: ResolvedArt | undefined;
    message: string;
    messages: string[] | undefined;
    messagesFile: string | undefined;
    authorName: string | undefined;
    authorEmail: string | undefined;
    content: ContentMode;
    contentPath: string;
    /** README content for the first commit, or `undefined` to skip it. */
    readme: string | undefined;
    repo: string;
    owner: string | undefined;
    visibility: "private" | "public";
    description: string;
    topics: string[];
    branch: string;
    branchExplicit: boolean;
    ifExists: "fail" | "append" | "replace";
    push: boolean;
    output: string | undefined;
    remote: string | undefined;
    protocol: "https" | "ssh";
    endpoints: Endpoints;
    preset: PresetName | undefined;
    warnings: string[];
}

export interface ResolveContext {
    now: Date;
    cwd: string;
    /** Problems already found (e.g. while reading flags), reported together. */
    issues?: readonly string[] | undefined;
}

export function defaultReadme(repo: string): string {
    return `# ${repo}\n\nActivity log generated with [retrocommit](${PROJECT_URL}).\n`;
}

async function readTextFile(path: string, what: string): Promise<string> {
    try {
        const info = await stat(path);
        if (!info.isFile()) throw new InvalidValueError(`${path} is not a file`);
        if (info.size > 1024 * 1024) throw new InvalidValueError(`${path} is too large (max 1 MB)`);
        return (await readFile(path, "utf8")).replace(/^﻿/, "");
    } catch (error) {
        if (error instanceof InvalidValueError) throw error;
        const code = (error as NodeJS.ErrnoException).code;
        throw new InvalidValueError(
            code === "ENOENT"
                ? `${what} not found: ${path}`
                : `can't read ${path}: ${errorMessage(error)}`
        );
    }
}

async function checkOutputDirectory(path: string): Promise<void> {
    try {
        const info = await stat(path);
        if (!info.isDirectory())
            throw new InvalidValueError(`${path} already exists and is not a directory`);
        if ((await readdir(path)).length > 0) {
            throw new InvalidValueError(
                `${path} already exists and is not empty; choose another directory`
            );
        }
    } catch (error) {
        if (error instanceof InvalidValueError) throw error;
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
}

const MIN_DAY = dayFromYmd(1970, 1, 2);
const SCHEDULE_KEYS: ConfigKey[] = [
    "commits",
    "frequency",
    "days",
    "weights",
    "distribution",
    "exclude"
];

/**
 * Validates and normalizes the merged options. Every problem is collected, so the user
 * sees all of them at once instead of fixing them one by one.
 */
export async function resolveOptions(
    merged: MergedConfig,
    context: ResolveContext
): Promise<ResolvedOptions> {
    const { values, sources } = merged;
    const issues: string[] = [...(context.issues ?? [])];
    const warnings: string[] = [];
    const label = (key: ConfigKey) => optionLabel(key, sources.get(key));
    const explicit = (key: ConfigKey) => {
        const kind = sources.get(key)?.kind;
        return kind === "file" || kind === "wizard" || kind === "flag";
    };

    const check = <T>(key: ConfigKey, parse: () => T): T | undefined => {
        try {
            return parse();
        } catch (error) {
            if (!(error instanceof InvalidValueError)) throw error;
            issues.push(`${label(key)}: ${error.message}`);
            return undefined;
        }
    };
    const checkAsync = async <T>(
        key: ConfigKey,
        parse: () => Promise<T>
    ): Promise<T | undefined> => {
        try {
            return await parse();
        } catch (error) {
            if (!(error instanceof InvalidValueError)) throw error;
            issues.push(`${label(key)}: ${error.message}`);
            return undefined;
        }
    };

    // Time zone and "today" come first: dates depend on them.
    const zone = check("timezone", () => resolveZone(values.timezone)) ?? resolveZone("UTC");
    const nowMs = context.now.getTime();
    const today = localDayOf(nowMs, zone);
    const nowSecondOfDay = localSecondOfDay(nowMs, zone);
    const allowFuture = values.allowFuture ?? false;

    // Contradictory combinations.
    const conflict = (a: ConfigKey, b: ConfigKey, reason: string) => {
        if (values[a] !== undefined && values[b] !== undefined && explicit(a) && explicit(b)) {
            issues.push(`${label(a)} and ${label(b)} can't be used together: ${reason}`);
        }
    };
    conflict("year", "from", "--year already sets the start date");
    conflict("year", "to", "--year already sets the end date");
    conflict("text", "pattern", "choose either a text or a pattern");
    conflict("remote", "owner", "the owner only applies to repositories created on GitHub");
    if (values.push === false && values.remote !== undefined && explicit("remote")) {
        issues.push(`${label("remote")} and --no-push can't be used together`);
    }

    // Date range.
    let from = today;
    let to = today;
    if (values.year !== undefined) {
        const year = values.year;
        if (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR) {
            issues.push(`${label("year")}: must be a year between ${MIN_YEAR} and ${MAX_YEAR}`);
        } else if (!allowFuture && startOfYear(year) > today) {
            issues.push(
                `${label("year")}: ${year} is in the future (use --allow-future to allow it)`
            );
        } else {
            from = startOfYear(year);
            to = allowFuture ? endOfYear(year) : Math.min(endOfYear(year), today);
        }
    } else {
        from = check("from", () => parseDateInput(values.from ?? "1y", "start", today)) ?? today;
        to = check("to", () => parseDateInput(values.to ?? "today", "end", today)) ?? today;
        if (from < MIN_DAY) issues.push(`${label("from")}: dates must be after 1970-01-01`);
        if (!allowFuture && from > today) {
            issues.push(
                `${label("from")}: ${formatDay(from)} is in the future (today is ${formatDay(today)} in ${zone.name}). Use --allow-future to allow it`
            );
        } else if (from > to) {
            issues.push(
                `${label("from")} (${formatDay(from)}) is after ${label("to")} (${formatDay(to)})`
            );
        }
        if (!allowFuture && to > today && from <= today) {
            issues.push(
                `${label("to")}: ${formatDay(to)} is in the future (today is ${formatDay(today)} in ${zone.name}). Use --allow-future to allow it`
            );
        }
    }

    // Schedule.
    const commits =
        check("commits", () => parseCountRange(values.commits ?? "1-5")) ??
        ({ min: 1, max: 5 } satisfies CountRange);
    const frequency = check("frequency", () => parsePercentage(values.frequency ?? 100)) ?? 100;
    const weekdays =
        check("days", () => parseWeekdays(values.days ?? "all")) ?? new Set([0, 1, 2, 3, 4, 5, 6]);
    const weights = check("weights", () =>
        values.weights ? parseWeights(values.weights) : [1, 1, 1, 1, 1, 1, 1]
    ) ?? [1, 1, 1, 1, 1, 1, 1];
    const exclude: DateRange[] =
        check("exclude", () => (values.exclude ? parseDateRanges(values.exclude, today) : [])) ??
        [];
    const distribution: Distribution = values.distribution ?? "uniform";
    const time = check("time", () => parseTimeWindow(values.time ?? "09:00-21:00")) ?? {
        start: 9 * 3600,
        end: 21 * 3600
    };
    const fill: FillMode = values.fill ?? "all";
    const maxCommits =
        check("maxCommits", () => parsePositiveInt(values.maxCommits ?? 50_000)) ?? 50_000;
    const seed =
        values.seed === undefined ? randomSeed() : String(values.seed).trim() || randomSeed();

    // Drawings.
    let art: ResolvedArt | undefined;
    if (values.text !== undefined || values.pattern !== undefined) {
        const intensity =
            check("intensity", () => parsePositiveInt(values.intensity ?? 12, 1000)) ?? 12;
        const grid =
            values.text !== undefined
                ? check("text", () => textToGrid(values.text ?? ""))
                : await checkAsync("pattern", async () =>
                      parsePattern(await readTextFile(values.pattern ?? "", "pattern file"))
                  );

        if (grid && issues.length === 0) {
            // "The last 12 months" means the profile's rolling view, centered.
            const rolling =
                values.year === undefined &&
                ((!explicit("from") && !explicit("to")) ||
                    (String(values.from ?? "1y")
                        .trim()
                        .toLowerCase() === "1y" &&
                        String(values.to ?? "today")
                            .trim()
                            .toLowerCase() === "today"));
            const window =
                values.year !== undefined
                    ? yearArtWindow(values.year, allowFuture ? endOfYear(values.year) : today)
                    : rolling
                      ? rollingArtWindow(today)
                      : rangeArtWindow(from, to);
            const align =
                !rolling && values.year === undefined && explicit("from") ? "start" : "center";
            const key: ConfigKey = values.text !== undefined ? "text" : "pattern";
            const levels = check(key, () => placeArt(grid, window, align));
            if (levels) {
                const targets = new Map<Day, number>();
                for (const [day, level] of levels)
                    targets.set(day, levelToCommits(level, intensity));
                art = {
                    kind: values.text !== undefined ? "text" : "pattern",
                    label: values.text ?? basename(values.pattern ?? ""),
                    grid,
                    window,
                    targets,
                    intensity
                };
                from = window.first;
                to = window.last;
                const ignored = SCHEDULE_KEYS.filter((item) => explicit(item));
                if (ignored.length > 0) {
                    warnings.push(
                        `${ignored.map(label).join(", ")} ${ignored.length === 1 ? "is" : "are"} ignored when drawing on the graph.`
                    );
                }
            }
        }
    }

    // Commit messages.
    const message = values.message ?? DEFAULTS.message ?? "";
    check("message", () => validateTemplate(message));
    let messages: string[] | undefined;
    if (values.messagesFile !== undefined) {
        messages = await checkAsync("messagesFile", async () =>
            parseMessagesFile(await readTextFile(values.messagesFile ?? "", "messages file"))
        );
    }

    // Author.
    const authorName =
        values.authorName === undefined
            ? undefined
            : check("authorName", () => validateAuthorName(values.authorName ?? ""));
    const authorEmail =
        values.authorEmail === undefined
            ? undefined
            : check("authorEmail", () => validateEmail(values.authorEmail ?? ""));

    // Repository contents.
    const content: ContentMode = values.content ?? "single";
    const contentPath =
        check("contentPath", () =>
            validateContentPath(
                values.contentPath ?? (content === "daily" ? "activity" : "activity.log")
            )
        ) ?? "activity.log";

    const repo =
        check("repo", () => validateRepoName(values.repo ?? "activity-log")) ?? "activity-log";
    let readme: string | undefined;
    if (values.readme === true || values.readme === undefined) readme = defaultReadme(repo);
    else if (typeof values.readme === "string") {
        readme = await checkAsync("readme", () =>
            readTextFile(values.readme as string, "README file")
        );
    }
    if (readme !== undefined && content !== "empty" && contentPath.toLowerCase() === "readme.md") {
        issues.push(`${label("contentPath")}: can't be README.md while the README is enabled`);
    }

    // Repository and destination.
    const owner =
        values.owner === undefined
            ? undefined
            : check("owner", () => validateOwnerName(values.owner ?? ""));
    const visibility = values.visibility ?? "private";
    const description =
        check("description", () => validateDescription(values.description ?? "")) ?? "";
    const topics =
        check("topics", () =>
            validateTopics(values.topics === undefined ? [] : parseList(values.topics))
        ) ?? [];
    const branch = check("branch", () => validateBranchName(values.branch ?? "main")) ?? "main";
    const ifExists = values.ifExists ?? "fail";
    const push = values.push ?? true;
    const remote =
        values.remote === undefined
            ? undefined
            : check("remote", () => validateRemoteUrl(values.remote ?? ""));
    const protocol = values.protocol ?? "https";
    const host = check("host", () => validateHost(values.host ?? "github.com")) ?? "github.com";
    const apiUrl =
        values.apiUrl === undefined
            ? undefined
            : check("apiUrl", () => validateApiUrl(values.apiUrl ?? ""));

    let output: string | undefined;
    if (values.output !== undefined && values.output.trim() !== "") {
        output = resolvePath(context.cwd, values.output);
    } else if (!push) {
        output = resolvePath(context.cwd, repo);
    }
    if (output !== undefined) {
        const target = output;
        await checkAsync("output", () => checkOutputDirectory(target));
    }

    if (!push && explicit("ifExists"))
        warnings.push(`${label("ifExists")} is ignored with --no-push.`);
    if (remote !== undefined) {
        for (const key of ["visibility", "description", "topics", "protocol"] as const) {
            if (explicit(key)) warnings.push(`${label(key)} is ignored when pushing to --remote.`);
        }
    }
    if (from < dayFromYmd(2008, 1, 1) && issues.length === 0) {
        warnings.push(
            `GitHub was launched in 2008; days before ${formatDay(dayFromYmd(2008, 1, 1))} may not be shown on profiles.`
        );
    }

    if (issues.length > 0) {
        throw new ConfigError(
            issues.length === 1
                ? (issues[0] ?? "Invalid option")
                : `Found ${issues.length} problems:`,
            {
                details: issues.length === 1 ? [] : issues,
                hint: "Run `retrocommit --help` to see every option and its format."
            }
        );
    }

    return {
        zone,
        today,
        nowSecondOfDay,
        from,
        to,
        allowFuture,
        schedule: { commits, distribution, frequency, weekdays, weights, exclude },
        fill,
        maxCommits,
        seed,
        time,
        art,
        message,
        messages,
        messagesFile: values.messagesFile,
        authorName,
        authorEmail,
        content,
        contentPath,
        readme,
        repo,
        owner,
        visibility,
        description,
        topics,
        branch,
        branchExplicit: explicit("branch"),
        ifExists,
        push,
        output,
        remote,
        protocol,
        endpoints: resolveEndpoints(host, apiUrl),
        preset: values.preset,
        warnings
    };
}
