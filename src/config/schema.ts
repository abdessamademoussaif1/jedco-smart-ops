import { z } from "zod";

export const PRESET_NAMES = ["casual", "realistic", "workweek", "intense"] as const;
export type PresetName = (typeof PRESET_NAMES)[number];

const dateValue = z
    .union([z.string(), z.number().int()], {
        error: "must be a date such as 2024-01-31, 2024-01, 2024, today, yesterday, 30d, 6m or 1y"
    })
    .optional();

const stringList = (description: string) =>
    z
        .union([z.string(), z.array(z.string())], {
            error: "must be a string or a list of strings"
        })
        .optional()
        .describe(description);

/**
 * Every option retrocommit understands. The same keys are used by the CLI flags
 * (in kebab-case) and by configuration files (in camelCase). This schema is also
 * exported as JSON Schema for editor autocompletion.
 */
export const RawConfigSchema = z
    .strictObject({
        $schema: z
            .string()
            .optional()
            .describe("JSON Schema of this file (enables autocompletion)."),
        preset: z
            .enum(PRESET_NAMES)
            .optional()
            .describe("Start from a preset: casual, realistic, workweek or intense."),

        from: dateValue.describe(
            "First day to fill: YYYY-MM-DD, YYYY-MM, YYYY, today, yesterday or relative (30d, 12w, 6m, 1y). Default: 1y."
        ),
        to: dateValue.describe("Last day to fill (same formats as `from`). Default: today."),
        year: z
            .number({ error: "must be a year such as 2024" })
            .int()
            .optional()
            .describe("Fill a whole calendar year (shortcut for from/to)."),
        exclude: stringList(
            "Days to skip: 2024-12-25, whole months (2024-08) or ranges (2024-08-01..2024-08-15)."
        ),
        allowFuture: z.boolean().optional().describe("Allow dates after today. Default: false."),

        commits: z
            .union(
                [
                    z.number().int(),
                    z.string(),
                    z.strictObject({ min: z.number().int(), max: z.number().int() })
                ],
                { error: 'must be a number (5), a range ("1-10") or { min, max }' }
            )
            .optional()
            .describe(
                'Commits per active day: a number (5) or a random range ("1-10"). Default: 1-5.'
            ),
        distribution: z
            .enum(["uniform", "normal", "skewed"])
            .optional()
            .describe(
                "How amounts are drawn from the range: uniform, normal (bell curve) or skewed (mostly low, natural looking). Default: uniform."
            ),
        frequency: z
            .number({ error: "must be a number between 0 and 100" })
            .min(0)
            .max(100)
            .optional()
            .describe("Percentage of eligible days that get commits (0-100). Default: 100."),
        days: stringList(
            "Days of the week: all, weekdays, weekends, a list (mon,wed,fri) or a range (mon-fri). Default: all."
        ),
        weights: z
            .union([z.string(), z.record(z.string(), z.number().min(0))], {
                error: 'must be like "sat=0.3,sun=0.2" or { "sat": 0.3 }'
            })
            .optional()
            .describe('Relative chance per day of the week, e.g. { "sat": 0.3, "sun": 0.2 }.'),
        fill: z
            .enum(["all", "gaps", "top-up"])
            .optional()
            .describe(
                "all: fill every selected day · gaps: only days without contributions · top-up: add only what's missing to reach the target. Default: all."
            ),
        maxCommits: z
            .number({ error: "must be a whole number" })
            .int()
            .positive()
            .optional()
            .describe("Safety limit for the total number of commits. Default: 50000."),
        seed: z
            .union([z.string(), z.number()])
            .optional()
            .describe("Seed for the random choices; the same seed reproduces the same plan."),

        time: z
            .string()
            .optional()
            .describe("Local time window for commits, HH:MM-HH:MM. Default: 09:00-21:00."),
        timezone: z
            .string()
            .optional()
            .describe(
                "IANA time zone (Europe/Madrid), UTC or an offset (+05:30). Default: the system's."
            ),

        text: z.string().optional().describe("Write this text on the contribution graph."),
        pattern: z
            .string()
            .optional()
            .describe("Path to a pattern file to draw on the graph (up to 7 lines)."),
        intensity: z
            .number({ error: "must be a whole number" })
            .int()
            .min(1)
            .max(1000)
            .optional()
            .describe("Commits for the darkest squares of a drawing. Default: 12."),

        message: z
            .string()
            .optional()
            .describe(
                "Commit message template. Placeholders: {date} {time} {datetime} {n} {count} {i} {total} {weekday} {year} {month} {day}."
            ),
        messagesFile: z
            .string()
            .optional()
            .describe("Text file with one message (template) per line, picked at random."),
        authorName: z
            .string()
            .optional()
            .describe("Commit author name. Default: your GitHub name."),
        authorEmail: z
            .string()
            .optional()
            .describe(
                "Commit author email. Default: your GitHub no-reply address (always counts)."
            ),
        content: z
            .enum(["single", "daily", "empty"])
            .optional()
            .describe(
                "What each commit changes: single (one log file), daily (one file per day) or empty. Default: single."
            ),
        contentPath: z
            .string()
            .optional()
            .describe("Log file (single) or folder (daily). Default: activity.log / activity."),
        readme: z
            .union([z.boolean(), z.string()], { error: "must be true, false or a file path" })
            .optional()
            .describe(
                "Add a README.md in the first commit: true, false or a path to your own. Default: true."
            ),

        repo: z.string().optional().describe("Repository name. Default: activity-log."),
        owner: z
            .string()
            .optional()
            .describe("Create the repository in this organization instead of your account."),
        visibility: z
            .enum(["private", "public"])
            .optional()
            .describe("Repository visibility. Default: private."),
        description: z.string().optional().describe("Repository description."),
        topics: stringList("Repository topics. Default: retrocommit."),
        branch: z
            .string()
            .optional()
            .describe("Branch to write (must be the default branch to count). Default: main."),
        ifExists: z
            .enum(["fail", "append", "replace"])
            .optional()
            .describe(
                "When the repository already has commits: fail, append (add on top) or replace (overwrite). Default: fail."
            ),
        push: z
            .boolean()
            .optional()
            .describe("Push to GitHub. false = only create the local repository."),
        output: z.string().optional().describe("Keep the generated repository in this directory."),
        remote: z
            .string()
            .optional()
            .describe(
                "Push to this existing git remote URL instead of creating a GitHub repository."
            ),
        protocol: z
            .enum(["https", "ssh"])
            .optional()
            .describe(
                "How to push to GitHub: https (token) or ssh (your SSH keys). Default: https."
            ),
        host: z
            .string()
            .optional()
            .describe("GitHub host (for GitHub Enterprise Server). Default: github.com."),
        apiUrl: z.string().optional().describe("GitHub API URL (for GitHub Enterprise Server).")
    })
    .describe("retrocommit configuration");

