import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
    version: string;
};

export default defineConfig({
    define: {
        __RETROCOMMIT_VERSION__: JSON.stringify(pkg.version)
    },
    test: {
        include: ["test/**/*.test.ts"],
        globalSetup: ["test/global-setup.ts"],
        testTimeout: 60_000,
        hookTimeout: 120_000,
        coverage: {
            provider: "v8",
            include: ["src/**/*.ts"],
            exclude: ["src/cli.ts", "src/wizard.ts"],
            reporter: ["text", "html", "lcov"]
        }
    }
});
