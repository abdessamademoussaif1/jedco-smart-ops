declare const __RETROCOMMIT_VERSION__: string | undefined;

/** Injected at build time (tsdown/vitest `define`); falls back when running from source. */
export const VERSION: string =
    typeof __RETROCOMMIT_VERSION__ === "string" ? __RETROCOMMIT_VERSION__ : "0.0.0-dev";

export const TOOL_NAME = "retrocommit";
export const PROJECT_URL = "https://github.com/abpineda/retrocommit";
export const ISSUES_URL = `${PROJECT_URL}/issues/new?template=bug_report.yml`;
export const SCHEMA_URL = "https://cdn.jsdelivr.net/npm/retrocommit/schema.json";
export const USER_AGENT = `${TOOL_NAME}/${VERSION} (+${PROJECT_URL})`;

/** Topic added to every repository we create. `delete` and `--if-exists replace` require it. */
export const MARKER_TOPIC = "retrocommit";

export const MIN_NODE_VERSION = "22.12.0";
export const MIN_GIT_VERSION = "2.20.0";
/** `GIT_CONFIG_COUNT` (used to pass credentials without exposing them) needs this version. */
export const GIT_CONFIG_ENV_VERSION = "2.31.0";

export const CONFIG_FILE_NAMES = [
    "retrocommit.config.json",
    "retrocommit.config.yaml",
    "retrocommit.config.yml",
    ".retrocommitrc",
    ".retrocommitrc.json",
    ".retrocommitrc.yaml",
    ".retrocommitrc.yml"
] as const;
