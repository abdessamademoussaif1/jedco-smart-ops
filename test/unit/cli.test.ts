import { PassThrough } from "node:stream";
import { Command, CommanderError } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";
import { flagsToConfig } from "../../src/cli/flags.ts";
import { remoteHost } from "../../src/commands/generate.ts";
import { CancelledError, ConfigError, RetroError } from "../../src/errors.ts";
import { reportError } from "../../src/main.ts";
import { addGenerationOptions } from "../../src/program.ts";
import { Output } from "../../src/ui/output.ts";
import { answersToConfig } from "../../src/wizard.ts";

function parse(args: string[]) {
    const command = addGenerationOptions(new Command("test")).exitOverride();
    command.parse(args, { from: "user" });
    return flagsToConfig(command);
}

describe("flagsToConfig", () => {
    it("keeps only what the user typed", () => {
        expect(parse([]).values).toEqual({});
        expect(parse(["--from", "2024-01-01", "-c", "1-3", "--days", "weekdays"]).values).toEqual({
            from: "2024-01-01",
            commits: "1-3",
            days: "weekdays"
        });
    });

    it("coerces numbers and booleans", () => {
        expect(
            parse([
                "--frequency",
                "80%",
                "--max-commits",
                "1,000",
                "--intensity",
                "20",
                "--year",
                "2023"
            ]).values
        ).toEqual({
            frequency: 80,
            maxCommits: 1000,
            intensity: 20,
            year: 2023
        });
        expect(parse(["--no-push", "--no-readme", "--allow-future"]).values).toEqual({
            push: false,
            readme: false,
            allowFuture: true
        });
        expect(parse(["--readme", "docs/README.md"]).values).toEqual({ readme: "docs/README.md" });
        expect(parse(["--public"]).values).toEqual({ visibility: "public" });
        expect(parse(["--exclude", "2024-01-01", "2024-02-01..2024-02-03"]).values).toEqual({
            exclude: ["2024-01-01", "2024-02-01..2024-02-03"]
        });
    });

    it("collects conversion problems instead of throwing", () => {
        const { issues } = parse(["--frequency", "abc", "--year", "20x", "--public", "--private"]);
        expect(issues).toHaveLength(3);
        expect(issues.join("\n")).toMatch(/--frequency/);
        expect(issues.join("\n")).toMatch(/--year/);
        expect(issues.join("\n")).toMatch(/--public and --private/);
    });
});

describe("answersToConfig", () => {
    it("maps a schedule to a new GitHub repository", () => {
        expect(
            answersToConfig(
                {
                    period: "last-year",
                    mode: "schedule",
                    commits: "1-5",
                    days: "weekdays",
                    frequency: 85,
                    fill: "gaps",
                    destination: "github",
                    repo: "log",
                    visibility: "public"
                },
                2026
            )
        ).toEqual({
            from: "1y",
            to: "today",
            commits: "1-5",
            days: "weekdays",
            frequency: 85,
            fill: "gaps",
            push: true,
            repo: "log",
            visibility: "public"
        });
    });

    it("maps drawings, years and other destinations", () => {
        expect(
            answersToConfig(
                {
                    period: "this-year",
                    mode: "text",
                    text: "HI",
                    fill: "all",
                    destination: "local",
                    output: "./x"
                },
                2026
            )
        ).toEqual({ year: 2026, text: "HI", fill: "all", push: false, output: "./x" });
        expect(
            answersToConfig(
                {
                    period: "custom",
                    from: "2024-01-01",
                    to: "2024-06-30",
                    mode: "pattern",
                    pattern: "art.txt",
                    fill: "top-up",
                    destination: "remote",
                    remote: "git@github.com:a/b.git"
                },
                2026
            )
        ).toEqual({
            from: "2024-01-01",
            to: "2024-06-30",
            pattern: "art.txt",
            fill: "top-up",
            push: true,
            remote: "git@github.com:a/b.git"
        });
        expect(
            answersToConfig(
                {
                    period: "year",
                    year: 2020,
                    mode: "schedule",
                    fill: "all",
                    destination: "github"
                },
                2026
            ).year
        ).toBe(2020);
    });
});

