import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as clack from "@clack/prompts";
import type { Command } from "commander";
import { removeDirOnExit } from "../cleanup.ts";
import { assertNoIssues, flagsToConfig, type GenerationFlags } from "../cli/flags.ts";
import {
    buildLayers,
    mergeLayers,
    type ResolvedOptions,
    resolveOptions
} from "../config/resolve.ts";
import type { RawConfig } from "../config/schema.ts";
import { validateAuthorName, validateEmail } from "../config/validate.ts";
import { MARKER_TOPIC, VERSION } from "../constants.ts";
import { generateCommits } from "../core/commits.ts";
import { type Day, formatDay } from "../core/dates.ts";
import { describeWeekdays, formatClock } from "../core/parse.ts";
import { buildPlan, type Plan } from "../core/planner.ts";
import { summarize } from "../core/stats.ts";
import { localDayOf, resolveZone, type Zone } from "../core/timezone.ts";
import {
    CancelledError,
    ConfigError,
    ExitCode,
    errorMessage,
    InvalidValueError,
    RetroError
} from "../errors.ts";
import { type GitVersion, getGitVersion, readGitConfig } from "../git/exec.ts";
import { fastImportStream, type Identity, runFastImport } from "../git/fast-import.ts";
import {
    addRemote,
    checkoutWorktree,
    fetchBranch,
    type GitAuth,
    initRepository,
    listRemoteBranches,
    pushBranch,
    type RemoteContext,
    remoteDefaultBranch
} from "../git/repository.ts";
import { hasRepoScope, requiredScopes, tokenCreationUrl } from "../github/auth.ts";
import type { GitHubRepo } from "../github/client.ts";
import { fetchContributions } from "../github/contributions.ts";
import { connectGitHub, type GitHubSession, noReplyEmail } from "../github/session.ts";
import { formatDuration, formatNumber, formatRange, percent, plural, table } from "../ui/format.ts";
import { renderGraph } from "../ui/graph.ts";
import type { Output } from "../ui/output.ts";
import { offerToSaveConfig, runWizard } from "../wizard.ts";
import { banner, createOutput, loadConfig, type Runtime } from "./runtime.ts";

type Mode = "run" | "preview";

/** Where the commits end up. */
interface Target {
    kind: "github" | "remote" | "local";
    /** Push URL (without credentials). */
    url?: string | undefined;
    auth?: GitAuth | undefined;
    branch: string;
    /** Build on top of the remote branch (`--if-exists append`). */
    append: boolean;
    /** Overwrite the remote branch (`--if-exists replace`). */
    replace: boolean;
    expectedSha?: string | undefined;
    /** For confirmations: "to github.com/you/repo (new, private)". */
    label: string;
    github?:
        | {
              owner: string;
              name: string;
              isOrg: boolean;
              existing: GitHubRepo | null;
          }
        | undefined;
}

interface Workspace {
    path: string;
    dispose(success: boolean): Promise<void>;
}

