export const ExitCode = {
    Success: 0,
    Failure: 1,
    Usage: 2,
    Cancelled: 130
} as const;

export interface RetroErrorOptions {
    /** A short, actionable suggestion printed below the message. */
    hint?: string;
    /** Extra lines (for example, every invalid option) printed as a list. */
    details?: readonly string[];
    exitCode?: number;
    cause?: unknown;
}

/**
 * Base class for every *expected* error. These are printed without a stack trace,
 * together with their hint and details.
 */
export class RetroError extends Error {
    readonly hint: string | undefined;
    readonly details: readonly string[];
    readonly exitCode: number;

    constructor(message: string, options: RetroErrorOptions = {}) {
        super(message, options.cause === undefined ? undefined : { cause: options.cause });
        this.name = "RetroError";
        this.hint = options.hint;
        this.details = options.details ?? [];
        this.exitCode = options.exitCode ?? ExitCode.Failure;
    }
}

/** Invalid flags, configuration values or combinations of options. */
export class ConfigError extends RetroError {
    constructor(message: string, options: Omit<RetroErrorOptions, "exitCode"> = {}) {
        super(message, { ...options, exitCode: ExitCode.Usage });
        this.name = "ConfigError";
    }
}

/** The user cancelled a prompt or pressed Ctrl+C. */
export class CancelledError extends RetroError {
    constructor(message = "Cancelled.") {
        super(message, { exitCode: ExitCode.Cancelled });
        this.name = "CancelledError";
    }
}

export class GitError extends RetroError {
    readonly stderr: string;

    constructor(message: string, options: RetroErrorOptions & { stderr?: string } = {}) {
        super(message, options);
        this.name = "GitError";
        this.stderr = options.stderr ?? "";
    }
}

export class GitHubError extends RetroError {
    readonly status: number | undefined;

    constructor(message: string, options: RetroErrorOptions & { status?: number } = {}) {
        super(message, options);
        this.name = "GitHubError";
        this.status = options.status;
    }
}

/**
 * Thrown by the pure value parsers. Its message is user-facing; callers wrap it
 * with the name of the option that was being parsed.
 */
export class InvalidValueError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "InvalidValueError";
    }
}

export function errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
}
