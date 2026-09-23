import { Command, Option } from "commander";
import pc from "picocolors";
import { deleteCommand } from "./commands/delete.ts";
import { doctorCommand } from "./commands/doctor.ts";
import { generateCommand } from "./commands/generate.ts";
import { graphCommand } from "./commands/graph.ts";
import { initCommand } from "./commands/init.ts";
import type { Runtime } from "./commands/runtime.ts";
import { suggest } from "./config/load.ts";
import { PRESET_NAMES } from "./config/schema.ts";
import { PROJECT_URL, VERSION } from "./constants.ts";
import { ConfigError } from "./errors.ts";

const COMMANDS = ["preview", "init", "graph", "doctor", "delete", "help"];

const EXAMPLES = `
Examples:
  $ retrocommit                                     start the interactive assistant
  $ retrocommit --from 2024-01-01 --to 2024-12-31 --commits 1-8
  $ retrocommit --year 2023 --days weekdays --frequency 80 --public
  $ retrocommit --from 6m --fill gaps               only the days you have no contributions
  $ retrocommit --preset realistic --dry-run        preview a natural-looking year
  $ retrocommit --text "HELLO" --year 2025          write on your graph
  $ retrocommit --no-push --output ./history        just create the repository locally
  $ retrocommit graph                               show your real graph in the terminal

Docs: ${PROJECT_URL}#readme`;

function addOutputOptions(
    command: Command,
    extra: { yes?: boolean; force?: string } = {}
): Command {
    command.optionsGroup("Output:");
    if (extra.yes) command.option("-y, --yes", "don't ask for confirmation");
    if (extra.force) command.option("--force", extra.force);
    return command
        .option("--json", "print machine-readable JSON")
        .option("-q, --quiet", "print only errors and the final result")
        .option("--verbose", "print debugging details")
        .option("--ascii", "use plain ASCII characters")
        .option("--no-color", "disable colors");
}

function addGitHubOptions(command: Command): Command {
    return command
        .optionsGroup("GitHub:")
        .option(
            "--token <token>",
            "GitHub token (better: set the RETROCOMMIT_TOKEN or GH_TOKEN env var)"
        )
        .option("--host <host>", "GitHub Enterprise Server host (default: github.com)")
        .option("--api-url <url>", "GitHub API URL (GitHub Enterprise Server)");
}

function addRangeOptions(command: Command): Command {
    return command
        .optionsGroup("Date range:")
        .option(
            "-f, --from <date>",
            "first day: YYYY-MM-DD, YYYY-MM, YYYY, today, yesterday or relative (30d, 12w, 6m, 1y) (default: 1y)"
        )
        .option("-t, --to <date>", "last day, same formats (default: today)")
        .option("--year <year>", "a whole calendar year instead of --from/--to")
        .option(
            "--timezone <zone>",
            "IANA time zone (Europe/Madrid), UTC or an offset like +05:30 (default: system)"
        );
}

/** Options of `retrocommit` (run) and `retrocommit preview`. */
export function addGenerationOptions(command: Command): Command {
    addRangeOptions(command)
        .option(
            "--exclude <dates...>",
            "days to skip: 2024-12-25, 2024-08 or 2024-08-01..2024-08-15"
        )
        .option("--allow-future", "allow dates after today")

        .optionsGroup("Schedule:")
        .option(
            "-c, --commits <n|min-max>",
            "commits per active day: fixed (5) or random (1-10) (default: 1-5)"
        )
        .addOption(
            new Option(
                "--distribution <type>",
                "how amounts are drawn from the range (default: uniform)"
            ).choices(["uniform", "normal", "skewed"])
        )
        .option(
            "--frequency <percent>",
            "percentage of days that get commits, 0-100 (default: 100)"
        )
        .option(
            "--days <days>",
            "days of the week: all, weekdays, weekends, mon,wed,fri or mon-fri (default: all)"
        )
        .option("--weights <weights>", "relative chance per day of the week, e.g. sat=0.3,sun=0.2")
        .addOption(
            new Option(
                "--fill <mode>",
                "all days, only gaps (days without contributions) or top-up (default: all)"
            ).choices(["all", "gaps", "top-up"])
        )
        .addOption(new Option("--preset <name>", "start from a preset").choices(PRESET_NAMES))
        .option("--time <from-to>", "local time window for the commits (default: 09:00-21:00)")
        .option("--seed <value>", "reproduce exactly the same plan")
        .option(
            "--max-commits <n>",
            "safety limit for the total number of commits (default: 50000)"
        )

        .optionsGroup("Drawing:")
        .option("--text <text>", "write text on your contribution graph")
        .option("--pattern <file>", "draw a pattern file (up to 7 lines of . # 1-4)")
        .option("--intensity <n>", "commits for the darkest squares of a drawing (default: 12)")

        .optionsGroup("Commits:")
        .option("-m, --message <template>", 'message template, e.g. "Update {date} ({n}/{count})"')
        .option("--messages-file <file>", "pick messages at random from a file (one per line)")
        .option("--author-name <name>", "commit author name (default: your GitHub name)")
        .option(
            "--author-email <email>",
            "commit author email (default: your GitHub no-reply email)"
        )
        .addOption(
            new Option("--content <mode>", "what each commit changes (default: single)").choices([
                "single",
                "daily",
                "empty"
            ])
        )
        .option(
            "--content-path <path>",
            "log file (single) or folder (daily) inside the repository"
        )
        .option("--readme [file]", "add a README.md, optionally your own file (default: on)")
        .option("--no-readme", "don't add a README.md")

        .optionsGroup("Repository:")
        .option("-r, --repo <name>", "repository name (default: activity-log)")
        .option("--owner <org>", "create the repository in an organization")
        .option("--private", "private repository (default)")
        .option("--public", "public repository")
        .option("--description <text>", "repository description")
        .option("--topics <list>", "comma-separated topics (default: retrocommit)")
        .option("--branch <name>", "branch to write (default: main)")
        .addOption(
            new Option(
                "--if-exists <action>",
                "when the repository already has commits (default: fail)"
            ).choices(["fail", "append", "replace"])
        )
        .option("--no-push", "only create the repository locally (see --output)")
        .option("-o, --output <dir>", "keep the generated repository in this directory")
        .option("--remote <url>", "push to an existing git remote instead of creating a repository")
        .addOption(
            new Option("--protocol <protocol>", "how to push to GitHub (default: https)").choices([
                "https",
                "ssh"
            ])
        );

    addGitHubOptions(command);
    command
        .optionsGroup("Configuration:")
        .option("--config <file>", "read options from this JSON/YAML file")
        .option("--no-config", "ignore configuration files")
        .option("-i, --interactive", "answer the questions of the interactive assistant");
    addOutputOptions(command, {
        yes: true,
        force: "allow replacing repositories that weren't created by retrocommit"
    })
        .option("--dry-run", "only show the plan; don't create anything")
        .option("--no-graph", "don't draw the contribution graph");
    return command;
}

