import { USER_AGENT } from "../constants.ts";
import { errorMessage, GitHubError } from "../errors.ts";

export interface Endpoints {
    host: string;
    apiUrl: string;
    graphqlUrl: string;
    webUrl: string;
}

/** API URLs for github.com or a GitHub Enterprise Server host. */
export function resolveEndpoints(host = "github.com", apiUrl?: string): Endpoints {
    const normalizedHost = host
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, "")
        .replace(/\/+$/, "");
    const api = (
        apiUrl?.trim() ||
        (normalizedHost === "github.com"
            ? "https://api.github.com"
            : `https://${normalizedHost}/api/v3`)
    ).replace(/\/+$/, "");
    const graphqlUrl =
        api === "https://api.github.com" ? `${api}/graphql` : `${api.replace(/\/v3$/, "")}/graphql`;
    return { host: normalizedHost, apiUrl: api, graphqlUrl, webUrl: `https://${normalizedHost}` };
}

export interface GitHubUser {
    login: string;
    id: number;
    name: string | null;
    createdAt: string;
}

export type TokenKind = "classic" | "fine-grained" | "oauth" | "app" | "unknown";

export interface Viewer {
    user: GitHubUser;
    /** Scopes of classic/OAuth tokens; `null` for fine-grained tokens (they don't report scopes). */
    scopes: string[] | null;
    tokenKind: TokenKind;
}

export interface GitHubRepo {
    name: string;
    fullName: string;
    owner: string;
    private: boolean;
    defaultBranch: string;
    /** Size in KB. 0 for an empty repository. */
    size: number;
    topics: string[];
    htmlUrl: string;
    fork: boolean;
    archived: boolean;
    canPush: boolean;
    canAdmin: boolean;
    createdAt: string;
}

export interface EmailAddress {
    email: string;
    verified: boolean;
    primary: boolean;
}

export interface RateLimit {
    limit: number;
    remaining: number;
    reset: Date;
}

export interface ClientOptions {
    token: string;
    endpoints: Endpoints;
    fetch?: typeof fetch;
    retries?: number;
    timeoutMs?: number;
    sleep?: (ms: number) => Promise<void>;
    /** Aborts every request (e.g. on Ctrl+C). */
    signal?: AbortSignal | undefined;
}

interface ApiErrorBody {
    message?: string;
    errors?: Array<{ message?: string; code?: string; field?: string } | string>;
}

type Json = Record<string, unknown>;

export function tokenKindOf(token: string, scopes: string[] | null): TokenKind {
    if (token.startsWith("github_pat_")) return "fine-grained";
    if (token.startsWith("ghp_")) return "classic";
    if (token.startsWith("gho_")) return "oauth";
    if (token.startsWith("ghu_") || token.startsWith("ghs_")) return "app";
    return scopes === null ? "unknown" : "classic";
}

