import * as clack from "@clack/prompts";
import pc from "picocolors";
import { onExitCleanup } from "../cleanup.ts";
import { type ColorDepth, detectColorDepth, type GraphStyle, supportsUnicode } from "./graph.ts";

export type OutputMode = "pretty" | "plain" | "json" | "quiet";
export type Colors = ReturnType<typeof pc.createColors>;

export interface OutputOptions {
    json?: boolean | undefined;
    quiet?: boolean | undefined;
    verbose?: boolean | undefined;
    noColor?: boolean | undefined;
    ascii?: boolean | undefined;
    stdout?: NodeJS.WriteStream;
    stderr?: NodeJS.WriteStream;
    stdin?: NodeJS.ReadStream;
    env?: NodeJS.ProcessEnv;
}

export interface Spinner {
    start(message: string): void;
    message(message: string): void;
    stop(message: string): void;
    fail(message: string): void;
}

const noopSpinner: Spinner = { start() {}, message() {}, stop() {}, fail() {} };

const HIDE_CURSOR = "\u001b[?25l";
const SHOW_CURSOR = "\u001b[?25h";
const CLEAR_LINE = "\r\u001b[2K";

/**
 * A spinner in clack's visual style that doesn't grab the keyboard, so Ctrl+C keeps
 * working normally and cleanup code always runs.
 */
class TerminalSpinner implements Spinner {
    private readonly stream: NodeJS.WriteStream;
    private readonly c: Colors;
    private readonly frames: string[];
    private readonly bar: string;
    private timer: NodeJS.Timeout | undefined;
    private index = 0;
    private text = "";
    private removeExitHook: (() => void) | undefined;

    constructor(stream: NodeJS.WriteStream, c: Colors, unicode: boolean) {
        this.stream = stream;
        this.c = c;
        this.frames = unicode ? ["◒", "◐", "◓", "◑"] : ["-", "\\", "|", "/"];
        this.bar = unicode ? "│" : "|";
    }

    private truncate(text: string): string {
        const max = Math.max(10, (this.stream.columns ?? 80) - 4);
        return text.length > max ? `${text.slice(0, max - 1)}…` : text;
    }

    private render = (): void => {
        const frame = this.c.magenta(this.frames[this.index % this.frames.length] ?? "");
        this.index++;
        this.stream.write(`${CLEAR_LINE}${frame}  ${this.truncate(this.text)}`);
    };

    start(message: string): void {
        this.stop("");
        this.text = message;
        this.stream.write(`${this.c.gray(this.bar)}\n${HIDE_CURSOR}`);
        this.removeExitHook = onExitCleanup(() => this.stream.write(`${CLEAR_LINE}${SHOW_CURSOR}`));
        this.render();
        this.timer = setInterval(this.render, 80);
        this.timer.unref();
    }

    message(message: string): void {
        this.text = message;
    }

    private finish(symbol: string, message: string): void {
        if (!this.timer) return;
        clearInterval(this.timer);
        this.timer = undefined;
        this.removeExitHook?.();
        this.stream.write(`${CLEAR_LINE}${SHOW_CURSOR}`);
        if (message) this.stream.write(`${symbol}  ${message}\n`);
    }

    stop(message: string): void {
        this.finish(this.c.green("◇"), message);
    }

    fail(message: string): void {
        this.finish(this.c.red("■"), message);
    }
}

/** Everything the commands print goes through here, so every mode stays consistent. */
export class Output {
    readonly mode: OutputMode;
    readonly verboseEnabled: boolean;
    /** Both stdin and stdout are terminals and we're in the default mode. */
    readonly canPrompt: boolean;
    readonly c: Colors;
    readonly unicode: boolean;
    readonly colorDepth: ColorDepth;
    readonly stdout: NodeJS.WriteStream;
    readonly stderr: NodeJS.WriteStream;
    readonly stdin: NodeJS.ReadStream;

    constructor(options: OutputOptions = {}) {
        this.stdout = options.stdout ?? process.stdout;
        this.stderr = options.stderr ?? process.stderr;
        this.stdin = options.stdin ?? process.stdin;
        const env = options.env ?? process.env;
        // Some pseudo-terminals report a width of 0; the interactive UI can't be drawn there.
        const interactiveTerminal = Boolean(
            this.stdout.isTTY && this.stdin.isTTY && (this.stdout.columns ?? 0) > 0
        );

        this.mode = options.json
            ? "json"
            : options.quiet
              ? "quiet"
              : interactiveTerminal
                ? "pretty"
                : "plain";
        this.verboseEnabled = Boolean(options.verbose);
        this.canPrompt = this.mode === "pretty";
        this.colorDepth = detectColorDepth(this.stdout, env, Boolean(options.noColor));
        this.c = pc.createColors(this.colorDepth > 1);
        this.unicode = !options.ascii && supportsUnicode(env);
    }

