/**
 * End-to-end test of the GitHub flow without touching github.com: a fake GitHub API runs on
 * localhost, and git rewrites the push URL (https://fake.test/…) to local bare repositories
 * through `url.<base>.insteadOf`. The CLI under test is the real bundled one.
 */
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runGit } from "../../src/git/exec.ts";
import { tempDir } from "../helpers.ts";

const CLI = join(import.meta.dirname, "..", "..", "dist", "cli.js");
const TOKEN = "ghp_e2eFakeTokenForTests1234567890";
const HOST = "fake.test";

interface FakeRepo {
    name: string;
    private: boolean;
    description: string;
    topics: string[];
    defaultBranch: string;
}

const repos = new Map<string, FakeRepo>();
const requests: string[] = [];
let remotesDir = "";
let server: Server;
let apiUrl = "";
let cleanup: () => Promise<void>;

function repoJson(repo: FakeRepo) {
    return {
        name: repo.name,
        full_name: `octo/${repo.name}`,
        owner: { login: "octo" },
        private: repo.private,
        default_branch: repo.defaultBranch,
        size: 0,
        topics: repo.topics,
        html_url: `https://${HOST}/octo/${repo.name}`,
        fork: false,
        archived: false,
        permissions: { push: true, admin: true },
        created_at: "2020-01-01T00:00:00Z"
    };
}

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const text = Buffer.concat(chunks).toString("utf8");
    return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

function send(
    response: ServerResponse,
    status: number,
    body?: unknown,
    headers: Record<string, string> = {}
) {
    response.writeHead(status, { "content-type": "application/json", ...headers });
    response.end(body === undefined ? undefined : JSON.stringify(body));
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", "http://localhost");
    const method = request.method ?? "GET";
    const body = await readBody(request);
    requests.push(`${method} ${url.pathname}`);

    if (request.headers.authorization !== `Bearer ${TOKEN}`) {
        return send(response, 401, { message: "Bad credentials" });
    }
    if (method === "GET" && url.pathname === "/user") {
        return send(
            response,
            200,
            { login: "octo", id: 42, name: "Octo Cat", created_at: "2010-01-01T00:00:00Z" },
            { "x-oauth-scopes": "repo, delete_repo" }
        );
    }
    if (method === "GET" && url.pathname === "/rate_limit") {
        return send(response, 200, {
            resources: { core: { limit: 5000, remaining: 4990, reset: 1 } }
        });
    }
    if (method === "GET" && url.pathname === "/user/emails") return send(response, 200, []);
    if (method === "POST" && url.pathname === "/user/repos") {
        const name = String(body.name);
        if (repos.has(name)) return send(response, 422, { message: "name already exists" });
        const repo: FakeRepo = {
            name,
            private: Boolean(body.private),
            description: String(body.description ?? ""),
            topics: [],
            defaultBranch: "main"
        };
        repos.set(name, repo);
        const path = join(remotesDir, "octo", `${name}.git`);
        mkdirSync(path, { recursive: true });
        execFileSync("git", ["init", "--bare", "--quiet", path]);
        return send(response, 201, repoJson(repo));
    }
    if (method === "POST" && url.pathname === "/graphql") {
        const variables = body.variables as { from: string; to: string };
        const days = [];
        for (
            let day = new Date(`${variables.from.slice(0, 10)}T00:00:00Z`);
            day <= new Date(variables.to);
            day = new Date(day.getTime() + 86_400_000)
        ) {
            // The fake user contributed every third day.
            const count = day.getUTCDate() % 3 === 0 ? 4 : 0;
            days.push({ date: day.toISOString().slice(0, 10), contributionCount: count });
        }
        return send(response, 200, {
            data: {
                user: {
                    contributionsCollection: {
                        contributionCalendar: { weeks: [{ contributionDays: days }] }
                    }
                }
            }
        });
    }

    const match = /^\/repos\/octo\/([^/]+)(\/topics)?$/.exec(url.pathname);
    const repo = match ? repos.get(decodeURIComponent(match[1] ?? "")) : undefined;
    if (match && !repo) return send(response, 404, { message: "Not Found" });
    if (repo && match?.[2] && method === "PUT") {
        repo.topics = (body.names as string[]) ?? [];
        return send(response, 200, { names: repo.topics });
    }
    if (repo && method === "GET") return send(response, 200, repoJson(repo));
    if (repo && method === "PATCH") {
        if (typeof body.default_branch === "string") repo.defaultBranch = body.default_branch;
        return send(response, 200, repoJson(repo));
    }
    if (repo && method === "DELETE") {
        repos.delete(repo.name);
        return send(response, 204);
    }
    return send(response, 404, { message: `No fake route for ${method} ${url.pathname}` });
}

interface Result {
    code: number | null;
    stdout: string;
    stderr: string;
}

function spawnCli(args: string[], env: NodeJS.ProcessEnv): Promise<Result> {
    return new Promise((resolve) => {
        const child = spawn(process.execPath, [CLI, ...args], {
            env,
            stdio: ["ignore", "pipe", "pipe"]
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk: Buffer) => {
            stdout += chunk.toString();
        });
        child.stderr.on("data", (chunk: Buffer) => {
            stderr += chunk.toString();
        });
        child.on("close", (code) => resolve({ code, stdout, stderr }));
    });
}

function environment(token = TOKEN): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {
        ...process.env,
        NO_COLOR: "1",
        RETROCOMMIT_TOKEN: token,
        // Pushes to https://fake.test/octo/<repo>.git land in local bare repositories.
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: `url.${pathToFileURL(remotesDir).href}/.insteadOf`,
        GIT_CONFIG_VALUE_0: `https://${HOST}/`
    };
    delete env.GH_TOKEN;
    delete env.GITHUB_TOKEN;
    return env;
}