function toRepo(json: Json): GitHubRepo {
    const owner = json.owner as Json | undefined;
    const permissions = json.permissions as Json | undefined;
    return {
        name: String(json.name),
        fullName: String(json.full_name),
        owner: String(owner?.login ?? ""),
        private: Boolean(json.private),
        defaultBranch: String(json.default_branch ?? "main"),
        size: Number(json.size ?? 0),
        topics: Array.isArray(json.topics) ? json.topics.map(String) : [],
        htmlUrl: String(json.html_url),
        fork: Boolean(json.fork),
        archived: Boolean(json.archived),
        canPush: permissions ? Boolean(permissions.push) : true,
        canAdmin: permissions ? Boolean(permissions.admin) : true,
        createdAt: String(json.created_at ?? "")
    };
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A minimal GitHub REST + GraphQL client with retries and friendly errors. */
export class GitHubClient {
    readonly endpoints: Endpoints;
    private readonly token: string;
    private readonly fetchImpl: typeof fetch;
    private readonly retries: number;
    private readonly timeoutMs: number;
    private readonly sleep: (ms: number) => Promise<void>;
    private readonly signal: AbortSignal | undefined;

    constructor(options: ClientOptions) {
        this.token = options.token;
        this.endpoints = options.endpoints;
        this.fetchImpl = options.fetch ?? globalThis.fetch;
        this.retries = options.retries ?? 3;
        this.timeoutMs = options.timeoutMs ?? 30_000;
        this.sleep = options.sleep ?? defaultSleep;
        this.signal = options.signal;
    }

    /** Sends a request, retrying network errors, 5xx responses and secondary rate limits. */
    private async send(url: string, init: { method: string; body?: unknown }): Promise<Response> {
        const headers: Record<string, string> = {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${this.token}`,
            "User-Agent": USER_AGENT,
            "X-GitHub-Api-Version": "2022-11-28"
        };
        if (init.body !== undefined) headers["Content-Type"] = "application/json";

        for (let attempt = 0; ; attempt++) {
            this.signal?.throwIfAborted();
            const timeout = AbortSignal.timeout(this.timeoutMs);
            let response: Response;
            try {
                response = await this.fetchImpl(url, {
                    method: init.method,
                    headers,
                    body: init.body === undefined ? undefined : JSON.stringify(init.body),
                    signal: this.signal ? AbortSignal.any([this.signal, timeout]) : timeout
                });
            } catch (error) {
                if (this.signal?.aborted) throw error;
                if (attempt < this.retries) {
                    await this.sleep(500 * 2 ** attempt);
                    continue;
                }
                const reason =
                    error instanceof Error && error.cause instanceof Error
                        ? error.cause.message
                        : errorMessage(error);
                throw new GitHubError(`Could not reach ${new URL(url).host}: ${reason}`, {
                    hint: "Check your internet connection. Behind a proxy? Set HTTPS_PROXY and NODE_USE_ENV_PROXY=1.",
                    cause: error
                });
            }

            const retryAfter = Number(response.headers.get("retry-after"));
            const secondaryLimit =
                (response.status === 403 || response.status === 429) &&
                Number.isFinite(retryAfter) &&
                retryAfter > 0;
            if ((response.status >= 500 || secondaryLimit) && attempt < this.retries) {
                const wait = secondaryLimit ? Math.min(retryAfter, 60) * 1000 : 500 * 2 ** attempt;
                await response.body?.cancel().catch(() => undefined);
                await this.sleep(wait);
                continue;
            }
            return response;
        }
    }

    private async fail(response: Response, action: string): Promise<never> {
        const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
        const apiMessage = body?.message ?? response.statusText;
        const details = (body?.errors ?? []).map((item) =>
            typeof item === "string"
                ? item
                : (item.message ?? `${item.field ?? ""} ${item.code ?? ""}`.trim())
        );
        const status = response.status;
        const remaining = response.headers.get("x-ratelimit-remaining");

        if (status === 401) {
            throw new GitHubError("GitHub rejected the token (401 Bad credentials).", {
                status,
                hint: "The token is invalid, expired or revoked. Create a new one and try again."
            });
        }
        if ((status === 403 || status === 429) && remaining === "0") {
            const reset = Number(response.headers.get("x-ratelimit-reset")) * 1000;
            const when = Number.isFinite(reset) ? new Date(reset).toLocaleTimeString() : "a while";
            throw new GitHubError("GitHub API rate limit exceeded.", {
                status,
                hint: `Wait until ${when} and try again.`
            });
        }
        if (status === 403) {
            const accepted = response.headers.get("x-accepted-oauth-scopes");
            throw new GitHubError(`GitHub denied permission to ${action}: ${apiMessage}`, {
                status,
                details,
                hint: accepted
                    ? `The token needs one of these scopes: ${accepted}.`
                    : "Check the token's permissions (classic: `repo`; fine-grained: Administration and Contents read & write)."
            });
        }
        if (status === 404) {
            throw new GitHubError(`Not found while trying to ${action}.`, {
                status,
                hint: "Check the name and that the token can access it (private repositories need the `repo` scope)."
            });
        }
        throw new GitHubError(`GitHub couldn't ${action}: ${apiMessage} (HTTP ${status}).`, {
            status,
            details
        });
    }

    private async rest<T>(
        method: string,
        path: string,
        action: string,
        body?: unknown
    ): Promise<{ data: T; headers: Headers }> {
        const response = await this.send(`${this.endpoints.apiUrl}${path}`, { method, body });
        if (!response.ok) return this.fail(response, action);
        const data = (response.status === 204 ? null : await response.json()) as T;
        return { data, headers: response.headers };
    }

    async getViewer(): Promise<Viewer> {
        const { data, headers } = await this.rest<Json>("GET", "/user", "read your account");
        const header = headers.get("x-oauth-scopes");
        const scopes =
            header === null
                ? null
                : header
                      .split(",")
                      .map((scope) => scope.trim())
                      .filter(Boolean);
        return {
            user: {
                login: String(data.login),
                id: Number(data.id),
                name: typeof data.name === "string" && data.name.trim() ? data.name : null,
                createdAt: String(data.created_at ?? "")
            },
            scopes,
            tokenKind: tokenKindOf(this.token, scopes)
        };
    }

    async getRepo(owner: string, name: string): Promise<GitHubRepo | null> {
        const response = await this.send(
            `${this.endpoints.apiUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
            { method: "GET" }
        );
        if (response.status === 404) return null;
        if (!response.ok) return this.fail(response, `read the repository ${owner}/${name}`);
        return toRepo((await response.json()) as Json);
    }

    async createRepo(input: {
        name: string;
        description: string;
        private: boolean;
        org?: string | undefined;
    }): Promise<GitHubRepo> {
        const path = input.org ? `/orgs/${encodeURIComponent(input.org)}/repos` : "/user/repos";
        const { data } = await this.rest<Json>(
            "POST",
            path,
            `create the repository ${input.name}`,
            {
                name: input.name,
                description: input.description,
                private: input.private,
                auto_init: false,
                has_issues: false,
                has_projects: false,
                has_wiki: false
            }
        );
        return toRepo(data);
    }

    async setDefaultBranch(owner: string, name: string, branch: string): Promise<void> {
        await this.rest("PATCH", `/repos/${owner}/${name}`, "change the default branch", {
            default_branch: branch
        });
    }

    async replaceTopics(owner: string, name: string, topics: readonly string[]): Promise<void> {
        await this.rest("PUT", `/repos/${owner}/${name}/topics`, "set the repository topics", {
            names: topics
        });
    }

    async deleteRepo(owner: string, name: string): Promise<void> {
        await this.rest("DELETE", `/repos/${owner}/${name}`, `delete ${owner}/${name}`);
    }

    /** Verified emails of the account, or `null` if the token can't read them. */
    async listEmails(): Promise<EmailAddress[] | null> {
        const response = await this.send(`${this.endpoints.apiUrl}/user/emails`, { method: "GET" });
        if (response.status === 403 || response.status === 404) return null;
        if (!response.ok) return this.fail(response, "read your email addresses");
        const data = (await response.json()) as Json[];
        return data.map((item) => ({
            email: String(item.email),
            verified: Boolean(item.verified),
            primary: Boolean(item.primary)
        }));
    }

    async rateLimit(): Promise<RateLimit> {
        const { data } = await this.rest<{ resources?: { core?: Json } }>(
            "GET",
            "/rate_limit",
            "read the rate limit"
        );
        const core = data.resources?.core ?? {};
        return {
            limit: Number(core.limit ?? 0),
            remaining: Number(core.remaining ?? 0),
            reset: new Date(Number(core.reset ?? 0) * 1000)
        };
    }

    async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
        const response = await this.send(this.endpoints.graphqlUrl, {
            method: "POST",
            body: { query, variables }
        });
        if (!response.ok) return this.fail(response, "query the GraphQL API");
        const body = (await response.json()) as { data?: T; errors?: Array<{ message?: string }> };
        if (body.errors && body.errors.length > 0) {
            throw new GitHubError(
                `GitHub GraphQL error: ${body.errors.map((error) => error.message ?? "unknown").join("; ")}`
            );
        }
        if (body.data === undefined) throw new GitHubError("GitHub GraphQL returned no data.");
        return body.data;
    }
}
