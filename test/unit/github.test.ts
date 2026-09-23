import { describe, expect, it, vi } from "vitest";
import { formatDay } from "../../src/core/dates.ts";
import { GitHubError } from "../../src/errors.ts";
import {
    checkTokenFormat,
    findToken,
    hasRepoScope,
    tokenCreationUrl
} from "../../src/github/auth.ts";
import { GitHubClient, resolveEndpoints, tokenKindOf } from "../../src/github/client.ts";
import { fetchContributions } from "../../src/github/contributions.ts";
import { d } from "../helpers.ts";

const TOKEN = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
    return new Response(status === 204 ? null : JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...headers }
    });
}

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

function client(handlers: Handler[], token = TOKEN) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const sleep = vi.fn(async (_ms: number) => {});
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        calls.push({ url, init: init ?? {} });
        const handler = handlers[Math.min(calls.length - 1, handlers.length - 1)];
        if (!handler) throw new Error("no handler");
        return handler(url, init ?? {});
    });
    const instance = new GitHubClient({
        token,
        endpoints: resolveEndpoints("github.com"),
        fetch: fetchMock as unknown as typeof fetch,
        sleep
    });
    return { instance, calls, sleep };
}

const repoJson = {
    name: "activity-log",
    full_name: "octo/activity-log",
    owner: { login: "octo" },
    private: true,
    default_branch: "main",
    size: 0,
    topics: ["retrocommit"],
    html_url: "https://github.com/octo/activity-log",
    fork: false,
    archived: false,
    permissions: { push: true, admin: true },
    created_at: "2024-01-01T00:00:00Z"
};

describe("resolveEndpoints", () => {
    it("knows github.com and GitHub Enterprise Server", () => {
        expect(resolveEndpoints()).toEqual({
            host: "github.com",
            apiUrl: "https://api.github.com",
            graphqlUrl: "https://api.github.com/graphql",
            webUrl: "https://github.com"
        });
        expect(resolveEndpoints("https://GHE.example.com/")).toEqual({
            host: "ghe.example.com",
            apiUrl: "https://ghe.example.com/api/v3",
            graphqlUrl: "https://ghe.example.com/api/graphql",
            webUrl: "https://ghe.example.com"
        });
        expect(resolveEndpoints("git.corp", "https://api.git.corp/").graphqlUrl).toBe(
            "https://api.git.corp/graphql"
        );
    });
});

