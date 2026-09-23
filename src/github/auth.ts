import { spawn } from "node:child_process";
import { TOOL_NAME } from "../constants.ts";
import { InvalidValueError } from "../errors.ts";

export type TokenSource =
    | "--token"
    | "RETROCOMMIT_TOKEN"
    | "GH_ENTERPRISE_TOKEN"
    | "GITHUB_ENTERPRISE_TOKEN"
    | "GH_TOKEN"
    | "GITHUB_TOKEN"
    | "GitHub CLI"
    | "prompt";

export interface ResolvedToken {
    token: string;
    source: TokenSource;
}

export interface TokenLookup {
    flag?: string | undefined;
    host: string;
    env?: NodeJS.ProcessEnv | undefined;
    /** Reads the GitHub CLI token; replaceable in tests. */
    readGhToken?: ((host: string) => Promise<string | undefined>) | undefined;
}

/** Basic sanity checks, so an obviously wrong value fails before any request. */
export function checkTokenFormat(token: string): string {
    const value = token.trim();
    if (value.length === 0) throw new InvalidValueError("the token is empty");
    if (/\s/.test(value)) throw new InvalidValueError("the token contains spaces");
    if (value.length < 20)
        throw new InvalidValueError("the token is too short to be a GitHub token");
    return value;
}

/** Asks the GitHub CLI (`gh auth token`) for its token, if it's installed and logged in. */
export function readGhCliToken(host: string): Promise<string | undefined> {
    return new Promise((resolve) => {
        let output = "";
        let settled = false;
        const finish = (value: string | undefined) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(value);
        };
        const child = spawn("gh", ["auth", "token", "--hostname", host], {
            stdio: ["ignore", "pipe", "ignore"],
            windowsHide: true
        });
        const timer = setTimeout(() => {
            child.kill();
            finish(undefined);
        }, 5000);
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
            output += chunk;
        });
        child.on("error", () => finish(undefined));
        child.on("close", (code) => {
            const token = output.trim();
            finish(code === 0 && token.length > 0 ? token : undefined);
        });
    });
}

/**
 * Looks for a token without prompting: `--token`, then environment variables, then the
 * GitHub CLI. Returns `undefined` when none is found.
 */
export async function findToken(lookup: TokenLookup): Promise<ResolvedToken | undefined> {
    if (lookup.flag !== undefined) {
        return { token: checkTokenFormat(lookup.flag), source: "--token" };
    }

    const env = lookup.env ?? process.env;
    const names: TokenSource[] =
        lookup.host === "github.com"
            ? ["RETROCOMMIT_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"]
            : [
                  "RETROCOMMIT_TOKEN",
                  "GH_ENTERPRISE_TOKEN",
                  "GITHUB_ENTERPRISE_TOKEN",
                  "GH_TOKEN",
                  "GITHUB_TOKEN"
              ];
    for (const name of names) {
        const value = env[name]?.trim();
        if (value) return { token: checkTokenFormat(value), source: name };
    }

    const fromCli = await (lookup.readGhToken ?? readGhCliToken)(lookup.host);
    if (fromCli) return { token: fromCli, source: "GitHub CLI" };
    return undefined;
}

/** Link that opens GitHub's "new token" page with the scopes already selected. */
export function tokenCreationUrl(host: string, scopes: readonly string[]): string {
    const params = new URLSearchParams({ scopes: scopes.join(","), description: TOOL_NAME });
    return `https://${host}/settings/tokens/new?${params.toString()}`;
}

/** Scopes a classic token needs for `--visibility`. */
export function requiredScopes(visibility: "private" | "public"): string[] {
    return visibility === "private" ? ["repo"] : ["public_repo"];
}

/** Whether classic scopes allow pushing to (and creating) a repository with that visibility. */
export function hasRepoScope(scopes: readonly string[], visibility: "private" | "public"): boolean {
    return scopes.includes("repo") || (visibility === "public" && scopes.includes("public_repo"));
}
