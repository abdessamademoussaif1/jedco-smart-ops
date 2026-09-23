import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { generateCommits } from "../../src/core/commits.ts";
import { formatDay } from "../../src/core/dates.ts";
import { buildPlan } from "../../src/core/planner.ts";
import { resolveZone } from "../../src/core/timezone.ts";
import { GitError } from "../../src/errors.ts";
import { type GitVersion, getGitVersion, runGit, tryGit } from "../../src/git/exec.ts";
import { type ContentMode, fastImportStream, runFastImport } from "../../src/git/fast-import.ts";
import {
    checkoutWorktree,
    countCommits,
    fetchBranch,
    initRepository,
    listRemoteBranches,
    pushBranch,
    type RemoteContext
} from "../../src/git/repository.ts";
import { d, tempDir } from "../helpers.ts";

const zone = resolveZone("America/Mexico_City");
const time = { start: 9 * 3600, end: 21 * 3600 };
const author = { name: "Test User", email: "123+test@users.noreply.github.com" };

function makePlan(seed: string, from = "2024-01-01", to = "2024-01-20") {
    return buildPlan({
        from: d(from),
        to: d(to),
        seed,
        fill: "all",
        schedule: {
            commits: { min: 1, max: 4 },
            distribution: "uniform",
            frequency: 80,
            weekdays: new Set([0, 1, 2, 3, 4, 5, 6]),
            weights: [1, 1, 1, 1, 1, 1, 1],
            exclude: []
        },
        time,
        today: d("2030-01-01"),
        nowSecondOfDay: 0,
        allowFuture: false
    });
}

async function generate(
    directory: string,
    seed: string,
    content: ContentMode = "single",
    extra: { parent?: string; readme?: string; from?: string; to?: string } = {}
) {
    const plan = makePlan(seed, extra.from, extra.to);
    const commits = generateCommits(plan, { zone, time, message: "Commit {n}/{count} on {date}" });
    await runFastImport(
        directory,
        fastImportStream(commits, {
            branch: "main",
            author,
            content,
            contentPath: content === "daily" ? "activity" : "activity.log",
            readme: extra.readme,
            parent: extra.parent
        })
    );
    return plan;
}

let version: GitVersion;
const cleanups: Array<() => Promise<void>> = [];

beforeAll(async () => {
    version = await getGitVersion();
});

afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()?.();
});

async function newDir(): Promise<string> {
    const dir = await tempDir();
    cleanups.push(dir.cleanup);
    return dir.path;
}

