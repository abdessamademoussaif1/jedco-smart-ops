import * as clack from "@clack/prompts";
import { CancelledError, errorMessage, RetroError } from "../errors.ts";
import type { Output } from "../ui/output.ts";
import { checkTokenFormat, findToken, type TokenSource, tokenCreationUrl } from "./auth.ts";
import { type Endpoints, GitHubClient, type GitHubUser, type Viewer } from "./client.ts";

export interface GitHubSession {
    client: GitHubClient;
    viewer: Viewer;
    token: string;
    source: TokenSource;
}

export interface ConnectOptions {
    endpoints: Endpoints;
    flagToken?: string | undefined;
    /** Ask for a token (or fail) when none is configured. */
    required: boolean;
    /** Why we need it, e.g. "create the repository". */
    reason: string;
    /** Classic scopes to pre-select in the "create a token" link. */
    scopes: readonly string[];
    signal?: AbortSignal | undefined;
}

/** GitHub's no-reply address: always linked to the account, so commits always count. */
export function noReplyEmail(user: GitHubUser, host: string): string {
    return `${user.id}+${user.login}@users.noreply.${host}`;
}

/**
 * Finds a token (flag, env, GitHub CLI or a hidden prompt), validates it and returns a
 * ready-to-use client. Returns `undefined` if none is found and it isn't required.
 */
export async function connectGitHub(
    out: Output,
    options: ConnectOptions
): Promise<GitHubSession | undefined> {
    const { endpoints } = options;
    let found: { token: string; source: TokenSource } | undefined;
    try {
        found = await findToken({ flag: options.flagToken, host: endpoints.host });
    } catch (error) {
        throw new RetroError(`Invalid token: ${errorMessage(error)}.`, { exitCode: 2 });
    }

    const createUrl = tokenCreationUrl(endpoints.host, options.scopes);
    if (!found) {
        if (!options.required) return undefined;
        if (!out.canPrompt) {
            throw new RetroError(`A GitHub token is needed to ${options.reason}.`, {
                exitCode: 2,
                hint: `Create one at ${createUrl} and set it in the RETROCOMMIT_TOKEN environment variable (or pass --token).`
            });
        }
        out.note(
            [
                `retrocommit needs a GitHub token to ${options.reason}.`,
                "Create a classic token with the scopes already selected here:",
                out.c.cyan(createUrl),
                "",
                out.c.dim("Tip: export RETROCOMMIT_TOKEN=<token> to skip this question next time."),
                out.c.dim("The token is only used for this run and is never saved.")
            ].join("\n"),
            "GitHub token"
        );
        const value = await clack.password({
            message: "Paste your GitHub token",
            output: out.stdout,
            validate: (input) => {
                try {
                    checkTokenFormat(input ?? "");
                    return undefined;
                } catch (error) {
                    return errorMessage(error);
                }
            }
        });
        if (clack.isCancel(value)) throw new CancelledError();
        found = { token: checkTokenFormat(value), source: "prompt" };
    }

    const client = new GitHubClient({ token: found.token, endpoints, signal: options.signal });
    const spinner = out.spinner();
    spinner.start("Connecting to GitHub");
    try {
        const viewer = await client.getViewer();
        spinner.stop(
            `Signed in as ${out.c.bold(viewer.user.login)} ${out.c.dim(`(token from ${found.source})`)}`
        );
        return { client, viewer, token: found.token, source: found.source };
    } catch (error) {
        spinner.fail("GitHub didn't accept the token");
        if (
            error instanceof RetroError &&
            error.hint &&
            /invalid, expired or revoked/.test(error.hint)
        ) {
            throw new RetroError(error.message, {
                hint: `The token from ${found.source} is invalid, expired or revoked. Create a new one at ${createUrl}`
            });
        }
        throw error;
    }
}
