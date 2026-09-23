import { spawn } from "node:child_process";
import { GIT_CONFIG_ENV_VERSION, MIN_GIT_VERSION } from "../constants.ts";
import { GitError } from "../errors.ts";

export interface GitRunOptions {
    cwd?: string | undefined;
    /** Extra environment variables. `undefined` values remove a variable. */
    env?: Readonly<Record<string, string | undefined>> | undefined;
    /** `-c key=value` pairs placed before the subcommand. */
    config?: ReadonlyArray<readonly [string, string]> | undefined;
    /**
     * Let git talk to the terminal (credential or SSH prompts, progress on stderr).
     * stdout is still captured.
     */
    interactive?: boolean | undefined;
    /** Values that must never appear in errors (tokens). */
    secrets?: readonly string[] | undefined;
    signal?: AbortSignal | undefined;
}

export interface GitResult {
    code: number;
    stdout: string;
    stderr: string;
}

export interface GitVersion {
    major: number;
    minor: number;
    patch: number;
    raw: string;
}

/** Replaces every secret in `text` with `***`. */
export function redact(text: string, secrets: readonly string[] | undefined): string {
    let result = text;
    for (const secret of secrets ?? []) {
        if (secret.length > 0) result = result.split(secret).join("***");
    }
    return result;
}

export function gitNotFoundError(): GitError {
    const hint =
        process.platform === "darwin"
            ? "Install it with `xcode-select --install` or `brew install git`, then open a new terminal."
            : process.platform === "win32"
              ? "Install it with `winget install --id Git.Git -e` (or from https://git-scm.com/download/win), then open a new terminal."
              : "Install it with your package manager, e.g. `sudo apt install git`, `sudo dnf install git` or `sudo pacman -S git`.";
    return new GitError("Git is not installed or is not in your PATH.", { hint });
}

/** Environment for every git process: English messages and no surprise prompts. */
export function gitEnv(
    extra: GitRunOptions["env"] = undefined,
    interactive = false
): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env, LC_ALL: "C", LANGUAGE: "C" };
    if (!interactive) env.GIT_TERMINAL_PROMPT = "0";
    for (const [key, value] of Object.entries(extra ?? {})) {
        if (value === undefined) delete env[key];
        else env[key] = value;
    }
    return env;
}

function describeCommand(args: readonly string[]): string {
    return `git ${args.filter((arg) => !arg.includes("extraheader")).join(" ")}`;
}

/** Runs git and returns its output, whatever the exit code. Throws only if git can't start. */
export function tryGit(args: readonly string[], options: GitRunOptions = {}): Promise<GitResult> {
    const configArgs = (options.config ?? []).flatMap(([key, value]) => ["-c", `${key}=${value}`]);
    const fullArgs = [...configArgs, ...args];

    return new Promise((resolve, reject) => {
        const child = spawn("git", fullArgs, {
            cwd: options.cwd,
            env: gitEnv(options.env, options.interactive),
            stdio: options.interactive
                ? ["inherit", "pipe", "inherit"]
                : ["ignore", "pipe", "pipe"],
            windowsHide: true,
            signal: options.signal
        });
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
        child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
        child.on("error", (error: NodeJS.ErrnoException) => {
            reject(error.code === "ENOENT" ? gitNotFoundError() : error);
        });
        child.on("close", (code, signal) => {
            resolve({
                code: code ?? (signal ? 128 : 1),
                stdout: redact(Buffer.concat(stdout).toString("utf8"), options.secrets),
                stderr: redact(Buffer.concat(stderr).toString("utf8"), options.secrets)
            });
        });
    });
}

/** Runs git and throws a `GitError` (with the redacted stderr) when it fails. */
export async function runGit(
    args: readonly string[],
    options: GitRunOptions = {}
): Promise<GitResult> {
    const result = await tryGit(args, options);
    if (result.code !== 0) {
        const stderr = result.stderr.trim();
        throw new GitError(`\`${redact(describeCommand(args), options.secrets)}\` failed.`, {
            stderr,
            details: stderr ? stderr.split("\n").slice(-8) : []
        });
    }
    return result;
}

export function parseGitVersion(text: string): GitVersion {
    const match = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(text);
    if (!match) throw new GitError(`Could not read the git version from "${text.trim()}".`);
    return {
        major: Number(match[1]),
        minor: Number(match[2]),
        patch: Number(match[3] ?? "0"),
        raw: `${match[1]}.${match[2]}.${match[3] ?? "0"}`
    };
}

/** -1, 0 or 1, comparing a version against `"x.y.z"`. */
export function compareVersion(version: GitVersion, other: string): number {
    const [major = 0, minor = 0, patch = 0] = other.split(".").map(Number);
    const a = [version.major, version.minor, version.patch];
    const b = [major, minor, patch];
    for (let i = 0; i < 3; i++) {
        if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0) ? -1 : 1;
    }
    return 0;
}

let cachedVersion: Promise<GitVersion> | undefined;

/** Detects git (once per process) and checks the minimum supported version. */
export function getGitVersion(): Promise<GitVersion> {
    cachedVersion ??= (async () => {
        const { stdout } = await runGit(["--version"]);
        const version = parseGitVersion(stdout);
        if (compareVersion(version, MIN_GIT_VERSION) < 0) {
            throw new GitError(
                `Git ${version.raw} is too old: retrocommit needs Git ${MIN_GIT_VERSION} or newer.`,
                { hint: "Update Git from https://git-scm.com/downloads." }
            );
        }
        return version;
    })();
    cachedVersion.catch(() => {
        cachedVersion = undefined;
    });
    return cachedVersion;
}

/** Git ≥ 2.31 can receive configuration through `GIT_CONFIG_COUNT` (invisible to `ps`). */
export function supportsConfigEnv(version: GitVersion): boolean {
    return compareVersion(version, GIT_CONFIG_ENV_VERSION) >= 0;
}

/** `git config --get <key>` (global scope included), or `undefined`. */
export async function readGitConfig(key: string, cwd?: string): Promise<string | undefined> {
    const result = await tryGit(["config", "--get", key], { cwd });
    const value = result.stdout.trim();
    return result.code === 0 && value.length > 0 ? value : undefined;
}
