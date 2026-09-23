import type { Command } from "commander";
import { flagsToConfig, type GenerationFlags } from "../cli/flags.ts";
import { buildLayers, mergeLayers, resolveOptions } from "../config/resolve.ts";
import { validateOwnerName } from "../config/validate.ts";
import { type Day, formatDay } from "../core/dates.ts";
import { summarize } from "../core/stats.ts";
import { ConfigError, ExitCode, InvalidValueError } from "../errors.ts";
import { fetchContributions } from "../github/contributions.ts";
import { connectGitHub, type GitHubSession } from "../github/session.ts";
import { formatNumber, formatRange, percent, plural, table } from "../ui/format.ts";
import { renderGraph } from "../ui/graph.ts";
import { banner, createOutput, type Runtime } from "./runtime.ts";

interface GraphFlags extends GenerationFlags {
    user?: string;
}

/** `retrocommit graph`: draws a user's real contribution graph in the terminal. */
export async function graphCommand(command: Command, runtime: Runtime): Promise<number> {
    const flags = command.opts<GraphFlags>();
    const out = createOutput(flags);
    const { values, issues } = flagsToConfig(command);
    const options = await resolveOptions(mergeLayers(buildLayers({ flags: values })), {
        now: runtime.now,
        cwd: runtime.cwd,
        issues
    });

    let user: string | undefined;
    if (flags.user !== undefined) {
        try {
            user = validateOwnerName(flags.user);
        } catch (error) {
            if (error instanceof InvalidValueError)
                throw new ConfigError(`--user: ${error.message}`);
            throw error;
        }
    }

    out.intro(banner(out));
    const session = (await connectGitHub(out, {
        endpoints: options.endpoints,
        flagToken: flags.token,
        required: true,
        reason: "read contribution graphs",
        scopes: ["read:user"],
        signal: runtime.signal
    })) as GitHubSession;
    const login = user ?? session.viewer.user.login;

    const spinner = out.spinner();
    spinner.start(`Reading ${login}'s contributions`);
    let counts: Map<Day, number>;
    try {
        counts = await fetchContributions(session.client, login, options.from, options.to);
    } catch (error) {
        spinner.fail("Could not read the contributions");
        throw error;
    }
    spinner.stop(`Read ${formatRange(options.from, options.to)}`);

    const series: number[] = [];
    for (let day = options.from; day <= options.to; day++) series.push(counts.get(day) ?? 0);
    const stats = summarize(series);

    if (out.mode === "json") {
        out.json({
            user: login,
            from: formatDay(options.from),
            to: formatDay(options.to),
            total: stats.total,
            activeDays: stats.activeDays,
            emptyDays: stats.emptyDays,
            longestStreak: stats.longestStreak,
            currentStreak: stats.currentStreak,
            days: series.map((count, index) => ({ date: formatDay(options.from + index), count }))
        });
        return ExitCode.Success;
    }

    if (flags.graph !== false) {
        out.block(
            renderGraph(counts, options.from, options.to, { ...out.graphStyle, width: out.width })
        );
    }
    out.note(
        table([
            ["Contributions", formatNumber(stats.total)],
            [
                "Active days",
                `${formatNumber(stats.activeDays)} of ${formatNumber(stats.days)} (${percent(stats.activeDays, stats.days)})`
            ],
            ["Empty days", formatNumber(stats.emptyDays)],
            ["Longest streak", plural(stats.longestStreak, "day")],
            ["Current streak", plural(stats.currentStreak, "day")]
        ]),
        `${login} · ${formatRange(options.from, options.to)}`
    );

    const isViewer = login.toLowerCase() === session.viewer.user.login.toLowerCase();
    if (isViewer && stats.emptyDays > 0) {
        out.info(
            `Fill the ${plural(stats.emptyDays, "empty day")} with:\n${out.c.cyan(`retrocommit --from ${formatDay(options.from)} --to ${formatDay(options.to)} --fill gaps`)}`
        );
    }
    out.outro(`${formatNumber(stats.total)} contributions in ${plural(stats.days, "day")}.`);
    return ExitCode.Success;
}