export type RawConfig = z.infer<typeof RawConfigSchema>;
export type ConfigKey = keyof RawConfig;

export const CONFIG_KEYS = Object.keys(RawConfigSchema.shape) as ConfigKey[];

export const DEFAULTS: RawConfig = {
    from: "1y",
    to: "today",
    commits: "1-5",
    distribution: "uniform",
    frequency: 100,
    days: "all",
    fill: "all",
    maxCommits: 50_000,
    time: "09:00-21:00",
    intensity: 12,
    message: "Update activity log ({date} #{n})",
    content: "single",
    readme: true,
    repo: "activity-log",
    visibility: "private",
    description: "Activity log generated with retrocommit",
    topics: ["retrocommit"],
    branch: "main",
    ifExists: "fail",
    push: true,
    protocol: "https",
    host: "github.com",
    allowFuture: false
};

export const PRESETS: Readonly<Record<PresetName, RawConfig>> = {
    casual: {
        commits: "1-3",
        frequency: 45,
        weights: { sat: 0.5, sun: 0.5 },
        distribution: "skewed"
    },
    realistic: {
        commits: "1-8",
        frequency: 70,
        weights: { sat: 0.35, sun: 0.25 },
        distribution: "skewed"
    },
    workweek: {
        days: "weekdays",
        commits: "2-8",
        frequency: 90,
        distribution: "normal"
    },
    intense: {
        commits: "5-20",
        frequency: 100,
        distribution: "normal"
    }
};

/** Options that read a file, resolved relative to the config file that sets them. */
export const PATH_KEYS = ["messagesFile", "pattern", "output"] as const;
