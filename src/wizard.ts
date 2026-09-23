import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as clack from "@clack/prompts";
import type { RawConfig } from "./config/schema.ts";
import { validateRemoteUrl, validateRepoName } from "./config/validate.ts";
import { SCHEMA_URL } from "./constants.ts";
import { textToGrid } from "./core/art.ts";
import { type Day, parseDateInput, WEEKDAY_KEYS, WEEKDAY_NAMES, ymdFromDay } from "./core/dates.ts";
import { parseCountRange, parsePercentage } from "./core/parse.ts";
import type { FillMode } from "./core/planner.ts";
import { CancelledError, errorMessage } from "./errors.ts";
import type { Output } from "./ui/output.ts";

export type Period = "last-year" | "this-year" | "year" | "custom";
export type DrawMode = "schedule" | "text" | "pattern";
export type Destination = "github" | "remote" | "local";

export interface WizardAnswers {
    period: Period;
    year?: number | undefined;
    from?: string | undefined;
    to?: string | undefined;
    mode: DrawMode;
    text?: string | undefined;
    pattern?: string | undefined;
    commits?: string | undefined;
    days?: string | undefined;
    frequency?: number | undefined;
    fill: FillMode;
    destination: Destination;
    repo?: string | undefined;
    visibility?: "private" | "public" | undefined;
    remote?: string | undefined;
    output?: string | undefined;
}

/** Turns the assistant's answers into a configuration layer (pure, easy to test). */
export function answersToConfig(answers: WizardAnswers, currentYear: number): RawConfig {
    const config: RawConfig = {};
    switch (answers.period) {
        case "last-year":
            config.from = "1y";
            config.to = "today";
            break;
        case "this-year":
            config.year = currentYear;
            break;
        case "year":
            config.year = answers.year;
            break;
        case "custom":
            config.from = answers.from;
            config.to = answers.to;
            break;
    }

    if (answers.mode === "text") config.text = answers.text;
    else if (answers.mode === "pattern") config.pattern = answers.pattern;
    else {
        config.commits = answers.commits;
        config.days = answers.days;
        config.frequency = answers.frequency;
    }

    config.fill = answers.fill;
    switch (answers.destination) {
        case "github":
            config.push = true;
            config.repo = answers.repo;
            config.visibility = answers.visibility;
            break;
        case "remote":
            config.push = true;
            config.remote = answers.remote;
            break;
        case "local":
            config.push = false;
            config.output = answers.output;
            break;
    }

    return Object.fromEntries(
        Object.entries(config).filter(([, value]) => value !== undefined)
    ) as RawConfig;
}

/** Unwraps a prompt answer, turning Ctrl+C / Esc into a CancelledError. */
function ensure<T>(value: T): Exclude<T, symbol> {
    if (clack.isCancel(value)) throw new CancelledError();
    return value as Exclude<T, symbol>;
}

/** Adapts a throwing parser to clack's `validate` callback. */
function validator(
    parse: (value: string) => unknown
): (value: string | undefined) => string | undefined {
    return (value) => {
        try {
            parse(value ?? "");
            return undefined;
        } catch (error) {
            return errorMessage(error);
        }
    };
}

export interface WizardOptions {
    /** Current values (config file + flags), used as the initial answers. */
    initial: RawConfig;
    today: Day;
    out: Output;
}

