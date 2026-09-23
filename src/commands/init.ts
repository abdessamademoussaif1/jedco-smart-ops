import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type { Command } from "commander";
import YAML from "yaml";
import type { CommonFlags } from "../cli/flags.ts";
import type { RawConfig } from "../config/schema.ts";
import { PROJECT_URL, SCHEMA_URL } from "../constants.ts";
import { localDayOf, resolveZone } from "../core/timezone.ts";
import { ExitCode, RetroError } from "../errors.ts";
import { runWizard } from "../wizard.ts";
import { banner, createOutput, type Runtime } from "./runtime.ts";

interface InitFlags extends CommonFlags {
    format?: "json" | "yaml";
    output?: string;
    defaults?: boolean;
}

/** A documented starting point with every option (optional ones commented out). */
export const STARTER_YAML = `# yaml-language-server: $schema=${SCHEMA_URL}
# retrocommit configuration · ${PROJECT_URL}#configuration
# Run \`retrocommit preview\` to see the result and \`retrocommit\` to create it.

# ── Period ──────────────────────────────────────────────────────────────────
from: 1y                  # YYYY-MM-DD, YYYY-MM, YYYY, today, yesterday, 30d, 12w, 6m, 1y
to: today
# year: 2024              # a whole calendar year instead of from/to
# exclude:                # days to skip
#   - 2024-12-25
#   - 2024-08-01..2024-08-15

# ── Schedule ────────────────────────────────────────────────────────────────
commits: 1-5              # per active day: a number (3) or a random range (1-8)
frequency: 80             # % of the selected days that get commits
days: all                 # all, weekdays, weekends, mon,wed,fri or mon-fri
distribution: uniform     # uniform, normal or skewed (mostly low, looks natural)
# weights:                # relative chance per day of the week
#   sat: 0.3
#   sun: 0.2
# preset: realistic       # casual, realistic, workweek or intense
fill: all                 # all, gaps (only empty days) or top-up
time: 09:00-21:00         # local time window for the commits
# timezone: Europe/Madrid # default: your system's time zone
# seed: 42                # same seed = same plan

# ── Drawing (instead of a schedule) ────────────────────────────────────────
# text: HELLO
# pattern: ./pattern.txt
# intensity: 12

# ── Commits ─────────────────────────────────────────────────────────────────
message: "Update activity log ({date} #{n})"
# messagesFile: ./messages.txt
# authorName: Your Name   # default: your GitHub name
# authorEmail: you@example.com  # default: your GitHub no-reply email (recommended)
content: single           # single, daily or empty
readme: true

# ── Repository ──────────────────────────────────────────────────────────────
repo: activity-log
visibility: private       # private or public
# owner: my-organization
# description: Activity log
# topics: [retrocommit]
branch: main
ifExists: fail            # fail, append or replace
# push: false             # only create the repository locally
# output: ./activity-log  # keep a local copy
# remote: git@github.com:you/activity-log.git
# protocol: https         # https (token) or ssh (your SSH keys)
`;

function toJson(config: RawConfig): string {
    return `${JSON.stringify({ $schema: SCHEMA_URL, ...config }, null, 4)}\n`;
}

function toYaml(config: RawConfig): string {
    return `# yaml-language-server: $schema=${SCHEMA_URL}\n# retrocommit configuration · ${PROJECT_URL}#configuration\n${YAML.stringify(config)}`;
}

const STARTER_JSON: RawConfig = {
    from: "1y",
    to: "today",
    commits: "1-5",
    frequency: 80,
    days: "all",
    distribution: "uniform",
    fill: "all",
    time: "09:00-21:00",
    message: "Update activity log ({date} #{n})",
    repo: "activity-log",
    visibility: "private"
};

/** `retrocommit init`: writes a configuration file (with the assistant, or a template). */
export async function initCommand(command: Command, runtime: Runtime): Promise<number> {
    const flags = command.opts<InitFlags>();
    const out = createOutput(flags);
    const format =
        flags.format ?? (flags.output && /\.ya?ml$/i.test(flags.output) ? "yaml" : "json");
    const path = resolve(runtime.cwd, flags.output ?? `retrocommit.config.${format}`);

    if (existsSync(path) && !flags.force) {
        throw new RetroError(`${basename(path)} already exists.`, {
            exitCode: ExitCode.Usage,
            hint: "Use --force to overwrite it, or --output to write another file."
        });
    }

    out.intro(banner(out));
    let contents: string;
    if (out.canPrompt && !flags.defaults) {
        const today = localDayOf(runtime.now.getTime(), resolveZone());
        const config = await runWizard({ initial: {}, today, out });
        contents = format === "yaml" ? toYaml(config) : toJson(config);
    } else {
        contents = format === "yaml" ? STARTER_YAML : toJson(STARTER_JSON);
    }
    await writeFile(path, contents);

    if (out.mode === "json") {
        out.json({ ok: true, path });
        return ExitCode.Success;
    }
    if (out.mode === "quiet") {
        out.outro(`Created ${path}`);
        return ExitCode.Success;
    }
    out.success(`Created ${out.c.bold(basename(path))}`);
    out.note(
        [
            `Preview it   ${out.c.cyan("retrocommit preview")}`,
            `Create it    ${out.c.cyan("retrocommit")}`,
            "",
            "Your editor can autocomplete and validate every option thanks to the schema."
        ].join("\n"),
        "Next steps"
    );
    out.outro("Happy committing!");
    return ExitCode.Success;
}