describe("generating history with git fast-import", () => {
    it("creates the planned commits with exact dates, time zones and author", async () => {
        const directory = await newDir();
        await initRepository(directory, "main");
        const plan = await generate(directory, "dates", "single", { readme: "# Activity\n" });

        expect(await countCommits(directory)).toBe(plan.total);

        const { stdout } = await runGit(
            ["log", "--reverse", "--format=%ad|%cd|%an|%ae|%s", "--date=format:%Y-%m-%d %z"],
            { cwd: directory }
        );
        const lines = stdout.trim().split("\n");
        const perDay = new Map<string, number>();
        for (const line of lines) {
            const [authorDate = "", committerDate = "", name, email] = line.split("|");
            expect(authorDate).toBe(committerDate);
            expect(name).toBe(author.name);
            expect(email).toBe(author.email);
            expect(authorDate.endsWith("-0600")).toBe(true);
            const date = authorDate.slice(0, 10);
            perDay.set(date, (perDay.get(date) ?? 0) + 1);
        }
        for (const day of plan.days) {
            expect(perDay.get(formatDay(day.day)) ?? 0).toBe(day.count);
        }

        const head = await runGit(["symbolic-ref", "HEAD"], { cwd: directory });
        expect(head.stdout.trim()).toBe("refs/heads/main");

        const firstCommitFiles = await runGit(
            ["show", "--name-only", "--format=", `HEAD~${plan.total - 1}`],
            { cwd: directory }
        );
        expect(firstCommitFiles.stdout).toContain("README.md");
        const lastCommitFiles = await runGit(["show", "--name-only", "--format=", "HEAD"], {
            cwd: directory
        });
        expect(lastCommitFiles.stdout.trim()).toBe("activity.log");
    });

    it("fills the working tree when asked", async () => {
        const directory = await newDir();
        await initRepository(directory, "main");
        await generate(directory, "worktree", "daily", { readme: "# Hi\n" });
        await checkoutWorktree(directory);

        // git may check files out with CRLF (core.autocrlf on Windows), so compare with LF.
        const readText = async (file: string) =>
            (await readFile(join(directory, file), "utf8")).replaceAll("\r\n", "\n");

        const status = await runGit(["status", "--porcelain"], { cwd: directory });
        expect(status.stdout.trim()).toBe("");
        expect(await readText("README.md")).toBe("# Hi\n");
        const files = await runGit(["ls-tree", "-r", "--name-only", "HEAD"], { cwd: directory });
        const logs = files.stdout
            .trim()
            .split("\n")
            .filter((file) => file.startsWith("activity/"));
        expect(logs.length).toBeGreaterThan(0);
        for (const file of logs) expect(file).toMatch(/^activity\/2024\/01\/2024-01-\d{2}\.md$/);
        const firstLog = await readText(logs[0] ?? "");
        expect(firstLog).toMatch(/^# Activity on 2024-01-\d{2}\n\n- \d{2}:\d{2}:\d{2} Commit 1\//);
    });

    it("can create empty commits", async () => {
        const directory = await newDir();
        await initRepository(directory, "trunk");
        const plan = await generateOnBranch(directory, "trunk");
        expect(await countCommits(directory)).toBe(plan.total);
        const files = await runGit(["ls-tree", "-r", "--name-only", "HEAD"], { cwd: directory });
        expect(files.stdout.trim()).toBe("");
    });

    it("reports fast-import failures", async () => {
        const directory = await newDir();
        await initRepository(directory, "main");
        await expect(runFastImport(directory, ["this is not a command\n"])).rejects.toBeInstanceOf(
            GitError
        );
        expect(await tryGit(["rev-parse", "--verify", "HEAD"], { cwd: directory })).toMatchObject({
            code: 128
        });
    });
});

async function generateOnBranch(directory: string, branch: string) {
    const plan = makePlan("empty");
    await runFastImport(
        directory,
        fastImportStream(generateCommits(plan, { zone, time, message: "empty {i}" }), {
            branch,
            author,
            content: "empty",
            contentPath: "unused"
        })
    );
    return plan;
}

describe("remotes", () => {
    async function setup() {
        const remoteDir = await newDir();
        await runGit(["init", "--bare", "--quiet", remoteDir]);
        const url = pathToFileURL(remoteDir).href;
        const directory = await newDir();
        await initRepository(directory, "main");
        const context: RemoteContext = {
            directory,
            url,
            auth: { kind: "system", interactive: false },
            version
        };
        return { remoteDir, url, directory, context };
    }

    it("pushes, lists branches, appends and replaces", async () => {
        const { remoteDir, url, directory, context } = await setup();

        expect((await listRemoteBranches(context)).size).toBe(0);

        const first = await generate(directory, "first", "single", { readme: "# R\n" });
        await pushBranch(context, { branch: "main" });
        const branches = await listRemoteBranches(context);
        expect([...branches.keys()]).toEqual(["main"]);
        expect(await countCommits(remoteDir, "main")).toBe(first.total);

        // Append: a fresh local repository that builds on top of the remote branch.
        const appendDir = await newDir();
        await initRepository(appendDir, "main");
        const appendContext = { ...context, directory: appendDir };
        const parent = await fetchBranch(appendContext, "main");
        const second = await generate(appendDir, "second", "single", {
            parent: `${parent}^0`,
            from: "2023-06-01",
            to: "2023-06-10"
        });
        await pushBranch(appendContext, { branch: "main" });
        expect(await countCommits(remoteDir, "main")).toBe(first.total + second.total);

        // A non-fast-forward push without force is rejected with a helpful hint.
        const conflictDir = await newDir();
        await initRepository(conflictDir, "main");
        await generate(conflictDir, "conflict");
        const conflictContext = { ...context, directory: conflictDir };
        await expect(pushBranch(conflictContext, { branch: "main" })).rejects.toMatchObject({
            hint: expect.stringMatching(/--if-exists/)
        });

        // Replace with a lease on the current remote head.
        const expectedSha = (await listRemoteBranches(conflictContext)).get("main");
        await pushBranch(conflictContext, { branch: "main", force: true, expectedSha });
        expect(await countCommits(remoteDir, "main")).toBe(await countCommits(conflictDir));

        // A stale lease refuses to overwrite.
        const staleDir = await newDir();
        await initRepository(staleDir, "main");
        await generate(staleDir, "stale");
        await expect(
            pushBranch(
                { ...context, directory: staleDir },
                { branch: "main", force: true, expectedSha: "0".repeat(40) }
            )
        ).rejects.toBeInstanceOf(GitError);
        expect(url.startsWith("file:")).toBe(true);
    });

    it("never leaks tokens in errors", async () => {
        const directory = await newDir();
        await initRepository(directory, "main");
        const context: RemoteContext = {
            directory,
            url: "https://127.0.0.1:1/owner/repo.git",
            auth: { kind: "token", token: "ghp_SuperSecretToken123", host: "127.0.0.1:1" },
            version
        };
        const error = await listRemoteBranches(context).catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(GitError);
        const text = JSON.stringify({
            message: (error as GitError).message,
            details: (error as GitError).details,
            stderr: (error as GitError).stderr
        });
        expect(text).not.toContain("ghp_SuperSecretToken123");
        expect(text).not.toContain(
            Buffer.from("x-access-token:ghp_SuperSecretToken123").toString("base64")
        );
    });
});