describe("GitHubClient", () => {
    it("reads the viewer, its scopes and the token kind", async () => {
        const { instance, calls } = client([
            () =>
                json(
                    200,
                    { login: "octo", id: 42, name: "Octo Cat", created_at: "2015-05-05T00:00:00Z" },
                    { "x-oauth-scopes": "repo, read:org" }
                )
        ]);
        const viewer = await instance.getViewer();
        expect(viewer).toEqual({
            user: { login: "octo", id: 42, name: "Octo Cat", createdAt: "2015-05-05T00:00:00Z" },
            scopes: ["repo", "read:org"],
            tokenKind: "classic"
        });
        const headers = calls[0]?.init.headers as Record<string, string>;
        expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
        expect(headers["User-Agent"]).toMatch(/^retrocommit\//);
        expect(headers["X-GitHub-Api-Version"]).toBe("2022-11-28");
    });

    it("detects token kinds", () => {
        expect(tokenKindOf("github_pat_x", null)).toBe("fine-grained");
        expect(tokenKindOf("gho_x", ["repo"])).toBe("oauth");
        expect(tokenKindOf("0123abcd", ["repo"])).toBe("classic");
        expect(tokenKindOf("0123abcd", null)).toBe("unknown");
    });

    it("returns null for missing repositories and maps existing ones", async () => {
        const { instance } = client([
            () => json(404, { message: "Not Found" }),
            () => json(200, repoJson)
        ]);
        expect(await instance.getRepo("octo", "nope")).toBeNull();
        expect(await instance.getRepo("octo", "activity-log")).toMatchObject({
            fullName: "octo/activity-log",
            private: true,
            topics: ["retrocommit"],
            canPush: true
        });
    });

    it("creates repositories for users and organizations", async () => {
        const { instance, calls } = client([() => json(201, repoJson)]);
        await instance.createRepo({ name: "activity-log", description: "d", private: true });
        await instance.createRepo({
            name: "activity-log",
            description: "d",
            private: false,
            org: "acme"
        });
        expect(calls[0]?.url).toBe("https://api.github.com/user/repos");
        expect(calls[0]?.init.method).toBe("POST");
        expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({
            name: "activity-log",
            private: true,
            auto_init: false
        });
        expect(calls[1]?.url).toBe("https://api.github.com/orgs/acme/repos");
    });

    it("explains authentication, permission and validation errors", async () => {
        const unauthorized = client([() => json(401, { message: "Bad credentials" })]).instance;
        await expect(unauthorized.getViewer()).rejects.toMatchObject({
            status: 401,
            hint: expect.stringMatching(/invalid, expired or revoked/)
        });

        const limited = client([
            () =>
                json(
                    403,
                    { message: "API rate limit exceeded" },
                    {
                        "x-ratelimit-remaining": "0",
                        "x-ratelimit-reset": "1700000000"
                    }
                )
        ]).instance;
        await expect(limited.getViewer()).rejects.toThrow(/rate limit/);

        const forbidden = client([
            () =>
                json(
                    403,
                    { message: "Resource not accessible" },
                    { "x-accepted-oauth-scopes": "repo" }
                )
        ]).instance;
        await expect(
            forbidden.createRepo({ name: "x", description: "", private: true })
        ).rejects.toMatchObject({ hint: expect.stringContaining("repo") });

        const invalid = client([
            () =>
                json(422, {
                    message: "Repository creation failed.",
                    errors: [{ message: "name already exists on this account" }]
                })
        ]).instance;
        await expect(
            invalid.createRepo({ name: "x", description: "", private: true })
        ).rejects.toMatchObject({ details: ["name already exists on this account"] });
    });

    it("retries server errors, network failures and secondary rate limits", async () => {
        const flaky = client([
            () => json(502, { message: "Bad gateway" }),
            () => json(200, { login: "octo", id: 1 })
        ]);
        expect((await flaky.instance.getViewer()).user.login).toBe("octo");
        expect(flaky.sleep).toHaveBeenCalledTimes(1);

        const offline = client([
            () => {
                throw new TypeError("fetch failed", { cause: new Error("getaddrinfo ENOTFOUND") });
            },
            () => json(200, { login: "octo", id: 1 })
        ]);
        expect((await offline.instance.getViewer()).user.login).toBe("octo");

        const down = client([
            () => {
                throw new TypeError("fetch failed", { cause: new Error("connect ECONNREFUSED") });
            }
        ]);
        await expect(down.instance.getViewer()).rejects.toThrow(
            /Could not reach api\.github\.com: connect ECONNREFUSED/
        );
        expect(down.sleep).toHaveBeenCalledTimes(3);

        const throttled = client([
            () => json(403, { message: "secondary rate limit" }, { "retry-after": "2" }),
            () => json(200, { login: "octo", id: 1 })
        ]);
        await throttled.instance.getViewer();
        expect(throttled.sleep).toHaveBeenCalledWith(2000);
    });

    it("handles emails without permission and GraphQL errors", async () => {
        const noEmails = client([() => json(403, { message: "no" })]).instance;
        expect(await noEmails.listEmails()).toBeNull();

        const graphqlError = client([
            () => json(200, { errors: [{ message: "Something broke" }] })
        ]).instance;
        await expect(graphqlError.graphql("{ viewer { login } }", {})).rejects.toBeInstanceOf(
            GitHubError
        );
    });
});

describe("fetchContributions", () => {
    it("fetches long ranges one year at a time", async () => {
        const { instance, calls } = client([
            (_url, init) => {
                const { variables } = JSON.parse(String(init.body)) as {
                    variables: { from: string; to: string };
                };
                const date = variables.from.slice(0, 10);
                return json(200, {
                    data: {
                        user: {
                            contributionsCollection: {
                                contributionCalendar: {
                                    weeks: [
                                        {
                                            contributionDays: [
                                                { date, contributionCount: 3 },
                                                { date: "1999-01-01", contributionCount: 9 }
                                            ]
                                        }
                                    ]
                                }
                            }
                        }
                    }
                });
            }
        ]);
        const counts = await fetchContributions(instance, "octo", d("2022-01-01"), d("2023-12-31"));
        expect(calls).toHaveLength(2);
        expect(calls.every((call) => call.url === "https://api.github.com/graphql")).toBe(true);
        expect(counts.get(d("2022-01-01"))).toBe(3);
        expect([...counts.keys()].map(formatDay)).not.toContain("1999-01-01");
        expect(counts.size).toBe(2);
    });

    it("reports unknown users", async () => {
        const { instance } = client([() => json(200, { data: { user: null } })]);
        await expect(
            fetchContributions(instance, "ghost", d("2024-01-01"), d("2024-01-31"))
        ).rejects.toThrow(/doesn't exist/);
    });
});

describe("token lookup", () => {
    const none = async () => undefined;

    it("prefers the flag, then environment variables, then the GitHub CLI", async () => {
        const env = {
            RETROCOMMIT_TOKEN: "a".repeat(40),
            GH_TOKEN: "b".repeat(40),
            GITHUB_TOKEN: "c".repeat(40)
        };
        expect(
            await findToken({ flag: "f".repeat(40), host: "github.com", env, readGhToken: none })
        ).toEqual({
            token: "f".repeat(40),
            source: "--token"
        });
        expect((await findToken({ host: "github.com", env, readGhToken: none }))?.source).toBe(
            "RETROCOMMIT_TOKEN"
        );
        expect(
            (
                await findToken({
                    host: "github.com",
                    env: { GITHUB_TOKEN: "c".repeat(40) },
                    readGhToken: none
                })
            )?.source
        ).toBe("GITHUB_TOKEN");
        expect(
            await findToken({
                host: "github.com",
                env: {},
                readGhToken: async () => "g".repeat(40)
            })
        ).toEqual({ token: "g".repeat(40), source: "GitHub CLI" });
        expect(await findToken({ host: "github.com", env: {}, readGhToken: none })).toBeUndefined();
    });

    it("uses enterprise variables for other hosts", async () => {
        const env = { GH_ENTERPRISE_TOKEN: "e".repeat(40), GH_TOKEN: "b".repeat(40) };
        expect((await findToken({ host: "ghe.corp", env, readGhToken: none }))?.source).toBe(
            "GH_ENTERPRISE_TOKEN"
        );
    });

    it("validates the token format", () => {
        expect(() => checkTokenFormat("  ")).toThrow(/empty/);
        expect(() => checkTokenFormat("abc def ghi jkl mno pqr")).toThrow(/spaces/);
        expect(() => checkTokenFormat("short")).toThrow(/too short/);
        expect(checkTokenFormat(`  ${TOKEN}\n`)).toBe(TOKEN);
    });

    it("builds token creation links and checks scopes", () => {
        expect(tokenCreationUrl("github.com", ["repo", "delete_repo"])).toBe(
            "https://github.com/settings/tokens/new?scopes=repo%2Cdelete_repo&description=retrocommit"
        );
        expect(hasRepoScope(["repo"], "private")).toBe(true);
        expect(hasRepoScope(["public_repo"], "private")).toBe(false);
        expect(hasRepoScope(["public_repo"], "public")).toBe(true);
    });
});
