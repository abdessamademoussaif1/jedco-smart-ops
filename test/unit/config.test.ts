import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findConfigFile, loadConfigFile, suggest } from "../../src/config/load.ts";
import {
    buildLayers,
    defaultReadme,
    mergeLayers,
    optionLabel,
    type ResolvedOptions,
    resolveOptions
} from "../../src/config/resolve.ts";
import type { RawConfig } from "../../src/config/schema.ts";
import { formatDay } from "../../src/core/dates.ts";
import { ConfigError } from "../../src/errors.ts";
import { tempDir } from "../helpers.ts";

const now = new Date("2024-06-15T12:00:00Z");
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()?.();
});

async function dir(): Promise<string> {
    const created = await tempDir();
    cleanups.push(created.cleanup);
    return created.path;
}

async function resolve(
    flags: RawConfig,
    extra: { file?: RawConfig; cwd?: string } = {}
): Promise<ResolvedOptions> {
    const layers = buildLayers({
        flags: { timezone: "UTC", ...flags },
        file: extra.file ? { path: "/tmp/retrocommit.config.json", values: extra.file } : undefined
    });
    return resolveOptions(mergeLayers(layers), { now, cwd: extra.cwd ?? "/tmp" });
}

async function problems(
    flags: RawConfig,
    extra: { file?: RawConfig; cwd?: string } = {}
): Promise<string> {
    const error = await resolve(flags, extra).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ConfigError);
    const configError = error as ConfigError;
    return [configError.message, ...configError.details].join("\n");
}

describe("layers", () => {
    it("merges defaults, presets, files and flags in order", () => {
        const merged = mergeLayers(
            buildLayers({
                file: {
                    path: "/x/retrocommit.config.yaml",
                    values: { preset: "realistic", frequency: 50 }
                },
                flags: { commits: "2-3" }
            })
        );
        expect(merged.values.frequency).toBe(50);
        expect(merged.values.distribution).toBe("skewed");
        expect(merged.values.commits).toBe("2-3");
        expect(merged.values.repo).toBe("activity-log");
        expect(merged.sources.get("frequency")?.kind).toBe("file");
        expect(merged.sources.get("distribution")).toEqual({ kind: "preset", detail: "realistic" });
        expect(merged.sources.get("commits")?.kind).toBe("flag");
        expect(merged.sources.get("repo")?.kind).toBe("default");
    });

    it("names options after their source", () => {
        expect(optionLabel("maxCommits", { kind: "flag" })).toBe("--max-commits");
        expect(optionLabel("visibility", { kind: "flag" })).toBe("--public/--private");
        expect(
            optionLabel("frequency", { kind: "file", detail: "/a/b/retrocommit.config.yaml" })
        ).toBe('"frequency" in retrocommit.config.yaml');
        expect(optionLabel("commits", { kind: "preset", detail: "intense" })).toBe(
            '"commits" (preset intense)'
        );
    });
});

