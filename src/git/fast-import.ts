import { spawn } from "node:child_process";
import { once } from "node:events";
import type { CommitSpec } from "../core/commits.ts";
import { type Day, formatDay, pad2, ymdFromDay } from "../core/dates.ts";
import { formatInstant, formatLocalTime, formatOffset, type Instant } from "../core/timezone.ts";
import { GitError } from "../errors.ts";
import { gitEnv, gitNotFoundError } from "./exec.ts";

export interface Identity {
    name: string;
    email: string;
}

export type ContentMode = "single" | "daily" | "empty";

export interface HistoryOptions {
    branch: string;
    author: Identity;
    /** What each commit changes: one file, one file per day, or nothing. */
    content: ContentMode;
    /** File (single) or directory (daily) written by the commits. */
    contentPath: string;
    /** README.md content for the first commit; `undefined` to skip it. */
    readme?: string | undefined;
    /** Commit to build on (`--if-exists append`), e.g. `refs/remotes/origin/main^0`. */
    parent?: string | undefined;
}

function data(text: string): string {
    return `data ${Buffer.byteLength(text, "utf8")}\n${text}\n`;
}

function signature(identity: Identity, instant: Instant): string {
    return `${identity.name} <${identity.email}> ${instant.epochSeconds} ${formatOffset(instant.offsetMinutes, "git")}`;
}

function firstLine(message: string): string {
    return message.split("\n", 1)[0] ?? "";
}

/** `activity/2024/03/2024-03-05.md` */
export function dailyPath(directory: string, day: Day): string {
    const { year, month } = ymdFromDay(day);
    return `${directory}/${year}/${pad2(month)}/${formatDay(day)}.md`;
}

/**
 * Builds a `git fast-import` stream, one chunk per commit. Every commit sets the
 * author and committer date explicitly, which is what places it on the graph.
 */
export function* fastImportStream(
    commits: Iterable<CommitSpec>,
    options: HistoryOptions
): Generator<string> {
    let first = true;
    let currentDay: Day | null = null;
    let dayLog = "";

    for (const commit of commits) {
        const who = signature(options.author, commit.instant);
        let block = `commit refs/heads/${options.branch}\nauthor ${who}\ncommitter ${who}\n`;
        block += data(commit.message);
        if (first && options.parent) block += `from ${options.parent}\n`;
        if (first && options.readme !== undefined) {
            block += `M 100644 inline README.md\n${data(options.readme)}`;
        }

        if (options.content === "single") {
            const line = `${formatInstant(commit.instant)} ${firstLine(commit.message)}\n`;
            block += `M 100644 inline ${options.contentPath}\n${data(line)}`;
        } else if (options.content === "daily") {
            if (commit.day !== currentDay) {
                currentDay = commit.day;
                dayLog = `# Activity on ${formatDay(commit.day)}\n\n`;
            }
            dayLog += `- ${formatLocalTime(commit.instant)} ${firstLine(commit.message)}\n`;
            block += `M 100644 inline ${dailyPath(options.contentPath, commit.day)}\n${data(dayLog)}`;
        }

        yield `${block}\n`;
        first = false;
    }
    yield "done\n";
}

export interface FastImportOptions {
    signal?: AbortSignal | undefined;
}

const CHUNK_SIZE = 1 << 16;

/**
 * Pipes a stream into `git fast-import --done`. The `done` marker guarantees that an
 * interrupted stream never leaves a half-written history behind.
 */
export async function runFastImport(
    cwd: string,
    stream: Iterable<string>,
    options: FastImportOptions = {}
): Promise<void> {
    const child = spawn("git", ["fast-import", "--quiet", "--done"], {
        cwd,
        env: gitEnv(),
        stdio: ["pipe", "ignore", "pipe"],
        windowsHide: true,
        signal: options.signal
    });

    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
    });

    const exited = new Promise<number>((resolve, reject) => {
        child.on("error", (error: NodeJS.ErrnoException) => {
            reject(error.code === "ENOENT" ? gitNotFoundError() : error);
        });
        child.on("close", (code) => resolve(code ?? 1));
    });

    let broken = false;
    child.stdin.on("error", () => {
        // EPIPE: fast-import stopped reading; its exit code and stderr explain why.
        broken = true;
    });

    let buffer = "";
    for (const chunk of stream) {
        buffer += chunk;
        if (buffer.length < CHUNK_SIZE) continue;
        if (broken) break;
        if (!child.stdin.write(buffer)) {
            await Promise.race([once(child.stdin, "drain"), exited]);
        }
        buffer = "";
    }
    if (!broken) child.stdin.end(buffer);

    const code = await exited;
    if (code !== 0) {
        const message = stderr.trim();
        throw new GitError("git fast-import could not create the commits.", {
            stderr: message,
            details: message ? message.split("\n").slice(-8) : [],
            hint: "This is unexpected. Please report it with the details above."
        });
    }
}
