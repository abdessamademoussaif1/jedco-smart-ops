import { GitError } from "../errors.ts";
import { type GitRunOptions, type GitVersion, runGit, supportsConfigEnv, tryGit } from "./exec.ts";

/**
 * How git authenticates against the remote:
 * - `token`: a GitHub token sent as an HTTP header (never stored on disk or in the URL).
 * - `system`: the user's own setup (SSH keys, credential helpers, prompts).
 */
export type GitAuth =
    | { kind: "token"; token: string; host: string }
    | { kind: "system"; interactive: boolean };

/** Git options that carry the credentials for `auth`. */
export function authOptions(
    auth: GitAuth,
    version: GitVersion
): Pick<GitRunOptions, "env" | "config" | "secrets" | "interactive"> {
    if (auth.kind === "system") return { interactive: auth.interactive };

    const basic = Buffer.from(`x-access-token:${auth.token}`, "utf8").toString("base64");
    const pairs: Array<[string, string]> = [
        [`http.https://${auth.host.toLowerCase()}/.extraheader`, `AUTHORIZATION: basic ${basic}`],
        // Don't let credential helpers answer (or store anything) for this process.
        ["credential.helper", ""]
    ];
    const secrets = [auth.token, basic];

    if (!supportsConfigEnv(version)) return { config: pairs, secrets };

    const existing = Number.parseInt(process.env.GIT_CONFIG_COUNT ?? "0", 10) || 0;
    const env: Record<string, string> = { GIT_CONFIG_COUNT: String(existing + pairs.length) };
    pairs.forEach(([key, value], index) => {
        env[`GIT_CONFIG_KEY_${existing + index}`] = key;
        env[`GIT_CONFIG_VALUE_${existing + index}`] = value;
    });
    return { env, secrets };
}

/** Creates an empty repository whose HEAD points to `branch`. */
export async function initRepository(directory: string, branch: string): Promise<void> {
    await runGit(["-c", `init.defaultBranch=${branch}`, "init", "--quiet", directory]);
    await runGit(["symbolic-ref", "HEAD", `refs/heads/${branch}`], { cwd: directory });
}

/** Fills the working tree after fast-import (which only writes objects and refs). */
export async function checkoutWorktree(directory: string): Promise<void> {
    await runGit(["reset", "--hard", "--quiet"], { cwd: directory });
}

export async function addRemote(directory: string, name: string, url: string): Promise<void> {
    await runGit(["remote", "add", name, url], { cwd: directory });
}

export async function countCommits(directory: string, ref = "HEAD"): Promise<number> {
    const { stdout } = await runGit(["rev-list", "--count", ref], { cwd: directory });
    return Number(stdout.trim());
}

export interface RemoteContext {
    directory: string;
    url: string;
    auth: GitAuth;
    version: GitVersion;
    signal?: AbortSignal | undefined;
}

/** Branch heads on the remote: `{ main: "<sha>" }`. */
export async function listRemoteBranches(context: RemoteContext): Promise<Map<string, string>> {
    const result = await tryGit(["ls-remote", "--heads", context.url], {
        cwd: context.directory,
        signal: context.signal,
        ...authOptions(context.auth, context.version)
    });
    if (result.code !== 0) throw remoteError("read", result.stderr);

    const branches = new Map<string, string>();
    for (const line of result.stdout.split("\n")) {
        const [sha, ref] = line.trim().split(/\s+/);
        if (sha && ref?.startsWith("refs/heads/"))
            branches.set(ref.slice("refs/heads/".length), sha);
    }
    return branches;
}

/** The remote's default branch (what its HEAD points to), if it has one. */
export async function remoteDefaultBranch(context: RemoteContext): Promise<string | undefined> {
    const result = await tryGit(["ls-remote", "--symref", context.url, "HEAD"], {
        cwd: context.directory,
        signal: context.signal,
        ...authOptions(context.auth, context.version)
    });
    if (result.code !== 0) return undefined;
    const match = /^ref:\s+refs\/heads\/(\S+)\s+HEAD$/m.exec(result.stdout);
    return match?.[1];
}