    get graphStyle(): GraphStyle {
        return { colorDepth: this.colorDepth, unicode: this.unicode };
    }

    /** Columns available for content (the pretty mode draws a guide on the left). */
    get width(): number {
        const fromEnv = Number.parseInt(process.env.COLUMNS ?? "", 10);
        const columns =
            this.stdout.columns ?? (Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 120);
        return this.mode === "pretty" ? columns - 3 : columns;
    }

    private symbol(kind: "success" | "info" | "warn" | "error" | "step"): string {
        if (!this.unicode)
            return { success: "[ok]", info: "[i]", warn: "[!]", error: "[x]", step: "[*]" }[kind];
        const { c } = this;
        return {
            success: c.green("✔"),
            info: c.blue("ℹ"),
            warn: c.yellow("⚠"),
            error: c.red("✖"),
            step: c.green("◇")
        }[kind];
    }

    private line(stream: NodeJS.WriteStream, text: string): void {
        stream.write(`${text}\n`);
    }

    intro(title: string): void {
        if (this.mode === "pretty") clack.intro(title, { output: this.stdout });
    }

    outro(message: string): void {
        if (this.mode === "pretty") clack.outro(message, { output: this.stdout });
        else if (this.mode === "plain" || this.mode === "quiet") this.line(this.stdout, message);
    }

    info(message: string): void {
        if (this.mode === "pretty") clack.log.info(message, { output: this.stdout });
        else if (this.mode === "plain") this.line(this.stdout, `${this.symbol("info")} ${message}`);
    }

    step(message: string): void {
        if (this.mode === "pretty") clack.log.step(message, { output: this.stdout });
        else if (this.mode === "plain") this.line(this.stdout, `${this.symbol("step")} ${message}`);
    }

    success(message: string): void {
        if (this.mode === "pretty") clack.log.success(message, { output: this.stdout });
        else if (this.mode === "plain")
            this.line(this.stdout, `${this.symbol("success")} ${message}`);
    }

    /** Warnings are shown in every mode except JSON (where they go to stderr). */
    warn(message: string): void {
        if (this.mode === "pretty") clack.log.warn(message, { output: this.stdout });
        else this.line(this.stderr, `${this.symbol("warn")} ${message}`);
    }

    error(message: string): void {
        if (this.mode === "pretty") clack.log.error(message, { output: this.stderr });
        else this.line(this.stderr, `${this.symbol("error")} ${message}`);
    }

    verbose(message: string): void {
        if (!this.verboseEnabled) return;
        this.line(this.stderr, this.c.gray(`[debug] ${message}`));
    }

    /** A titled block (a box in the terminal). */
    note(body: string, title?: string): void {
        if (this.mode === "pretty") {
            clack.note(body, title, { output: this.stdout });
        } else if (this.mode === "plain") {
            if (title) this.line(this.stdout, title);
            for (const row of body.split("\n")) this.line(this.stdout, `  ${row}`);
        }
    }

    /** Pre-rendered text such as the graph. */
    block(text: string): void {
        if (this.mode === "pretty") {
            clack.log.message(text.split("\n"), {
                symbol: this.c.gray(this.unicode ? "│" : "|"),
                output: this.stdout
            });
        } else if (this.mode === "plain") {
            this.line(this.stdout, text);
        }
    }

    spinner(): Spinner {
        if (this.mode === "pretty") return new TerminalSpinner(this.stdout, this.c, this.unicode);
        if (this.mode === "plain") {
            return {
                start: (message) => this.line(this.stdout, `${this.symbol("step")} ${message}…`),
                message: () => {},
                stop: (message) => {
                    if (message) this.line(this.stdout, `${this.symbol("success")} ${message}`);
                },
                fail: (message) => this.line(this.stderr, `${this.symbol("error")} ${message}`)
            };
        }
        return noopSpinner;
    }

    json(value: unknown): void {
        this.line(this.stdout, JSON.stringify(value, null, 2));
    }
}
