import { CommanderError } from "commander";
import pc from "picocolors";
import type { Runtime } from "./commands/runtime.ts";
import { ISSUES_URL } from "./constants.ts";
import { CancelledError, ExitCode, errorMessage, RetroError } from "./errors.ts";
import { createProgram } from "./program.ts";
import { supportsUnicode } from "./ui/graph.ts";

const COMMANDER_OK = new Set(["commander.helpDisplayed", "commander.version", "commander.help"]);

function write(stream: NodeJS.WriteStream, text: string): void {
    stream.write(`${text}\n`);
}

/** Prints an error the way the user expects (pretty, or JSON with --json) and returns the exit code. */
export function reportError(error: unknown, args: readonly string[], aborted: boolean): number {
    if (error instanceof CommanderError) {
        return COMMANDER_OK.has(error.code) || error.exitCode === 0
            ? ExitCode.Success
            : ExitCode.Usage;
    }

    let problem = error;
    const isAbort = error instanceof Error && error.name === "AbortError";
    if ((aborted || isAbort) && !(error instanceof RetroError))
        problem = new CancelledError("Interrupted.");

    const json = args.includes("--json");
    const verbose = args.includes("--verbose");
    const c = pc.createColors(pc.isColorSupported && !args.includes("--no-color"));
    const unicode = !args.includes("--ascii") && supportsUnicode(process.env);
    const cross = unicode ? "✖" : "x";
    const arrow = unicode ? "→" : "->";
    const bullet = unicode ? "•" : "-";

    if (problem instanceof RetroError) {
        if (json) {
            write(
                process.stdout,
                JSON.stringify(
                    {
                        ok: false,
                        error: {
                            message: problem.message,
                            hint: problem.hint ?? null,
                            details: problem.details
                        }
                    },
                    null,
                    2
                )
            );
            return problem.exitCode;
        }
        if (problem instanceof CancelledError) {
            write(process.stderr, c.yellow(problem.message));
            return problem.exitCode;
        }
        write(process.stderr, `${c.red(cross)} ${c.bold(problem.message)}`);
        for (const detail of problem.details) write(process.stderr, `  ${c.dim(bullet)} ${detail}`);
        if (problem.hint) write(process.stderr, `${c.cyan(arrow)} ${problem.hint}`);
        if (verbose && problem.cause instanceof Error && problem.cause.stack) {
            write(process.stderr, c.dim(problem.cause.stack));
        }
        return problem.exitCode;
    }

    const message = errorMessage(error);
    if (json) {
        write(
            process.stdout,
            JSON.stringify({ ok: false, error: { message, hint: null, details: [] } }, null, 2)
        );
        return ExitCode.Failure;
    }
    write(process.stderr, `${c.red(cross)} ${c.bold(`Unexpected error: ${message}`)}`);
    write(
        process.stderr,
        `${c.cyan(arrow)} This looks like a bug. Please report it at ${ISSUES_URL}`
    );
    if (verbose && error instanceof Error && error.stack) write(process.stderr, c.dim(error.stack));
    else write(process.stderr, c.dim("  (run again with --verbose to see the details)"));
    return ExitCode.Failure;
}

/** Runs the CLI with `argv` (as in `process.argv`) and resolves to the exit code. */
export async function main(argv: readonly string[]): Promise<number> {
    const args = argv.slice(2);
    const controller = new AbortController();
    let interruptions = 0;
    const onSignal = () => {
        interruptions++;
        if (interruptions > 1) process.exit(ExitCode.Cancelled);
        controller.abort(new CancelledError("Interrupted."));
        process.stderr.write(`\n${pc.yellow("Stopping… (press Ctrl+C again to force it)")}\n`);
    };
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);

    const runtime: Runtime = {
        argv: args,
        cwd: process.cwd(),
        now: new Date(),
        signal: controller.signal
    };
    let exitCode: number = ExitCode.Success;
    try {
        await createProgram(runtime, (code) => {
            exitCode = code;
        }).parseAsync([...argv]);
        return exitCode;
    } catch (error) {
        return reportError(error, args, controller.signal.aborted);
    } finally {
        process.off("SIGINT", onSignal);
        process.off("SIGTERM", onSignal);
    }
}
