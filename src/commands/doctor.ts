import { spawn } from "node:child_process";
import type { Command } from "commander";
import type { CommonFlags } from "../cli/flags.ts";
import { validateApiUrl, validateHost } from "../config/validate.ts";
import { MIN_NODE_VERSION } from "../constants.ts";
import { ConfigError, ExitCode, errorMessage, InvalidValueError, RetroError } from "../errors.ts";
import { getGitVersion, readGitConfig, supportsConfigEnv } from "../git/exec.ts";
import { findToken, tokenCreationUrl } from "../github/auth.ts";
import { GitHubClient, resolveEndpoints } from "../github/client.ts";
import { noReplyEmail } from "../github/session.ts";
import { formatNumber } from "../ui/format.ts";
import { banner, createOutput, type Runtime } from "./runtime.ts";

type Status = "ok" | "warn" | "fail" | "info";

interface Check {
    name: string;
    status: Status;
    detail: string;
    hint?: string | undefined;
}

function commandExists(command: string): Promise<boolean> {
    return new Promise((resolve) => {
        const child = spawn(command, ["--version"], { stdio: "ignore", windowsHide: true });
        child.on("error", () => resolve(false));
        child.on("close", (code) => resolve(code === 0));
    });
}

/** `retrocommit doctor`: checks everything retrocommit depends on. */
export async function doctorCommand(command: Command, _runtime: Runtime): Promise<number> {
    const flags = command.opts<CommonFlags>();
    const out = createOutput(flags);
    let host: string;
    let apiUrl: string | undefined;
    try {
        host = validateHost(flags.host ?? "github.com");
        apiUrl = flags.apiUrl === undefined ? undefined : validateApiUrl(flags.apiUrl);
    } catch (error) {
        if (error instanceof InvalidValueError) throw new ConfigError(error.message);
        throw error;
    }
    const endpoints = resolveEndpoints(host, apiUrl);
    const checks: Check[] = [];

    out.intro(banner(out));
    const spinner = out.spinner();
    spinner.start("Checking your setup");

    checks.push({
        name: "Node.js",
        status: "ok",
        detail: `${process.version} (needs ${MIN_NODE_VERSION} or newer)`
    });

    let gitOk = false;
    try {
        const version = await getGitVersion();
        gitOk = true;
        checks.push({
            name: "Git",
            status: "ok",
            detail: supportsConfigEnv(version)
                ? version.raw
                : `${version.raw} (older than 2.31: works, but consider updating)`
        });
    } catch (error) {
        checks.push({
            name: "Git",
            status: "fail",
            detail: errorMessage(error),
            hint: error instanceof RetroError ? error.hint : undefined
        });
    }

    if (gitOk) {
        const [name, email] = await Promise.all([
            readGitConfig("user.name"),
            readGitConfig("user.email")
        ]);
        checks.push(
            name && email
                ? { name: "Git identity", status: "ok", detail: `${name} <${email}>` }
                : {
                      name: "Git identity",
                      status: "info",
                      detail: "not configured (only used with --no-push/--remote when there's no token)"
                  }
        );
    }

    let token: { token: string; source: string } | undefined;
    try {
        token = await findToken({ flag: flags.token, host: endpoints.host });
    } catch (error) {
        checks.push({ name: "GitHub token", status: "fail", detail: errorMessage(error) });
    }

    if (!token) {
        if (!checks.some((check) => check.name === "GitHub token")) {
            checks.push({
                name: "GitHub token",
                status: "warn",
                detail: "not found",
                hint: `Needed to create repositories. Create one at ${tokenCreationUrl(endpoints.host, ["repo"])} and set RETROCOMMIT_TOKEN.`
            });
        }
    } else {
        checks.push({ name: "GitHub token", status: "ok", detail: `found in ${token.source}` });
        const client = new GitHubClient({ token: token.token, endpoints, retries: 1 });
        try {
            const viewer = await client.getViewer();
            checks.push({
                name: "GitHub account",
                status: "ok",
                detail: `${viewer.user.login}${viewer.user.name ? ` (${viewer.user.name})` : ""}`
            });
            if (viewer.scopes === null) {
                checks.push({
                    name: "Permissions",
                    status: "info",
                    detail: `${viewer.tokenKind} token (its permissions can't be listed)`,
                    hint: "It needs Administration and Contents set to “Read and write” for the repositories."
                });
            } else {
                const has = (scope: string) => viewer.scopes?.includes(scope) ?? false;
                checks.push({
                    name: "Scope: repo",
                    status: has("repo") ? "ok" : has("public_repo") ? "warn" : "fail",
                    detail: has("repo")
                        ? "can create private and public repositories"
                        : has("public_repo")
                          ? "only public repositories (public_repo)"
                          : "missing: can't create repositories",
                    hint: has("repo")
                        ? undefined
                        : `Create a token with it: ${tokenCreationUrl(endpoints.host, ["repo"])}`
                });
                checks.push({
                    name: "Scope: delete_repo",
                    status: has("delete_repo") ? "ok" : "info",
                    detail: has("delete_repo")
                        ? "`retrocommit delete` will work"
                        : "missing (only needed by `retrocommit delete`)"
                });
            }
            checks.push({
                name: "Commit email",
                status: "ok",
                detail: `${noReplyEmail(viewer.user, endpoints.host)} (no-reply, always counts)`
            });
            const limit = await client.rateLimit();
            checks.push({
                name: "API rate limit",
                status: limit.remaining > 50 ? "ok" : "warn",
                detail: `${formatNumber(limit.remaining)} of ${formatNumber(limit.limit)} requests left`
            });
        } catch (error) {
            checks.push({
                name: "GitHub account",
                status: "fail",
                detail: errorMessage(error),
                hint: error instanceof RetroError ? error.hint : undefined
            });
        }
    }

    const hasGh = await commandExists("gh");
    checks.push({
        name: "GitHub CLI",
        status: "info",
        detail: hasGh
            ? "installed (its login can be used as the token)"
            : "not installed (optional)"
    });
    spinner.stop("Checked your setup");

    const failed = checks.some((check) => check.status === "fail");
    if (out.mode === "json") {
        out.json({ ok: !failed, checks });
        return failed ? ExitCode.Failure : ExitCode.Success;
    }

    const { c } = out;
    const symbols: Record<Status, string> = out.unicode
        ? { ok: c.green("✔"), warn: c.yellow("⚠"), fail: c.red("✖"), info: c.blue("ℹ") }
        : { ok: c.green("[ok]"), warn: c.yellow("[!]"), fail: c.red("[x]"), info: c.blue("[i]") };
    const width = Math.max(...checks.map((check) => check.name.length));
    const lines = checks.flatMap((check) => {
        const row = `${symbols[check.status]} ${check.name.padEnd(width)}  ${check.detail}`;
        return check.hint ? [row, `  ${" ".repeat(width)}  ${c.dim(`→ ${check.hint}`)}`] : [row];
    });
    out.block(lines.join("\n"));
    const warned = checks.some((check) => check.status === "warn");
    out.outro(
        failed
            ? c.red("Some checks failed: see the hints above.")
            : warned
              ? c.yellow("Almost ready: see the warnings above.")
              : c.green("Everything is ready.")
    );
    return failed ? ExitCode.Failure : ExitCode.Success;
}