describe("resolveOptions", () => {
    it("uses sensible defaults", async () => {
        const options = await resolve({ seed: "1" });
        expect(formatDay(options.from)).toBe("2023-06-15");
        expect(formatDay(options.to)).toBe("2024-06-15");
        expect(options.schedule.commits).toEqual({ min: 1, max: 5 });
        expect(options.schedule.frequency).toBe(100);
        expect(options.schedule.weekdays.size).toBe(7);
        expect(options.time).toEqual({ start: 9 * 3600, end: 21 * 3600 });
        expect(options.nowSecondOfDay).toBe(12 * 3600);
        expect(options.repo).toBe("activity-log");
        expect(options.visibility).toBe("private");
        expect(options.topics).toEqual(["retrocommit"]);
        expect(options.readme).toBe(defaultReadme("activity-log"));
        expect(options.contentPath).toBe("activity.log");
        expect(options.endpoints.apiUrl).toBe("https://api.github.com");
        expect(options.push).toBe(true);
        expect(options.output).toBeUndefined();
        expect(options.seed).toBe("1");
    });

    it("generates a seed when none is given", async () => {
        expect((await resolve({})).seed).toMatch(/^\d{6}$/);
    });

    it("expands years and never goes past today", async () => {
        const past = await resolve({ year: 2023 });
        expect([formatDay(past.from), formatDay(past.to)]).toEqual(["2023-01-01", "2023-12-31"]);
        const current = await resolve({ year: 2024 });
        expect(formatDay(current.to)).toBe("2024-06-15");
        expect(await problems({ year: 2025 })).toMatch(/in the future/);
        const future = await resolve({ year: 2025, allowFuture: true });
        expect(formatDay(future.to)).toBe("2025-12-31");
    });

    it("rejects future end dates unless allowed", async () => {
        expect(await problems({ to: "2024-07-01" })).toMatch(/--allow-future/);
        expect(formatDay((await resolve({ to: "2024-07-01", allowFuture: true })).to)).toBe(
            "2024-07-01"
        );
    });

    it("reports every problem at once, naming the flag", async () => {
        const text = await problems({ commits: "5-1", frequency: 200, days: "funday" });
        expect(text).toMatch(/Found 3 problems/);
        expect(text).toMatch(/--commits: the minimum \(5\) is greater than the maximum \(1\)/);
        expect(text).toMatch(/--frequency: "200" must be a number between 0 and 100/);
        expect(text).toMatch(/--days: "funday" is not a day/);
    });

    it("names the config file in its errors", async () => {
        expect(await problems({}, { file: { commits: "abc" } })).toMatch(
            /"commits" in retrocommit\.config\.json/
        );
    });

    it("detects contradictory options", async () => {
        expect(await problems({ year: 2023, from: "2023-02-01" })).toMatch(
            /can't be used together/
        );
        expect(await problems({ text: "HI", pattern: "x.txt" })).toMatch(
            /either a text or a pattern/
        );
        expect(await problems({ remote: "git@github.com:a/b.git", owner: "acme" })).toMatch(
            /can't be used together/
        );
        expect(await problems({ from: "2024-05-01", to: "2024-04-01" })).toMatch(/is after/);
    });

    it("validates names, paths and URLs", async () => {
        const text = await problems({
            repo: "bad name",
            branch: "feature..x",
            topics: "Bad Topic",
            remote: "ext::sh -c touch% /tmp/pwned",
            contentPath: "../escape",
            authorEmail: "not-an-email",
            timezone: "Nowhere/Land"
        });
        expect(text).toMatch(/--repo/);
        expect(text).toMatch(/--branch/);
        expect(text).toMatch(/--topics/);
        expect(text).toMatch(/--remote: .*isn't allowed/);
        expect(text).toMatch(/--content-path/);
        expect(text).toMatch(/--author-email/);
        expect(text).toMatch(/--timezone/);
    });

    it("draws text centered in the last 52 weeks and warns about ignored options", async () => {
        const options = await resolve({ text: "HI", commits: "3" });
        expect(options.art?.kind).toBe("text");
        expect(options.art?.window.weeks).toBe(52);
        expect(options.from).toBe(options.art?.window.first);
        expect(options.to).toBe(options.art?.window.last);
        expect(Math.max(...(options.art?.targets.values() ?? []))).toBe(12);
        expect(options.warnings.join()).toMatch(/--commits is ignored/);
    });

    it("draws inside a specific year", async () => {
        const options = await resolve({ text: "HI", year: 2023, intensity: 20 });
        expect(formatDay(options.from)).toBe("2023-01-01");
        expect(Math.max(...(options.art?.targets.values() ?? []))).toBe(20);
    });

    it("refuses drawings that don't fit", async () => {
        expect(await problems({ text: "HELLO WORLD, THIS IS TOO LONG" })).toMatch(
            /needs \d+ weeks/
        );
    });

    it("reads message, pattern and README files", async () => {
        const cwd = await dir();
        await writeFile(join(cwd, "messages.txt"), "# comment\nWork on {date}\nMore work\n");
        await writeFile(join(cwd, "art.txt"), "#.#\n.#.\n#.#\n");
        await writeFile(join(cwd, "README.md"), "# Custom\n");
        const options = await resolve({
            messagesFile: join(cwd, "messages.txt"),
            pattern: join(cwd, "art.txt"),
            readme: join(cwd, "README.md")
        });
        expect(options.messages).toEqual(["Work on {date}", "More work"]);
        expect(options.art?.kind).toBe("pattern");
        expect(options.art?.label).toBe("art.txt");
        expect(options.readme).toBe("# Custom\n");

        expect(await problems({ messagesFile: join(cwd, "missing.txt") })).toMatch(
            /messages file not found/
        );
    });

    it("disables the README and checks it doesn't clash with the log file", async () => {
        expect((await resolve({ readme: false })).readme).toBeUndefined();
        expect(await problems({ contentPath: "README.md" })).toMatch(/can't be README\.md/);
        expect((await resolve({ content: "daily" })).contentPath).toBe("activity");
    });

    it("keeps a local copy by default with --no-push and checks the directory", async () => {
        const cwd = await dir();
        const options = await resolve({ push: false, repo: "history" }, { cwd });
        expect(options.output).toBe(join(cwd, "history"));

        await mkdir(join(cwd, "busy"));
        await writeFile(join(cwd, "busy", "file.txt"), "x");
        expect(await problems({ push: false, output: "busy" }, { cwd })).toMatch(/not empty/);
    });

    it("supports GitHub Enterprise hosts", async () => {
        const options = await resolve({ host: "github.acme.com" });
        expect(options.endpoints).toMatchObject({
            host: "github.acme.com",
            apiUrl: "https://github.acme.com/api/v3",
            graphqlUrl: "https://github.acme.com/api/graphql"
        });
    });
});

describe("config files", () => {
    it("loads JSON and YAML, resolving paths next to the file", async () => {
        const cwd = await dir();
        await writeFile(
            join(cwd, "retrocommit.config.json"),
            JSON.stringify({ $schema: "x", commits: "2-4", messagesFile: "msgs.txt" })
        );
        const json = await loadConfigFile(join(cwd, "retrocommit.config.json"));
        expect(json.values.commits).toBe("2-4");
        expect(json.values.messagesFile).toBe(join(cwd, "msgs.txt"));

        await writeFile(join(cwd, ".retrocommitrc.yaml"), "frequency: 80\ndays: [mon, tue]\n");
        const yaml = await loadConfigFile(join(cwd, ".retrocommitrc.yaml"));
        expect(yaml.values).toEqual({ frequency: 80, days: ["mon", "tue"] });

        await writeFile(join(cwd, "empty.yml"), "");
        expect((await loadConfigFile(join(cwd, "empty.yml"))).values).toEqual({});
    });

    it("finds config files in the working directory", async () => {
        const cwd = await dir();
        expect(await findConfigFile(cwd)).toBeUndefined();
        await writeFile(join(cwd, "retrocommit.config.yml"), "commits: 3\n");
        expect(await findConfigFile(cwd)).toBe(join(cwd, "retrocommit.config.yml"));
    });

    it("explains invalid files", async () => {
        const cwd = await dir();
        const write = (name: string, text: string) => writeFile(join(cwd, name), text);

        await write("typo.json", JSON.stringify({ commmits: 3, frequency: "high" }));
        const typo = (await loadConfigFile(join(cwd, "typo.json")).catch(
            (error: ConfigError) => error
        )) as ConfigError;
        expect(typo.details.join("\n")).toMatch(
            /Unknown option "commmits" \(did you mean "commits"\?\)/
        );
        expect(typo.details.join("\n")).toMatch(/"frequency": must be a number between 0 and 100/);

        await write("secret.yaml", "token: ghp_123\n");
        await expect(loadConfigFile(join(cwd, "secret.yaml"))).rejects.toThrow(/isn't allowed/);

        await write("broken.json", "{ nope");
        await expect(loadConfigFile(join(cwd, "broken.json"))).rejects.toThrow(/not valid JSON/);

        await write("broken.yaml", "a: [1, 2\n");
        await expect(loadConfigFile(join(cwd, "broken.yaml"))).rejects.toThrow(/not valid YAML/);

        await write("list.yaml", "- 1\n- 2\n");
        await expect(loadConfigFile(join(cwd, "list.yaml"))).rejects.toThrow(
            /must contain an object/
        );

        await expect(loadConfigFile(join(cwd, "missing.json"))).rejects.toThrow(/not found/);
    });

    it("suggests close option names", () => {
        expect(suggest("frequncy", ["frequency", "from"])).toBe("frequency");
        expect(suggest("max-commits", ["maxCommits"])).toBe("maxCommits");
        expect(suggest("zzzzzz", ["frequency"])).toBeUndefined();
    });
});
