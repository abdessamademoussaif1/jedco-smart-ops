import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { runGit } from "../../src/git/exec.ts";
import { tempDir } from "../helpers.ts";

const CLI = join(import.meta.dirname, "..", "..", "dist", "cli.js");
const AUTHOR = ["--author-name", "Test User", "--author-email", "test@example.com"];

// A `gh` that is never logged in, so the developer's GitHub CLI session doesn't leak into the
// tests. Windows doesn't run extensionless files, but CI runners aren't logged in to gh anyway.
const noGh = await tempDir("retrocommit-no-gh-");
await writeFile(join(noGh.path, "gh"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
afterAll(() => noGh.cleanup());

interface Result {
    code: number;
    stdout: string;
    stderr: string;
}

function cli(args: string[], options: { cwd?: string; env?: Record<string, string> } = {}): Result {
    const env: NodeJS.ProcessEnv = {
        ...process.env,
        NO_COLOR: "1",
        COLUMNS: "120",
        ...options.env
    };
    for (const name of ["RETROCOMMIT_TOKEN", "GH_TOKEN", "GITHUB_TOKEN", "FORCE_COLOR"])
        delete env[name];
    if (process.platform !== "win32") env.PATH = `${noGh.path}${delimiter}${env.PATH ?? ""}`;
    const result = spawnSync(process.execPath, [CLI, ...args], {
        cwd: options.cwd,
        env,
        encoding: "utf8",
        input: "",
        timeout: 60_000
    });
    return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

function json<T = Record<string, unknown>>(result: Result): T {
    return JSON.parse(result.stdout) as T;
}

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()?.();
});
async function dir(): Promise<string> {
    const created = await tempDir("retrocommit-e2e-");
    cleanups.push(created.cleanup);
    return created.path;
}

describe("basics", () => {
    it("prints the version and help", () => {
        const version = cli(["--version"]);
        expect(version.code).toBe(0);
        expect(version.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);

        const help = cli(["--help"]);
        expect(help.code).toBe(0);
        for (const section of [
            "Date range:",
            "Schedule:",
            "Drawing:",
            "Repository:",
            "Commands:",
            "Examples:"
        ]) {
            expect(help.stdout).toContain(section);
        }
        expect(cli(["preview", "--help"]).stdout).toContain("--commits");
    });

    it("shows help (exit 2) when started without arguments outside a terminal", () => {
        const result = cli([]);
        expect(result.code).toBe(2);
        expect(result.stdout).toContain("Usage: retrocommit");
    });

    it("suggests the right command after a typo", () => {
        const result = cli(["prevew"]);
        expect(result.code).toBe(2);
        expect(result.stderr).toContain("Did you mean `retrocommit preview`?");
    });

    it("rejects unknown flags", () => {
        const result = cli(["--frequncy", "3"]);
        expect(result.code).toBe(2);
        expect(result.stderr).toMatch(/unknown option '--frequncy'/);
        expect(result.stderr).toMatch(/Did you mean --frequency\?/);
    });
});

describe("preview", () => {
    it("prints a deterministic plan as JSON", () => {
        const args = [
            "preview",
            "--from",
            "2024-01-01",
            "--to",
            "2024-03-31",
            "-c",
            "1-6",
            "--seed",
            "e2e",
            "--timezone",
            "UTC",
            "--json"
        ];
        const first = cli(args);
        expect(first.code).toBe(0);
        const plan = json<{ totalCommits: number; days: Array<{ date: string; commits: number }> }>(
            first
        );
        expect(plan.days).toHaveLength(91);
        expect(plan.totalCommits).toBe(plan.days.reduce((sum, day) => sum + day.commits, 0));
        expect(cli(args).stdout).toBe(first.stdout);
    });

    it("draws the graph and summary in plain mode", () => {
        const result = cli(["preview", "--text", "HI", "--timezone", "UTC", "--ascii"]);
        expect(result.code).toBe(0);
        expect(result.stdout).toContain('Drawing      text "HI"');
        expect(result.stdout).toContain("Mon");
        expect(result.stdout).toContain("Less . - + * # More");
        expect(result.stdout).toContain("Preview only, nothing was created");
    });

    it("reports every invalid option at once", () => {
        const result = cli([
            "preview",
            "--commits",
            "9-1",
            "--frequency",
            "120",
            "--days",
            "someday"
        ]);
        expect(result.code).toBe(2);
        expect(result.stderr).toContain("Found 3 problems");
        expect(result.stderr).toContain("--commits");
        expect(result.stderr).toContain("--frequency");
        expect(result.stderr).toContain("--days");
    });

    it("returns errors as JSON with --json", () => {
        const result = cli(["preview", "--from", "2098-01-01", "--json"]);
        expect(result.code).toBe(2);
        const body = json<{ ok: boolean; error: { message: string } }>(result);
        expect(body.ok).toBe(false);
        expect(body.error.message).toMatch(/in the future/);
    });

    it("reads a config file from the working directory", async () => {
        const cwd = await dir();
        await writeFile(
            join(cwd, "retrocommit.config.yaml"),
            "commits: 2\nfrom: 2024-05-01\nto: 2024-05-07\n"
        );
        const result = cli(["preview", "--json", "--seed", "1"], { cwd });
        expect(result.code).toBe(0);
        const plan = json<{ totalCommits: number; days: Array<{ commits: number }> }>(result);
        expect(plan.days).toHaveLength(7);
        expect(plan.days.every((day) => day.commits === 2)).toBe(true);
        expect(cli(["preview", "--json", "--no-config", "--seed", "1"], { cwd }).code).toBe(0);
    });

    it("needs a token to read the real graph", () => {
        const result = cli(["preview", "--fill", "gaps"]);
        expect(result.code).toBe(2);
        expect(result.stderr).toContain("A GitHub token is needed");
        expect(result.stderr).toContain("RETROCOMMIT_TOKEN");
    });
});

describe("creating repositories", () => {
    it("generates a local repository", async () => {
        const output = join(await dir(), "history");
        const result = cli([
            "--no-push",
            "-o",
            output,
            "--from",
            "2024-02-01",
            "--to",
            "2024-02-29",
            "-c",
            "1-3",
            "--seed",
            "local",
            "--timezone",
            "+02:00",
            "--yes",
            "--json",
            ...AUTHOR
        ]);
        expect(result.code).toBe(0);
        const body = json<{ ok: boolean; commits: number; output: string }>(result);
        expect(body.ok).toBe(true);
        expect(body.output).toBe(output);

        const count = await runGit(["rev-list", "--count", "HEAD"], { cwd: output });
        expect(Number(count.stdout.trim())).toBe(body.commits);
        const dates = await runGit(["log", "--format=%ad", "--date=format:%z"], { cwd: output });
        expect(new Set(dates.stdout.trim().split("\n"))).toEqual(new Set(["+0200"]));
        expect(existsSync(join(output, "README.md"))).toBe(true);
    });

    it("refuses to continue without --yes outside a terminal, leaving nothing behind", async () => {
        const output = join(await dir(), "nope");
        const result = cli(["--no-push", "-o", output, ...AUTHOR]);
        expect(result.code).toBe(2);
        expect(result.stderr).toContain("--yes");
        expect(existsSync(output)).toBe(false);
    });

    it("pushes to a remote, and handles fail / append / replace", async () => {
        const remote = join(await dir(), "remote.git");
        await runGit(["init", "--bare", "--quiet", remote]);
        const url = pathToFileURL(remote).href;
        const base = ["--remote", url, "--yes", "--json", "--timezone", "UTC", ...AUTHOR];
        const count = async () =>
            Number((await runGit(["rev-list", "--count", "main"], { cwd: remote })).stdout.trim());

        const first = cli([...base, "--from", "2024-01-01", "--to", "2024-01-10", "-c", "2"]);
        expect(first.code).toBe(0);
        expect(await count()).toBe(20);

        const blocked = cli([...base, "--from", "2024-02-01", "--to", "2024-02-05", "-c", "1"]);
        expect(blocked.code).toBe(1);
        expect(json<{ error: { hint: string } }>(blocked).error.hint).toContain(
            "--if-exists append"
        );

        const appended = cli([
            ...base,
            "--from",
            "2024-02-01",
            "--to",
            "2024-02-05",
            "-c",
            "1",
            "--if-exists",
            "append"
        ]);
        expect(appended.code).toBe(0);
        expect(await count()).toBe(25);

        const unforced = cli([
            ...base,
            "--from",
            "2024-03-01",
            "--to",
            "2024-03-03",
            "-c",
            "1",
            "--if-exists",
            "replace"
        ]);
        expect(unforced.code).toBe(1);
        expect(await count()).toBe(25);

        const replaced = cli([
            ...base,
            "--from",
            "2024-03-01",
            "--to",
            "2024-03-03",
            "-c",
            "1",
            "--if-exists",
            "replace",
            "--force"
        ]);
        expect(replaced.code).toBe(0);
        expect(await count()).toBe(3);
    });
});

describe("other commands", () => {
    it("writes configuration files with init", async () => {
        const cwd = await dir();
        const yaml = cli(["init", "--defaults", "--format", "yaml"], { cwd });
        expect(yaml.code).toBe(0);
        const text = await readFile(join(cwd, "retrocommit.config.yaml"), "utf8");
        expect(text).toContain("yaml-language-server: $schema=");

        const jsonFile = cli(["init", "--defaults"], { cwd });
        expect(jsonFile.code).toBe(0);
        expect(
            JSON.parse(await readFile(join(cwd, "retrocommit.config.json"), "utf8")).$schema
        ).toMatch(/schema\.json$/);

        const again = cli(["init", "--defaults"], { cwd });
        expect(again.code).toBe(2);
        expect(again.stderr).toContain("already exists");
        expect(cli(["init", "--defaults", "--force"], { cwd }).code).toBe(0);

        // The generated template is a valid configuration.
        const preview = cli(["preview", "--config", "retrocommit.config.yaml", "--json"], { cwd });
        expect(preview.code).toBe(0);
    });

    it("needs a token for graph and delete", () => {
        for (const args of [["graph"], ["delete", "activity-log"]]) {
            const result = cli(args);
            expect(result.code).toBe(2);
            expect(result.stderr).toContain("A GitHub token is needed");
        }
    });

    it("runs doctor without a token", () => {
        const result = cli(["doctor", "--json"]);
        const body = json<{ ok: boolean; checks: Array<{ name: string; status: string }> }>(result);
        expect(body.checks.find((check) => check.name === "Git")?.status).toBe("ok");
        expect(body.checks.find((check) => check.name === "GitHub token")?.status).toBe("warn");
        expect(result.code).toBe(body.ok ? 0 : 1);
    });
});