describe("reportError", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllEnvs();
    });

    function capture() {
        vi.stubEnv("WT_SESSION", "1");
        vi.stubEnv("TERM", "xterm-256color");
        const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
        const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
        const text = (spy: typeof stdout) => spy.mock.calls.map((call) => String(call[0])).join("");
        return { stdout: () => text(stdout), stderr: () => text(stderr) };
    }

    it("prints expected errors with details and hints", () => {
        const io = capture();
        const code = reportError(
            new ConfigError("Found 2 problems:", { details: ["a", "b"], hint: "fix it" }),
            ["--no-color"],
            false
        );
        expect(code).toBe(2);
        expect(io.stderr()).toContain("✖ Found 2 problems:");
        expect(io.stderr()).toContain("  • a");
        expect(io.stderr()).toContain("→ fix it");
    });

    it("prints JSON errors with --json", () => {
        const io = capture();
        const code = reportError(new RetroError("boom", { hint: "h" }), ["--json"], false);
        expect(code).toBe(1);
        expect(JSON.parse(io.stdout())).toEqual({
            ok: false,
            error: { message: "boom", hint: "h", details: [] }
        });
    });

    it("treats interruptions as cancellations", () => {
        const io = capture();
        expect(reportError(new CancelledError("Nothing was created."), [], false)).toBe(130);
        expect(reportError(new Error("socket hang up"), [], true)).toBe(130);
        const abort = new Error("aborted");
        abort.name = "AbortError";
        expect(reportError(abort, [], false)).toBe(130);
        expect(io.stderr()).toContain("Interrupted.");
    });

    it("asks users to report unexpected errors", () => {
        const io = capture();
        expect(reportError(new TypeError("x is undefined"), ["--no-color"], false)).toBe(1);
        expect(io.stderr()).toContain("Unexpected error: x is undefined");
        expect(io.stderr()).toContain("issues/new");
    });

    it("maps commander results to exit codes", () => {
        expect(reportError(new CommanderError(0, "commander.helpDisplayed", ""), [], false)).toBe(
            0
        );
        expect(reportError(new CommanderError(1, "commander.unknownOption", ""), [], false)).toBe(
            2
        );
    });
});

// Windows consoles without Windows Terminal fall back to ASCII; pretend we have it.
const UNICODE_ENV = { WT_SESSION: "1" };

describe("Output", () => {
    function streams(isTTY = false) {
        const stdout = Object.assign(new PassThrough(), {
            isTTY,
            columns: 80
        }) as unknown as NodeJS.WriteStream;
        const stderr = Object.assign(new PassThrough(), { isTTY }) as unknown as NodeJS.WriteStream;
        const stdin = Object.assign(new PassThrough(), { isTTY }) as unknown as NodeJS.ReadStream;
        const read = (stream: NodeJS.WriteStream) =>
            ((stream as unknown as PassThrough).read() ?? "").toString();
        return { stdout, stderr, stdin, read };
    }

    it("prints plain lines when not attached to a terminal", () => {
        const io = streams();
        const out = new Output({ ...io, env: UNICODE_ENV });
        expect(out.mode).toBe("plain");
        expect(out.canPrompt).toBe(false);
        out.success("done");
        out.note("a  1\nb  2", "Plan");
        const spinner = out.spinner();
        spinner.start("Working");
        spinner.stop("Worked");
        out.warn("careful");
        expect(io.read(io.stdout)).toBe("✔ done\nPlan\n  a  1\n  b  2\n◇ Working…\n✔ Worked\n");
        expect(io.read(io.stderr)).toBe("⚠ careful\n");
    });

    it("only prints JSON and warnings in JSON mode", () => {
        const io = streams();
        const out = new Output({ ...io, env: UNICODE_ENV, json: true });
        out.success("hidden");
        out.note("hidden", "hidden");
        out.block("hidden");
        out.spinner().start("hidden");
        out.json({ ok: true });
        out.warn("shown");
        expect(io.read(io.stdout)).toBe('{\n  "ok": true\n}\n');
        expect(io.read(io.stderr)).toBe("⚠ shown\n");
    });

    it("prints only the essentials in quiet mode", () => {
        const io = streams();
        const out = new Output({ ...io, env: UNICODE_ENV, quiet: true, ascii: true });
        out.info("hidden");
        out.success("hidden");
        out.outro("Done!");
        out.error("bad");
        expect(io.read(io.stdout)).toBe("Done!\n");
        expect(io.read(io.stderr)).toBe("[x] bad\n");
    });

    it("prints debugging details only with --verbose", () => {
        const io = streams();
        new Output({ ...io, env: UNICODE_ENV }).verbose("secret");
        new Output({ ...io, env: UNICODE_ENV, verbose: true }).verbose("visible");
        expect(io.read(io.stderr)).toBe("[debug] visible\n");
    });
});

describe("remoteHost", () => {
    it("extracts the host name of remote URLs", () => {
        expect(remoteHost("git@github.com:you/repo.git")).toBe("github.com");
        expect(remoteHost("https://GitHub.com/you/repo.git")).toBe("github.com");
        expect(remoteHost("ssh://git@github.com:22/you/repo.git")).toBe("github.com");
        expect(remoteHost("https://gitlab.com/you/repo.git")).toBe("gitlab.com");
        expect(remoteHost("file:///tmp/repo.git")).toBeUndefined();
        expect(remoteHost("/tmp/repo.git")).toBeUndefined();
    });
});