/** The interactive assistant: asks a few questions and returns a configuration layer. */
export async function runWizard({ initial, today, out }: WizardOptions): Promise<RawConfig> {
    const io = { output: out.stdout, input: out.stdin };
    const currentYear = ymdFromDay(today).year;
    const answers: WizardAnswers = {
        period: "last-year",
        mode: "schedule",
        fill: "all",
        destination: "github"
    };

    answers.period = ensure(
        await clack.select<Period>({
            ...io,
            message: "Which period do you want to fill?",
            options: [
                {
                    value: "last-year",
                    label: "The last 12 months",
                    hint: "what your profile shows"
                },
                { value: "this-year", label: `This year (${currentYear})` },
                { value: "year", label: "A specific year" },
                { value: "custom", label: "A custom date range" }
            ]
        })
    );

    if (answers.period === "year") {
        const value = ensure(
            await clack.text({
                ...io,
                message: "Which year?",
                placeholder: String(currentYear - 1),
                initialValue: String(currentYear - 1),
                validate: validator((input) => {
                    const year = Number(input);
                    if (!/^\d{4}$/.test(input.trim()) || year < 2008 || year > currentYear) {
                        throw new Error(`Enter a year between 2008 and ${currentYear}`);
                    }
                })
            })
        );
        answers.year = Number(value);
    } else if (answers.period === "custom") {
        answers.from = ensure(
            await clack.text({
                ...io,
                message: "From which day? (YYYY-MM-DD, YYYY-MM or relative like 6m)",
                placeholder: "2024-01-01",
                validate: validator((input) => parseDateInput(input, "start", today))
            })
        );
        const start = parseDateInput(answers.from, "start", today);
        answers.to = ensure(
            await clack.text({
                ...io,
                message: "Until which day?",
                initialValue: "today",
                validate: validator((input) => {
                    const end = parseDateInput(input, "end", today);
                    if (end < start) throw new Error("The end must be after the start");
                    if (end > today) throw new Error("The end can't be in the future");
                })
            })
        );
    }

    answers.mode = ensure(
        await clack.select<DrawMode>({
            ...io,
            message: "What do you want to create?",
            options: [
                {
                    value: "schedule",
                    label: "Commits on a schedule",
                    hint: "random or fixed amounts per day"
                },
                { value: "text", label: "Write text on my graph", hint: "e.g. your name" },
                { value: "pattern", label: "Draw a pattern from a file" }
            ]
        })
    );

    if (answers.mode === "text") {
        answers.text = ensure(
            await clack.text({
                ...io,
                message: "Text to write (short texts fit best: about 8 characters per year)",
                placeholder: "HELLO",
                initialValue: initial.text ?? "",
                validate: validator((input) => textToGrid(input))
            })
        );
    } else if (answers.mode === "pattern") {
        answers.pattern = ensure(
            await clack.text({
                ...io,
                message: "Path to the pattern file",
                placeholder: "./pattern.txt",
                validate: validator((input) => {
                    if (!existsSync(input.trim())) throw new Error("File not found");
                })
            })
        );
    } else {
        const amount = ensure(
            await clack.select<"range" | "fixed">({
                ...io,
                message: "How many commits per day?",
                options: [
                    {
                        value: "range",
                        label: "A random amount in a range",
                        hint: "looks more natural"
                    },
                    { value: "fixed", label: "Always the same amount" }
                ]
            })
        );
        answers.commits =
            amount === "range"
                ? ensure(
                      await clack.text({
                          ...io,
                          message: "Range of commits per day (min-max)",
                          initialValue: "1-5",
                          validate: validator((input) => {
                              const range = parseCountRange(input);
                              if (range.min === range.max)
                                  throw new Error("Use two different numbers, e.g. 1-5");
                          })
                      })
                  )
                : ensure(
                      await clack.text({
                          ...io,
                          message: "Commits per day",
                          initialValue: "3",
                          validate: validator((input) => {
                              if (!/^\s*\d+\s*$/.test(input))
                                  throw new Error("Enter a single number");
                              parseCountRange(input);
                          })
                      })
                  ).trim();

        const days = ensure(
            await clack.select<string>({
                ...io,
                message: "On which days?",
                options: [
                    { value: "all", label: "Every day" },
                    { value: "weekdays", label: "Weekdays (Monday to Friday)" },
                    { value: "weekends", label: "Weekends" },
                    { value: "custom", label: "Let me choose" }
                ]
            })
        );
        answers.days =
            days === "custom"
                ? ensure(
                      await clack.multiselect<string>({
                          ...io,
                          message: "Pick the days (space to select, enter to confirm)",
                          options: WEEKDAY_KEYS.map((key, index) => ({
                              value: key,
                              label: WEEKDAY_NAMES[index] ?? key
                          })),
                          required: true
                      })
                  ).join(",")
                : days;

        const frequency = ensure(
            await clack.select<number>({
                ...io,
                message: "How often should a day get commits?",
                options: [
                    { value: 100, label: "Every selected day (100%)" },
                    { value: 85, label: "Almost every day (85%)" },
                    { value: 65, label: "Most days (65%)" },
                    { value: 40, label: "Some days (40%)" },
                    { value: -1, label: "Another percentage" }
                ]
            })
        );
        answers.frequency =
            frequency >= 0
                ? frequency
                : parsePercentage(
                      ensure(
                          await clack.text({
                              ...io,
                              message: "Percentage of days with commits (0-100)",
                              placeholder: "75",
                              validate: validator(parsePercentage)
                          })
                      )
                  );
    }

    answers.fill = ensure(
        await clack.select<FillMode>({
            ...io,
            message: "What about days that already have contributions?",
            options: [
                { value: "all", label: "Ignore them", hint: "fill every selected day" },
                {
                    value: "gaps",
                    label: "Skip them: fill only empty days",
                    hint: "reads your GitHub graph"
                },
                {
                    value: "top-up",
                    label: "Top them up to the target",
                    hint: "reads your GitHub graph"
                }
            ]
        })
    );

    answers.destination = ensure(
        await clack.select<Destination>({
            ...io,
            message: "Where should the commits go?",
            options: [
                { value: "github", label: "A new repository on my GitHub", hint: "recommended" },
                { value: "remote", label: "An existing repository (git URL)" },
                { value: "local", label: "Only a local folder", hint: "I'll push it myself" }
            ]
        })
    );

    if (answers.destination === "github") {
        answers.repo = ensure(
            await clack.text({
                ...io,
                message: "Repository name",
                initialValue: initial.repo ?? "activity-log",
                validate: validator(validateRepoName)
            })
        ).trim();
        answers.visibility = ensure(
            await clack.select<"private" | "public">({
                ...io,
                message: "Visibility",
                initialValue: initial.visibility ?? "private",
                options: [
                    {
                        value: "private",
                        label: "Private",
                        hint: "needs “Include private contributions” enabled on your profile"
                    },
                    { value: "public", label: "Public", hint: "anyone can see the repository" }
                ]
            })
        );
    } else if (answers.destination === "remote") {
        answers.remote = ensure(
            await clack.text({
                ...io,
                message: "Git URL of the repository",
                placeholder: "git@github.com:you/activity-log.git",
                validate: validator(validateRemoteUrl)
            })
        ).trim();
    } else {
        answers.output = ensure(
            await clack.text({
                ...io,
                message: "Folder for the new repository",
                initialValue: `./${initial.repo ?? "activity-log"}`,
                validate: validator((input) => {
                    if (input.trim() === "") throw new Error("Enter a folder");
                })
            })
        ).trim();
    }

    return answersToConfig(answers, currentYear);
}

/** After a successful interactive run, offer to keep the answers in a config file. */
export async function offerToSaveConfig(
    out: Output,
    config: RawConfig,
    cwd: string
): Promise<void> {
    const path = join(cwd, "retrocommit.config.json");
    if (!out.canPrompt || existsSync(path)) return;
    const save = await clack.confirm({
        output: out.stdout,
        message: "Save these answers to retrocommit.config.json to reuse them later?",
        initialValue: false
    });
    if (clack.isCancel(save) || !save) return;
    await writeFile(path, `${JSON.stringify({ $schema: SCHEMA_URL, ...config }, null, 4)}\n`);
    out.success(
        "Saved retrocommit.config.json. Next time, run `retrocommit` in this folder to reuse it."
    );
}
