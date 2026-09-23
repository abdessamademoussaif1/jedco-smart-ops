import { readFileSync } from "node:fs";
import { defineConfig } from "tsdown";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
    version: string;
};

export default defineConfig({
    entry: { cli: "src/cli.ts" },
    format: "esm",
    platform: "node",
    target: "node22.12",
    outDir: "dist",
    // package.json has "type": "module", so plain .js files are ES modules.
    fixedExtension: false,
    clean: true,
    dts: false,
    sourcemap: false,
    define: {
        __RETROCOMMIT_VERSION__: JSON.stringify(pkg.version)
    }
});