/** Builds the command-line interface. Each action reports its exit code through `done`. */
export function createProgram(runtime: Runtime, done: (code: number) => void): Command {
    const program = new Command("retrocommit");
    program
        .description(
            "Fill the gaps in your GitHub contribution graph with backdated commits.\nEverything is configurable; run it without options for an interactive assistant."
        )
        .version(VERSION, "-v, --version", "print the version")
        .helpOption("-h, --help", "show help")
        .usage("[options] [command]")
        .enablePositionalOptions()
        .allowExcessArguments(true)
        .showSuggestionAfterError()
        .showHelpAfterError(pc.dim("(run `retrocommit --help` to see the options)"))
        .configureOutput({ outputError: (text, write) => write(pc.red(text)) })
        .exitOverride()
        .addHelpText("after", EXAMPLES);

    addGenerationOptions(program).action(async (_options, command: Command) => {
        const [unknown] = command.args;
        if (unknown !== undefined) {
            const guess = suggest(unknown, COMMANDS);
            throw new ConfigError(`Unknown command "${unknown}".`, {
                hint: guess
                    ? `Did you mean \`retrocommit ${guess}\`?`
                    : "Run `retrocommit --help` to see the commands."
            });
        }
        done(await generateCommand(command, runtime, "run"));
    });

    program.commandsGroup("Commands:");
    addGenerationOptions(
        program
            .command("preview")
            .alias("plan")
            .description("show the plan and the graph without creating anything")
    ).action(async (_options, command: Command) => {
        done(await generateCommand(command, runtime, "preview"));
    });

    addOutputOptions(
        program
            .command("init")
            .description(
                "create a configuration file (with the assistant or a documented template)"
            )
            .addOption(
                new Option("--format <format>", "file format (default: json)").choices([
                    "json",
                    "yaml"
                ])
            )
            .option("-o, --output <file>", "where to write it (default: retrocommit.config.json)")
            .option("--defaults", "write the documented template without asking questions"),
        { force: "overwrite an existing file" }
    ).action(async (_options, command: Command) => {
        done(await initCommand(command, runtime));
    });

    const graph = program
        .command("graph")
        .description("draw your real GitHub contribution graph in the terminal")
        .optionsGroup("Graph:")
        .option("-u, --user <login>", "whose graph to show (default: you)");
    addRangeOptions(graph);
    addGitHubOptions(graph);
    addOutputOptions(graph)
        .option("--no-graph", "only print the statistics")
        .action(async (_options, command: Command) => {
            done(await graphCommand(command, runtime));
        });

    addOutputOptions(
        addGitHubOptions(
            program.command("doctor").description("check git, your token and its permissions")
        )
    ).action(async (_options, command: Command) => {
        done(await doctorCommand(command, runtime));
    });

    addOutputOptions(
        addGitHubOptions(
            program
                .command("delete")
                .alias("remove")
                .argument("<repo>", "repository to delete: name or owner/name")
                .description("delete a repository created by retrocommit (undo)")
        ),
        { yes: true, force: "delete even if it wasn't created by retrocommit" }
    ).action(async (repo: string, _options, command: Command) => {
        done(await deleteCommand(repo, command, runtime));
    });

    return program;
}