async function createWorkspace(output: string | undefined): Promise<Workspace> {
    if (output) {
        const existed = existsSync(output);
        await mkdir(output, { recursive: true });
        const unregister = existed ? undefined : removeDirOnExit(output);
        return {
            path: output,
            async dispose(success) {
                unregister?.();
                if (success) return;
                await rm(output, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
                if (existed) await mkdir(output, { recursive: true });
            }
        };
    }
    const path = await mkdtemp(join(tmpdir(), "retrocommit-"));
    const unregister = removeDirOnExit(path);
    return {
        path,
        async dispose() {
            await rm(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
            unregister();
        }
    };
}

async function confirm(out: Output, yes: boolean | undefined, message: string): Promise<boolean> {
    if (yes) return true;
    if (!out.canPrompt) {
        throw new RetroError(
            "Refusing to continue without confirmation in a non-interactive terminal.",
            {
                exitCode: ExitCode.Usage,
                hint: "Add --yes to confirm (or --dry-run to only preview)."
            }
        );
    }
    const answer = await clack.confirm({ message, output: out.stdout });
    if (clack.isCancel(answer)) throw new CancelledError();
    return answer;
}

function checkScopes(session: GitHubSession, options: ResolvedOptions): void {
    const { scopes } = session.viewer;
    if (scopes === null || hasRepoScope(scopes, options.visibility)) return;
    const needed = requiredScopes(options.visibility).join(", ");
    throw new RetroError(
        `Your token (from ${session.source}) doesn't have the "${needed}" scope needed to create ${options.visibility} repositories and push to them.`,
        {
            hint: `Create a token with the right scope at ${tokenCreationUrl(options.endpoints.host, requiredScopes(options.visibility))}`
        }
    );
}

/** The host name of a remote URL (`https://host/…`, `ssh://host:22/…` or `user@host:path`). */
export function remoteHost(url: string): string | undefined {
    const scp = /^[^@/\s]+@([^:/\s]+):/.exec(url);
    if (scp) return scp[1]?.toLowerCase();
    try {
        const parsed = new URL(url);
        return parsed.protocol === "file:" ? undefined : parsed.hostname.toLowerCase();
    } catch {
        return undefined;
    }
}

/** Whether pushes go to the configured GitHub host (so its no-reply email counts). */
function pushesToGitHub(options: ResolvedOptions): boolean {
    if (options.remote === undefined) return true;
    return remoteHost(options.remote) === options.endpoints.host.split(":")[0];
}

async function resolveIdentity(
    out: Output,
    options: ResolvedOptions,
    session: GitHubSession | undefined
): Promise<Identity> {
    const { host, webUrl } = options.endpoints;
    let name = options.authorName;
    let email = options.authorEmail;
    // The GitHub no-reply address only makes sense when the commits end up on that GitHub.
    if (session && pushesToGitHub(options)) {
        name ??= session.viewer.user.name ?? session.viewer.user.login;
        email ??= noReplyEmail(session.viewer.user, host);
    }
    name ??= await readGitConfig("user.name");
    email ??= await readGitConfig("user.email");
    if (!name || !email) {
        throw new ConfigError("Couldn't work out who the commit author should be.", {
            hint: "Pass --author-name and --author-email, or set a GitHub token (RETROCOMMIT_TOKEN) so your no-reply address is used."
        });
    }

    let identity: Identity;
    try {
        identity = { name: validateAuthorName(name), email: validateEmail(email) };
    } catch (error) {
        if (!(error instanceof InvalidValueError)) throw error;
        throw new ConfigError(`Invalid commit author: ${error.message}.`, {
            hint: "Fix it with --author-name / --author-email."
        });
    }

    const noReply = identity.email.toLowerCase().endsWith(`@users.noreply.${host}`);
    if (session && options.authorEmail && !noReply) {
        const emails = await session.client.listEmails().catch(() => null);
        const verified = emails?.some(
            (item) => item.verified && item.email.toLowerCase() === identity.email.toLowerCase()
        );
        if (emails && !verified) {
            out.warn(
                `${identity.email} isn't a verified email of your GitHub account, so these commits won't count. Add it at ${webUrl}/settings/emails or drop --author-email.`
            );
        }
    } else if (!session && !noReply) {
        out.info(
            `Commits will be authored by ${identity.email}. They only count if that email is added to your GitHub account (${webUrl}/settings/emails).`
        );
    }
    return identity;
}

function scheduleSummary(options: ResolvedOptions): string {
    if (options.art) {
        const what =
            options.art.kind === "text"
                ? `text "${options.art.label}"`
                : `pattern ${options.art.label}`;
        return `${what} · ${plural(options.art.intensity, "commit")} per dark square`;
    }
    const { commits, frequency, weekdays, distribution } = options.schedule;
    const amount = commits.min === commits.max ? `${commits.min}` : `${commits.min}–${commits.max}`;
    return `${amount} per day · ${describeWeekdays(weekdays)} · ${frequency}% of days · ${distribution}`;
}

function fillSummary(
    options: ResolvedOptions,
    plan: Plan,
    existing: Map<Day, number> | undefined
): string {
    if (options.fill === "all") return "every selected day";
    const busy = plan.days.filter((day) => day.existing > 0).length;
    const found = existing ? ` (${plural(busy, "day")} already had contributions)` : "";
    return options.fill === "gaps"
        ? `only days without contributions${found}`
        : `top up each day to its target${found}`;
}

function destinationSummary(options: ResolvedOptions, session: GitHubSession | undefined): string {
    if (!options.push) return `local folder ${options.output}`;
    if (options.remote) return options.remote;
    const owner = options.owner ?? session?.viewer.user.login ?? "<you>";
    return `${options.endpoints.host}/${owner}/${options.repo} (${options.visibility})`;
}

function previewJson(options: ResolvedOptions, plan: Plan, existing: Map<Day, number> | undefined) {
    const stats = summarize(plan.days.map((day) => day.count));
    return {
        version: VERSION,
        seed: plan.seed,
        timezone: options.zone.name,
        from: formatDay(plan.from),
        to: formatDay(plan.to),
        fill: options.fill,
        totalCommits: plan.total,
        activeDays: stats.activeDays,
        maxPerDay: stats.max,
        days: plan.days.map((day) => ({
            date: formatDay(day.day),
            commits: day.count,
            ...(existing ? { existing: day.existing } : {})
        }))
    };
}

/** Decides where to push and how, checking the repository before anything is created. */
async function prepareTarget(
    out: Output,
    options: ResolvedOptions,
    flags: GenerationFlags,
    session: GitHubSession | undefined,
    git: GitVersion,
    directory: string,
    signal: AbortSignal
): Promise<Target> {
    if (!options.push) {
        return {
            kind: "local",
            branch: options.branch,
            append: false,
            replace: false,
            label: `in ${options.output}`
        };
    }

    if (options.remote !== undefined) {
        const auth: GitAuth = { kind: "system", interactive: out.canPrompt };
        const context: RemoteContext = {
            directory,
            url: options.remote,
            auth,
            version: git,
            signal
        };
        out.step(`Checking ${options.remote}`);
        const branches = await listRemoteBranches(context);
        const remoteHead = branches.size > 0 ? await remoteDefaultBranch(context) : undefined;
        const branch = options.branchExplicit ? options.branch : (remoteHead ?? options.branch);
        if (remoteHead && branch !== remoteHead) {
            out.warn(
                `The remote's default branch is "${remoteHead}"; commits on "${branch}" won't count until it becomes the default.`
            );
        }
        const sha = branches.get(branch);
        return decideExisting(out, options, flags, {
            kind: "remote",
            url: options.remote,
            auth,
            branch,
            append: false,
            replace: false,
            label: `and push them to ${options.remote}`,
            expectedSha: sha,
            hasCommits: sha !== undefined,
            markerTopic: undefined
        });
    }

    if (!session) throw new RetroError("A GitHub token is required to push to GitHub.");
    const { client, viewer } = session;
    const { host } = options.endpoints;
    const owner = options.owner ?? viewer.user.login;
    const isOrg = owner.toLowerCase() !== viewer.user.login.toLowerCase();
    const name = options.repo;
    const url =
        options.protocol === "ssh"
            ? `git@${host}:${owner}/${name}.git`
            : `https://${host}/${owner}/${name}.git`;
    const auth: GitAuth =
        options.protocol === "ssh"
            ? { kind: "system", interactive: out.canPrompt }
            : { kind: "token", token: session.token, host };

    const spinner = out.spinner();
    spinner.start(`Checking ${owner}/${name} on GitHub`);
    const existing = await client.getRepo(owner, name);
    if (!existing) {
        spinner.stop(`${owner}/${name} doesn't exist yet: it will be created`);
        return {
            kind: "github",
            url,
            auth,
            branch: options.branch,
            append: false,
            replace: false,
            label: `and push them to a new ${options.visibility} repository ${owner}/${name}`,
            github: { owner, name, isOrg, existing: null }
        };
    }

    if (existing.fork) {
        spinner.fail(`${existing.fullName} is a fork`);
        throw new RetroError(
            `${existing.fullName} is a fork, and commits in forks don't count as contributions.`,
            {
                hint: "Choose another name with --repo."
            }
        );
    }
    if (existing.archived) {
        spinner.fail(`${existing.fullName} is archived`);
        throw new RetroError(`${existing.fullName} is archived (read-only).`, {
            hint: "Choose another name with --repo."
        });
    }
    if (!existing.canPush) {
        spinner.fail(`No push access to ${existing.fullName}`);
        throw new RetroError(`You don't have push access to ${existing.fullName}.`, {
            hint: "Choose another name with --repo."
        });
    }

    const context: RemoteContext = { directory, url, auth, version: git, signal };
    const branches = await listRemoteBranches(context);
    spinner.stop(
        `${existing.fullName} already exists ${out.c.dim(`(${existing.private ? "private" : "public"})`)}`
    );

    if (branches.size === 0) {
        out.info(`${existing.fullName} is empty, so it will be used as is.`);
        return {
            kind: "github",
            url,
            auth,
            branch: options.branch,
            append: false,
            replace: false,
            label: `and push them to ${existing.fullName}`,
            github: { owner, name, isOrg, existing }
        };
    }

    const branch = options.branchExplicit ? options.branch : existing.defaultBranch;
    if (options.ifExists !== "fail" && branch !== existing.defaultBranch) {
        throw new RetroError(
            `Commits on "${branch}" won't count: the default branch of ${existing.fullName} is "${existing.defaultBranch}".`,
            { hint: `Remove --branch to use "${existing.defaultBranch}".` }
        );
    }
    const sha = branches.get(branch);
    return decideExisting(out, options, flags, {
        kind: "github",
        url,
        auth,
        branch,
        append: false,
        replace: false,
        label: `and push them to ${existing.fullName}`,
        github: { owner, name, isOrg, existing },
        expectedSha: sha,
        hasCommits: true,
        markerTopic: existing.topics.includes(MARKER_TOPIC)
    });
}

/** Applies --if-exists to a repository that already has commits. */
function decideExisting(
    out: Output,
    options: ResolvedOptions,
    flags: GenerationFlags,
    target: Target & { hasCommits: boolean; markerTopic: boolean | undefined }
): Target {
    const { hasCommits, markerTopic, ...base } = target;
    if (!hasCommits) return base;
    const where = base.github ? `${base.github.owner}/${base.github.name}` : base.url;

    switch (options.ifExists) {
        case "append":
            if (markerTopic === false) {
                out.warn(
                    `${where} wasn't created by retrocommit; the new commits will be added on top of its history.`
                );
            }
            return {
                ...base,
                append: true,
                label: `on top of the history of ${where} (${base.branch})`
            };
        case "replace":
            if (markerTopic !== true && !flags.force) {
                throw new RetroError(
                    markerTopic === false
                        ? `Refusing to overwrite ${where}: it doesn't have the "${MARKER_TOPIC}" topic, so it doesn't look like a repository created by retrocommit.`
                        : `Refusing to overwrite the "${base.branch}" branch of ${where} without --force.`,
                    { hint: "Add --force if you really want to replace its history." }
                );
            }
            return {
                ...base,
                replace: true,
                label: `and ${out.c.red("replace")} the history of ${where} (${base.branch})`
            };
        default:
            throw new RetroError(`${where} already has commits on "${base.branch}".`, {
                hint: `Use --if-exists append to add the new commits on top, --if-exists replace to overwrite them, or ${base.github ? "--repo to use another repository" : "another --remote"}.`
            });
    }
}

/**
 * `retrocommit` / `retrocommit run` / `retrocommit preview`: plans the commits,
 * shows them, and (unless previewing) creates and pushes them.
 */
export async function generateCommand(
    command: Command,
    runtime: Runtime,
    mode: Mode
): Promise<number> {
    const flags = command.opts<GenerationFlags>();
    const out = createOutput(flags);
    const dryRun = mode === "preview" || Boolean(flags.dryRun);
    const { signal } = runtime;

    const { values: flagValues, issues: flagIssues } = flagsToConfig(command);
    const file = await loadConfig(flags, runtime.cwd, out);
    const noArguments = runtime.argv.length === 0;
    const useWizard = Boolean(flags.interactive) || (mode === "run" && noArguments && !file);
    if (useWizard && !out.canPrompt) {
        if (flags.interactive) {
            throw new ConfigError("The interactive assistant needs a terminal.", {
                hint: "Pass the options as flags instead (see `retrocommit --help`)."
            });
        }
        command.outputHelp();
        return ExitCode.Usage;
    }

    out.intro(banner(out));
    let wizard: RawConfig | undefined;
    if (useWizard) {
        assertNoIssues(flagIssues);
        const initial = mergeLayers(buildLayers({ file, flags: flagValues })).values;
        let zone: Zone;
        try {
            zone = resolveZone(initial.timezone);
        } catch {
            zone = resolveZone();
        }
        wizard = await runWizard({ initial, today: localDayOf(runtime.now.getTime(), zone), out });
    }

    const options = await resolveOptions(
        mergeLayers(buildLayers({ file, wizard, flags: flagValues })),
        {
            now: runtime.now,
            cwd: runtime.cwd,
            issues: flagIssues
        }
    );
    for (const warning of options.warnings) out.warn(warning);
    signal.throwIfAborted();

    const apiMode = options.push && options.remote === undefined;
    const needsGraph = options.fill !== "all";
    const git = dryRun ? undefined : await getGitVersion();
    if (git) out.verbose(`git ${git.raw}`);

    // GitHub: required to create repositories or read the graph; optional otherwise
    // (it lets us use the account's no-reply email as the author).
    const requireToken = needsGraph || (!dryRun && apiMode);
    const wantToken =
        requireToken ||
        (!dryRun && pushesToGitHub(options) && (!options.authorName || !options.authorEmail));
    const session = wantToken
        ? await connectGitHub(out, {
              endpoints: options.endpoints,
              flagToken: flags.token,
              required: requireToken,
              reason: dryRun
                  ? "read your contribution graph"
                  : "create the repository and push to it",
              scopes: requiredScopes(options.visibility),
              signal
          })
        : undefined;
    if (session && apiMode && !dryRun) checkScopes(session, options);
    signal.throwIfAborted();

    let existing: Map<Day, number> | undefined;
    if (needsGraph && session) {
        const spinner = out.spinner();
        spinner.start(`Reading ${session.viewer.user.login}'s contribution graph`);
        existing = await fetchContributions(
            session.client,
            session.viewer.user.login,
            options.from,
            options.to
        );
        const busy = [...existing.values()].filter((count) => count > 0).length;
        spinner.stop(
            `Found contributions on ${plural(busy, "day")} of ${formatRange(options.from, options.to)}`
        );
    }

    const plan = buildPlan({
        from: options.from,
        to: options.to,
        seed: options.seed,
        fill: options.fill,
        schedule: options.schedule,
        art: options.art?.targets,
        existing,
        time: options.time,
        today: options.today,
        nowSecondOfDay: options.nowSecondOfDay,
        allowFuture: options.allowFuture
    });

    if (session?.viewer.user.createdAt) {
        const created = localDayOf(Date.parse(session.viewer.user.createdAt), options.zone);
        if (Number.isFinite(created) && plan.from < created) {
            out.warn(
                `Your account was created on ${formatDay(created)}; GitHub may not show contributions from before that date.`
            );
        }
    }

    const identity = dryRun ? undefined : await resolveIdentity(out, options, session);
    const stats = summarize(plan.days.map((day) => day.count));
    const rows: Array<[string, string]> = [
        [
            "Period",
            `${formatRange(plan.from, plan.to)} ${out.c.dim(`(${plural(plan.days.length, "day")})`)}`
        ],
        [options.art ? "Drawing" : "Schedule", scheduleSummary(options)],
        ["Fill", fillSummary(options, plan, existing)],
        [
            "Commits",
            `${out.c.green(out.c.bold(formatNumber(plan.total)))} on ${plural(stats.activeDays, "day")} ${out.c.dim(
                `(${percent(stats.activeDays, stats.days)} of days, max ${stats.max}/day, longest streak ${plural(stats.longestStreak, "day")})`
            )}`
        ],
        [
            "Times",
            `${formatClock(options.time.start)}–${formatClock(options.time.end)} (${options.zone.name})`
        ]
    ];
    if (identity) rows.push(["Author", `${identity.name} <${identity.email}>`]);
    rows.push(["Destination", destinationSummary(options, session)]);
    rows.push(["Seed", options.seed]);
    out.note(table(rows), dryRun ? "Preview" : "Plan");

    if (flags.graph !== false && out.mode !== "json" && out.mode !== "quiet") {
        const counts = new Map<Day, number>();
        for (const day of plan.days) counts.set(day.day, day.count + day.existing);
        out.block(renderGraph(counts, plan.from, plan.to, { ...out.graphStyle, width: out.width }));
    }
    for (const note of plan.notes) out.info(note);

    if (plan.total > options.maxCommits) {
        throw new ConfigError(
            `The plan has ${formatNumber(plan.total)} commits, more than the safety limit of ${formatNumber(options.maxCommits)}.`,
            {
                hint: "Use a shorter range or fewer commits per day, or raise the limit with --max-commits."
            }
        );
    }

    if (dryRun) {
        if (out.mode === "json") out.json(previewJson(options, plan, existing));
        else {
            out.outro(
                `Preview only, nothing was created. To create exactly this plan, run it for real with ${out.c.cyan(`--seed ${options.seed}`)}.`
            );
        }
        return ExitCode.Success;
    }

    if (plan.total === 0) {
        if (out.mode === "json") out.json({ ok: true, commits: 0, seed: plan.seed });
        else out.outro("Nothing to create: the plan has no commits for these options.");
        return ExitCode.Success;
    }

    const version = git as GitVersion;
    const author = identity as Identity;
    const workspace = await createWorkspace(options.output);
    let success = false;
    try {
        const target = await prepareTarget(
            out,
            options,
            flags,
            session,
            version,
            workspace.path,
            signal
        );
        signal.throwIfAborted();

        const accepted = await confirm(
            out,
            flags.yes,
            `Create ${plural(plan.total, "commit")} ${target.label}?`
        );
        if (!accepted) {
            out.outro("Nothing was created.");
            return ExitCode.Success;
        }

        // 1. Generate the history locally with git fast-import.
        const started = performance.now();
        await initRepository(workspace.path, target.branch);
        const context: RemoteContext | undefined =
            target.url && target.auth
                ? { directory: workspace.path, url: target.url, auth: target.auth, version, signal }
                : undefined;

        const spinner = out.spinner();
        spinner.start(`Generating ${plural(plan.total, "commit")}`);
        let parent: string | undefined;
        if (target.append && context) {
            spinner.message("Downloading the current history");
            parent = `${await fetchBranch(context, target.branch)}^0`;
        }
        let written = 0;
        const commits = generateCommits(plan, {
            zone: options.zone,
            time: options.time,
            message: options.message,
            messages: options.messages
        });
        const tracked = (function* () {
            for (const commit of commits) {
                written++;
                if (written % 500 === 0) {
                    spinner.message(
                        `Generating commits ${formatNumber(written)}/${formatNumber(plan.total)}`
                    );
                }
                yield commit;
            }
        })();
        try {
            await runFastImport(
                workspace.path,
                fastImportStream(tracked, {
                    branch: target.branch,
                    author,
                    content: options.content,
                    contentPath: options.contentPath,
                    readme: parent ? undefined : options.readme,
                    parent
                }),
                { signal }
            );
        } catch (error) {
            spinner.fail("Could not generate the commits");
            throw error;
        }
        spinner.stop(
            `Generated ${plural(plan.total, "commit")} in ${formatDuration(performance.now() - started)}`
        );

        if (options.output) {
            await checkoutWorktree(workspace.path);
            if (target.url) await addRemote(workspace.path, "origin", target.url);
        }

        // 2. Create the repository (if needed) and push.
        let repoUrl: string | undefined;
        let created = false;
        if (target.kind === "github" && target.github && context) {
            const { client } = session as GitHubSession;
            const { owner, name, isOrg } = target.github;
            let repo = target.github.existing;
            if (!repo) {
                const creating = out.spinner();
                creating.start(`Creating ${options.visibility} repository ${owner}/${name}`);
                try {
                    repo = await client.createRepo({
                        name,
                        description: options.description,
                        private: options.visibility === "private",
                        org: isOrg ? owner : undefined
                    });
                } catch (error) {
                    creating.fail(`Could not create ${owner}/${name}`);
                    throw error;
                }
                created = true;
                creating.stop(`Created ${repo.fullName}`);
                if (options.topics.length > 0) {
                    await client
                        .replaceTopics(owner, name, options.topics)
                        .catch((error: unknown) => {
                            out.warn(`Couldn't add the topics (${errorMessage(error)}).`);
                        });
                }
            }
            repoUrl = repo.htmlUrl;
        }

        if (context) {
            const pushing = `Pushing ${plural(plan.total, "commit")} to ${target.github ? `${target.github.owner}/${target.github.name}` : target.url}`;
            const interactiveAuth = context.auth.kind === "system" && context.auth.interactive;
            const spinner2 = interactiveAuth ? undefined : out.spinner();
            if (spinner2) spinner2.start(pushing);
            else out.step(`${pushing} (using your git credentials)`);
            const pushStarted = performance.now();
            try {
                await pushBranch(context, {
                    branch: target.branch,
                    force: target.replace,
                    expectedSha: target.replace ? target.expectedSha : undefined
                });
            } catch (error) {
                spinner2?.fail("The push failed");
                if (created && error instanceof RetroError) {
                    const reuse =
                        "The repository was created but is still empty; running the same command again will reuse it.";
                    throw new RetroError(error.message, {
                        details: error.details,
                        hint: error.hint ? `${error.hint} ${reuse}` : reuse,
                        cause: error
                    });
                }
                throw error;
            }
            const pushed = `Pushed in ${formatDuration(performance.now() - pushStarted)}`;
            if (spinner2) spinner2.stop(pushed);
            else out.success(pushed);

            if (
                target.kind === "github" &&
                target.github &&
                (created || target.replace || !target.append)
            ) {
                const { client } = session as GitHubSession;
                const current = await client
                    .getRepo(target.github.owner, target.github.name)
                    .catch(() => null);
                if (current && current.defaultBranch !== target.branch) {
                    await client
                        .setDefaultBranch(target.github.owner, target.github.name, target.branch)
                        .catch((error: unknown) =>
                            out.warn(
                                `Couldn't make "${target.branch}" the default branch (${errorMessage(error)}); do it on GitHub so the commits count.`
                            )
                        );
                }
            }
        }
        success = true;

        // 3. Done.
        if (out.mode === "json") {
            out.json({
                ok: true,
                commits: plan.total,
                activeDays: stats.activeDays,
                seed: plan.seed,
                from: formatDay(plan.from),
                to: formatDay(plan.to),
                repository: target.github
                    ? {
                          fullName: `${target.github.owner}/${target.github.name}`,
                          url: repoUrl ?? null,
                          visibility: target.github.existing
                              ? target.github.existing.private
                                  ? "private"
                                  : "public"
                              : options.visibility,
                          created
                      }
                    : null,
                remote: target.kind === "remote" ? target.url : null,
                output: options.output ?? null
            });
            return ExitCode.Success;
        }

        const destination = repoUrl ?? (target.kind === "remote" ? target.url : options.output);
        const finalLine = `Done! Created ${plural(plan.total, "commit")}${destination ? ` → ${destination}` : ""}`;
        if (out.mode === "quiet") {
            out.outro(finalLine);
            return ExitCode.Success;
        }

        const lines: string[] = [];
        const { webUrl } = options.endpoints;
        if (target.github && session) {
            lines.push(`Your profile   ${out.c.cyan(`${webUrl}/${session.viewer.user.login}`)}`);
            lines.push(
                `Repository     ${out.c.cyan(repoUrl ?? `${webUrl}/${target.github.owner}/${target.github.name}`)}`
            );
        }
        if (target.kind === "remote") lines.push(`Remote         ${target.url}`);
        if (options.output) lines.push(`Local copy     ${options.output}`);
        if (lines.length > 0) lines.push("");
        if (target.github) {
            const repoPrivate = target.github.existing
                ? target.github.existing.private
                : options.visibility === "private";
            if (repoPrivate) {
                lines.push(
                    out.c.yellow(
                        "The repository is private: enable “Include private contributions on my"
                    ),
                    out.c.yellow(`profile” at ${webUrl}/settings/profile so these commits show up.`)
                );
            }
            lines.push("GitHub can take a few minutes (up to 24 hours) to update your graph.");
            lines.push(
                `Undo it anytime: ${out.c.cyan(`retrocommit delete ${target.github.owner}/${target.github.name}`)}`
            );
        } else if (target.kind === "local") {
            lines.push(
                `Push it yourself: cd ${options.output} && git remote add origin <url> && git push -u origin ${target.branch}`
            );
        } else {
            lines.push("GitHub can take a few minutes (up to 24 hours) to update your graph.");
        }
        out.note(lines.join("\n"), "Next steps");
        if (wizard) await offerToSaveConfig(out, { ...wizard, ...flagValues }, runtime.cwd);
        out.outro(`${finalLine}${out.unicode ? " 🌱" : ""}`);
        return ExitCode.Success;
    } finally {
        await workspace.dispose(success);
    }
}
