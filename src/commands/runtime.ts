import { basename, resolve } from "node:path";
import type { CommonFlags, GenerationFlags } from "../cli/flags.ts";
import { findConfigFile, type LoadedConfig, loadConfigFile } from "../config/load.ts";
import { VERSION } from "../constants.ts";
import { Output } from "../ui/output.ts";

/** Process-level context shared by every command. */
export interface Runtime {
    /** Arguments after `retrocommit` (without node and the script path). */
    argv: readonly string[];
    cwd: string;
    now: Date;
    /** Aborted on Ctrl+C / SIGTERM. */
    signal: AbortSignal;
}

export function createOutput(flags: CommonFlags): Output {
    return new Output({
        json: flags.json,
        quiet: flags.quiet,
        verbose: flags.verbose,
        noColor: flags.color === false,
        ascii: flags.ascii
    });
}

export function banner(out: Output): string {
    return `${out.c.bgGreen(out.c.black(" retrocommit "))} ${out.c.dim(`v${VERSION}`)}`;
}

/** Loads `--config`, or the config file found in the working directory. */
export async function loadConfig(
    flags: Pick<GenerationFlags, "config">,
    cwd: string,
    out: Output
): Promise<LoadedConfig | undefined> {
    if (flags.config === false) return undefined;
    const path =
        typeof flags.config === "string" ? resolve(cwd, flags.config) : await findConfigFile(cwd);
    if (!path) return undefined;
    const loaded = await loadConfigFile(path);
    out.verbose(`Loaded configuration from ${path}`);
    if (typeof flags.config !== "string") out.info(`Using ${out.c.bold(basename(path))}`);
    return loaded;
}
