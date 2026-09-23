import * as clack from "@clack/prompts";
import type { Command } from "commander";
import type { CommonFlags } from "../cli/flags.ts";
import {
    validateApiUrl,
    validateHost,
    validateOwnerName,
    validateRepoName
} from "../config/validate.ts";
import { MARKER_TOPIC } from "../constants.ts";
import {
    CancelledError,
    ConfigError,
    ExitCode,
    GitHubError,
    InvalidValueError,
    RetroError
} from "../errors.ts";
import { tokenCreationUrl } from "../github/auth.ts";
import { resolveEndpoints } from "../github/client.ts";
import { connectGitHub, type GitHubSession } from "../github/session.ts";
import { table } from "../ui/format.ts";
import { banner, createOutput, type Runtime } from "./runtime.ts";

/** Splits `owner/name` or `name`. */
export function parseRepoArgument(input: string): { owner: string | undefined; name: string } {
    const parts = input
        .trim()
        .replace(/\.git$/i, "")
        .split("/");
    try {
        if (parts.length === 1) return { owner: undefined, name: validateRepoName(parts[0] ?? "") };
        if (parts.length === 2) {
            return {
                owner: validateOwnerName(parts[0] ?? ""),
                name: validateRepoName(parts[1] ?? "")
            };
        }
    } catch (error) {
        if (error instanceof InvalidValueError) throw new ConfigError(error.message);
        throw error;
    }
    throw new ConfigError(`"${input}" isn't a repository. Use "name" or "owner/name".`);
}

/** `retrocommit delete <repo>`: deletes a repository created by retrocommit (the "undo"). */
export async function deleteCommand(
    repoArgument: string,
    command: Command,
    runtime: Runtime
): Promise<number> {
    const flags = command.opts<CommonFlags>();
    const out = createOutput(flags);
    const target = parseRepoArgument(repoArgument);
    let endpoints: ReturnType<typeof resolveEndpoints>;
    try {
        endpoints = resolveEndpoints(
            validateHost(flags.host ?? "github.com"),
            flags.apiUrl === undefined ? undefined : validateApiUrl(flags.apiUrl)
        );
    } catch (error) {
        if (error instanceof InvalidValueError) throw new ConfigError(error.message);
        throw error;
    }

    out.intro(banner(out));
    const session = (await connectGitHub(out, {
        endpoints,
        flagToken: flags.token,
        required: true,
        reason: "delete the repository",
        scopes: ["delete_repo"],
        signal: runtime.signal
    })) as GitHubSession;
    const owner = target.owner ?? session.viewer.user.login;
    const repo = await session.client.getRepo(owner, target.name);
    if (!repo) {
        throw new RetroError(`${owner}/${target.name} doesn't exist (or your token can't see it).`);
    }
    if (!repo.topics.includes(MARKER_TOPIC) && !flags.force) {
        throw new RetroError(
            `${repo.fullName} doesn't have the "${MARKER_TOPIC}" topic, so it doesn't look like a repository created by retrocommit.`,
            { hint: "Add --force if you're sure you want to delete it anyway." }
        );
    }

    out.note(
        table([
            ["Repository", repo.fullName],
            ["Visibility", repo.private ? "private" : "public"],
            ["Created", repo.createdAt.slice(0, 10)],
            ["URL", repo.htmlUrl]
        ]),
        "About to delete"
    );

    if (!flags.yes) {
        if (!out.canPrompt) {
            throw new RetroError(
                "Refusing to delete without confirmation in a non-interactive terminal.",
                {
                    exitCode: ExitCode.Usage,
                    hint: "Add --yes to confirm."
                }
            );
        }
        const typed = await clack.text({
            output: out.stdout,
            message: `Type ${out.c.bold(repo.fullName)} to confirm. This can't be undone.`,
            validate: (value) =>
                value?.trim() === repo.fullName ? undefined : `Type exactly ${repo.fullName}`
        });
        if (clack.isCancel(typed)) throw new CancelledError("Nothing was deleted.");
    }

    const spinner = out.spinner();
    spinner.start(`Deleting ${repo.fullName}`);
    try {
        await session.client.deleteRepo(repo.owner, repo.name);
    } catch (error) {
        spinner.fail(`Could not delete ${repo.fullName}`);
        if (error instanceof GitHubError && error.status === 403) {
            throw new GitHubError(`GitHub didn't allow deleting ${repo.fullName}.`, {
                status: 403,
                hint: `Deleting needs a token with the "delete_repo" scope: ${tokenCreationUrl(endpoints.host, ["delete_repo"])} (GitHub CLI users: gh auth refresh -s delete_repo).`
            });
        }
        throw error;
    }
    spinner.stop(`Deleted ${repo.fullName}`);

    if (out.mode === "json") {
        out.json({ ok: true, deleted: repo.fullName });
        return ExitCode.Success;
    }
    out.outro(
        `${repo.fullName} is gone. Its contributions will disappear from your graph shortly.`
    );
    return ExitCode.Success;
}