/** Fetches `branch` into `refs/remotes/origin/<branch>` so new commits can build on it. */
export async function fetchBranch(context: RemoteContext, branch: string): Promise<string> {
    const target = `refs/remotes/origin/${branch}`;
    const result = await tryGit(
        ["fetch", "--quiet", "--no-tags", context.url, `+refs/heads/${branch}:${target}`],
        {
            cwd: context.directory,
            signal: context.signal,
            ...authOptions(context.auth, context.version)
        }
    );
    if (result.code !== 0) throw remoteError("fetch", result.stderr);
    return target;
}

export interface PushOptions {
    branch: string;
    /** Overwrite the remote branch. With `expectedSha` it only does so if nobody pushed meanwhile. */
    force?: boolean | undefined;
    expectedSha?: string | undefined;
}

export async function pushBranch(context: RemoteContext, options: PushOptions): Promise<void> {
    const ref = `refs/heads/${options.branch}`;
    const args = ["push", "--no-verify"];
    if (!(context.auth.kind === "system" && context.auth.interactive)) args.push("--quiet");
    if (options.force) {
        args.push(
            options.expectedSha ? `--force-with-lease=${ref}:${options.expectedSha}` : "--force"
        );
    }
    args.push(context.url, `${ref}:${ref}`);

    const result = await tryGit(args, {
        cwd: context.directory,
        signal: context.signal,
        ...authOptions(context.auth, context.version)
    });
    if (result.code !== 0) throw remoteError("push", result.stderr);
}

/** Turns git's remote errors into messages with a useful hint. */
export function remoteError(action: "read" | "fetch" | "push", stderr: string): GitError {
    const text = stderr.trim();
    const lower = text.toLowerCase();
    const details = text ? text.split("\n").slice(-8) : [];
    const verb = action === "push" ? "push to" : action === "fetch" ? "download from" : "read";
    let message = `Could not ${verb} the remote repository.`;
    let hint: string | undefined;

    if (lower.includes("gh007") || lower.includes("email privacy")) {
        message =
            "GitHub rejected the push because the commits would expose a private email address.";
        hint = "Remove --author-email to use your GitHub no-reply address (recommended).";
    } else if (lower.includes("gh006") || lower.includes("protected branch")) {
        message = "The branch is protected on GitHub, so it can't be overwritten.";
        hint = "Use another repository (--repo) or remove the branch protection rule.";
    } else if (
        lower.includes("non-fast-forward") ||
        lower.includes("fetch first") ||
        lower.includes("stale info") ||
        lower.includes("[rejected]")
    ) {
        message = "The remote branch has commits that aren't in the local history.";
        hint =
            "Use --if-exists append to add on top of them, or --if-exists replace to overwrite them.";
    } else if (
        lower.includes("permission denied (publickey)") ||
        lower.includes("host key verification")
    ) {
        message = "SSH authentication failed.";
        hint = "Check your SSH key (`ssh -T git@github.com`) or use --protocol https with a token.";
    } else if (
        lower.includes("repository not found") ||
        lower.includes("does not appear to be a git repository")
    ) {
        message = "The remote repository was not found (or you don't have access to it).";
        hint = "Check the repository name/URL and that your token can access it.";
    } else if (
        lower.includes("authentication failed") ||
        lower.includes("could not read username") ||
        lower.includes("invalid username or password") ||
        lower.includes("returned error: 403") ||
        lower.includes("returned error: 401")
    ) {
        message = "The remote rejected the credentials.";
        hint =
            "Make sure the token has write access to the repository contents (classic: `repo`; fine-grained: Contents read & write).";
    } else if (lower.includes("could not resolve host") || lower.includes("unable to access")) {
        message = "Could not reach the remote server.";
        hint = "Check your internet connection or proxy settings.";
    }
    if (hint === undefined && lower.includes("insteadof")) {
        hint = "Your git config rewrites URLs (url.*.insteadOf); try --protocol ssh.";
    }
    return new GitError(message, { hint, details, stderr: text });
}