/** Runs `retrocommit [args]` against the fake GitHub. */
function cli(args: string[], token = TOKEN): Promise<Result> {
    return spawnCli(["--host", HOST, "--api-url", apiUrl, ...args], environment(token));
}

/** Runs `retrocommit <name> [args]` (subcommand options go after its name). */
function command(name: string, args: string[]): Promise<Result> {
    return spawnCli([name, "--host", HOST, "--api-url", apiUrl, ...args], environment());
}

async function remoteCount(name: string): Promise<number> {
    const { stdout } = await runGit(["rev-list", "--count", "main"], {
        cwd: join(remotesDir, "octo", `${name}.git`)
    });
    return Number(stdout.trim());
}

beforeAll(async () => {
    const dir = await tempDir("retrocommit-github-");
    cleanup = dir.cleanup;
    remotesDir = dir.path;
    server = createServer((request, response) => {
        handle(request, response).catch((error: unknown) =>
            send(response, 500, { message: String(error) })
        );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    apiUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await cleanup();
});

describe("GitHub flow (fake API)", () => {
    const period = ["--from", "2024-01-01", "--to", "2024-01-31", "--timezone", "UTC"];

    it("creates a private repository, tags it and pushes the commits", async () => {
        const result = await cli([...period, "-c", "2", "--yes", "--json"]);
        expect(result.stderr).toBe("");
        expect(result.code).toBe(0);
        const body = JSON.parse(result.stdout) as {
            commits: number;
            repository: { fullName: string; created: boolean; visibility: string };
        };
        expect(body.commits).toBe(62);
        expect(body.repository).toMatchObject({
            fullName: "octo/activity-log",
            created: true,
            visibility: "private"
        });
        expect(repos.get("activity-log")).toMatchObject({ private: true, topics: ["retrocommit"] });
        expect(await remoteCount("activity-log")).toBe(62);

        const { stdout } = await runGit(["log", "-1", "--format=%an <%ae>", "main"], {
            cwd: join(remotesDir, "octo", "activity-log.git")
        });
        expect(stdout.trim()).toBe("Octo Cat <42+octo@users.noreply.fake.test>");
        expect(requests).toContain("POST /user/repos");
        expect(requests).toContain("PUT /repos/octo/activity-log/topics");
    });

    it("refuses to touch a repository with commits unless told how", async () => {
        const result = await cli([...period, "-c", "1", "--yes", "--json"]);
        expect(result.code).toBe(1);
        expect(JSON.parse(result.stdout).error.message).toContain("already has commits");
    });

    it("appends to and replaces repositories created by retrocommit", async () => {
        const appended = await cli([
            "--from",
            "2024-02-01",
            "--to",
            "2024-02-10",
            "-c",
            "1",
            "--timezone",
            "UTC",
            "--if-exists",
            "append",
            "--yes",
            "-q"
        ]);
        expect(appended.code).toBe(0);
        expect(await remoteCount("activity-log")).toBe(72);

        const replaced = await cli([
            "--from",
            "2024-03-01",
            "--to",
            "2024-03-05",
            "-c",
            "1",
            "--timezone",
            "UTC",
            "--if-exists",
            "replace",
            "--yes",
            "-q"
        ]);
        expect(replaced.code).toBe(0);
        expect(await remoteCount("activity-log")).toBe(5);
    });

    it("only fills the days without contributions", async () => {
        const result = await cli([...period, "-c", "2", "--fill", "gaps", "--dry-run", "--json"]);
        expect(result.code).toBe(0);
        const plan = JSON.parse(result.stdout) as {
            days: Array<{ date: string; commits: number; existing: number }>;
        };
        for (const day of plan.days) {
            expect(day.commits).toBe(day.existing > 0 ? 0 : 2);
        }
        expect(plan.days.filter((day) => day.existing > 0)).toHaveLength(10);
    });

    it("draws the real graph and runs the doctor", async () => {
        const graph = await command("graph", [
            "--from",
            "2024-01-01",
            "--to",
            "2024-01-31",
            "--json"
        ]);
        expect(graph.code).toBe(0);
        expect(JSON.parse(graph.stdout)).toMatchObject({ user: "octo", total: 40, activeDays: 10 });

        const doctor = await command("doctor", ["--json"]);
        const checks = JSON.parse(doctor.stdout).checks as Array<{
            name: string;
            status: string;
            detail: string;
        }>;
        expect(checks.find((check) => check.name === "GitHub account")?.detail).toContain("octo");
        expect(checks.find((check) => check.name === "Scope: repo")?.status).toBe("ok");
    });

    it("deletes repositories created by retrocommit", async () => {
        const result = await command("delete", ["activity-log", "--yes", "--json"]);
        expect(result.code).toBe(0);
        expect(JSON.parse(result.stdout)).toEqual({ ok: true, deleted: "octo/activity-log" });
        expect(repos.has("activity-log")).toBe(false);

        const missing = await command("delete", ["activity-log", "--yes"]);
        expect(missing.code).toBe(1);
        expect(missing.stderr).toContain("doesn't exist");
    });

    it("rejects an invalid token clearly", async () => {
        const result = await cli([...period, "--yes"], "ghp_wrongTokenwrongTokenwrongToken");
        expect(result.code).toBe(1);
        expect(result.stderr).toContain("401 Bad credentials");
        expect(result.stderr).toContain("RETROCOMMIT_TOKEN");
        expect(result.stderr).not.toContain("ghp_wrongToken");
    });
});
