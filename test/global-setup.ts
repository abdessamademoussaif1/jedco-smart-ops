import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Builds `dist/cli.js` once so the end-to-end tests run the real, bundled CLI. */
export default function setup(): void {
    if (process.env.RETROCOMMIT_SKIP_BUILD === "1") return;
    const root = join(dirname(fileURLToPath(import.meta.url)), "..");
    if (!existsSync(join(root, "src", "cli.ts"))) return;

    const require = createRequire(import.meta.url);
    const tsdownPackage = require.resolve("tsdown/package.json");
    const tsdownBin = join(dirname(tsdownPackage), "dist", "run.mjs");
    execFileSync(process.execPath, [tsdownBin, "--logLevel", "warn"], {
        cwd: root,
        stdio: "inherit"
    });
}
