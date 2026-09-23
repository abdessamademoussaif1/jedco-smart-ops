#!/usr/bin/env node

// Keep this file free of modern syntax: it must be able to tell users of old Node.js
// versions to upgrade instead of crashing with a syntax error.
var parts = process.versions.node.split(".");
var major = Number(parts[0]);
var minor = Number(parts[1]);

if (major < 22 || (major === 22 && minor < 12)) {
    process.stderr.write(
        "retrocommit needs Node.js 22.12 or newer (you have " +
            process.version +
            ").\nUpdate it from https://nodejs.org and try again.\n"
    );
    process.exit(1);
}

import("./main.ts").then((module) =>
    module.main(process.argv).then((code) => {
        process.exitCode = code;
        // Flush stdout before exiting so piped output (e.g. --json) is never cut short.
        process.stdout.write("", () => {
            process.exit(code);
        });
    })
);
