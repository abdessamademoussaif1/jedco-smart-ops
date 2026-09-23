import { describe, expect, it } from "vitest";
import type { CommitSpec } from "../../src/core/commits.ts";
import { compareVersion, parseGitVersion, redact } from "../../src/git/exec.ts";
import { dailyPath, fastImportStream } from "../../src/git/fast-import.ts";
import { authOptions, remoteError } from "../../src/git/repository.ts";
import { d } from "../helpers.ts";

const author = { name: "Ada Lovelace", email: "1+ada@users.noreply.github.com" };

function commit(overrides: Partial<CommitSpec> = {}): CommitSpec {
    return {
        index: 1,
        day: d("2024-03-05"),
        n: 1,
        count: 1,
        instant: { epochSeconds: 1709645000, offsetMinutes: 60 },
        message: "First ✓",
        ...overrides
    };
}

describe("fastImportStream", () => {
    it("writes exact byte lengths, signatures and the done marker", () => {
        const chunks = [
            ...fastImportStream([commit()], {
                branch: "main",
                author,
                content: "single",
                contentPath: "activity.log"
            })
        ];
        expect(chunks).toHaveLength(2);
        expect(chunks[1]).toBe("done\n");
        const block = chunks[0] ?? "";
        expect(block).toContain("commit refs/heads/main\n");
        expect(block).toContain(
            "author Ada Lovelace <1+ada@users.noreply.github.com> 1709645000 +0100\n"
        );
        expect(block).toContain(
            "committer Ada Lovelace <1+ada@users.noreply.github.com> 1709645000 +0100\n"
        );
        // "First ✓" is 9 bytes in UTF-8 (✓ takes 3).
        expect(block).toContain("data 9\nFirst ✓\n");
        expect(block).toContain("M 100644 inline activity.log\n");
        expect(block).not.toContain("from ");
        expect(block).not.toContain("README.md");
    });

    it("adds the parent and README only to the first commit", () => {
        const chunks = [
            ...fastImportStream([commit(), commit({ index: 2, n: 2, count: 2 })], {
                branch: "main",
                author,
                content: "empty",
                contentPath: "activity.log",
                readme: "# Hi\n",
                parent: "refs/remotes/origin/main^0"
            })
        ];
        expect(chunks[0]).toContain("from refs/remotes/origin/main^0\n");
        expect(chunks[0]).toContain("M 100644 inline README.md\ndata 5\n# Hi\n");
        expect(chunks[1]).not.toContain("from ");
        expect(chunks[1]).not.toContain("README.md");
        expect(chunks[1]).not.toContain("activity.log");
    });

    it("accumulates one log file per day in daily mode", () => {
        const chunks = [
            ...fastImportStream(
                [
                    commit({ message: "one" }),
                    commit({
                        index: 2,
                        message: "two",
                        instant: { epochSeconds: 1709646000, offsetMinutes: 60 }
                    }),
                    commit({ index: 3, day: d("2024-03-06"), message: "three" })
                ],
                { branch: "main", author, content: "daily", contentPath: "activity" }
            )
        ];
        expect(chunks[1]).toContain("M 100644 inline activity/2024/03/2024-03-05.md\n");
        expect(chunks[1]).toContain("- 14:23:20 one\n- 14:40:00 two\n");
        expect(chunks[2]).toContain("activity/2024/03/2024-03-06.md");
        expect(chunks[2]).not.toContain("one");
        expect(dailyPath("logs", d("2024-12-01"))).toBe("logs/2024/12/2024-12-01.md");
    });
});

describe("git helpers", () => {
    it("parses and compares versions", () => {
        const version = parseGitVersion("git version 2.39.3 (Apple Git-146)");
        expect(version.raw).toBe("2.39.3");
        expect(compareVersion(version, "2.31.0")).toBe(1);
        expect(compareVersion(version, "2.39.3")).toBe(0);
        expect(compareVersion(parseGitVersion("git version 2.30.2.windows.1"), "2.31")).toBe(-1);
    });

    it("redacts secrets", () => {
        expect(redact("token=abc123 and abc123", ["abc123"])).toBe("token=*** and ***");
        expect(redact("nothing", undefined)).toBe("nothing");
    });

    it("passes tokens through environment variables on modern git", () => {
        const options = authOptions(
            { kind: "token", token: "ghp_secret", host: "GitHub.com" },
            parseGitVersion("2.40.0")
        );
        expect(options.config).toBeUndefined();
        expect(options.env?.GIT_CONFIG_COUNT).toBe(
            String(Number(process.env.GIT_CONFIG_COUNT ?? 0) + 2)
        );
        const values = Object.values(options.env ?? {}).join("\n");
        expect(values).toContain("http.https://github.com/.extraheader");
        expect(values).toContain(Buffer.from("x-access-token:ghp_secret").toString("base64"));
        expect(values).not.toContain("ghp_secret");
        expect(options.secrets).toContain("ghp_secret");
    });

    it("falls back to -c arguments on old git", () => {
        const options = authOptions(
            { kind: "token", token: "ghp_secret", host: "github.com" },
            parseGitVersion("2.30.0")
        );
        expect(options.env).toBeUndefined();
        expect(options.config?.map(([key]) => key)).toEqual([
            "http.https://github.com/.extraheader",
            "credential.helper"
        ]);
    });

    it("explains common push failures", () => {
        expect(remoteError("push", "! [rejected] main -> main (fetch first)").hint).toMatch(
            /--if-exists append/
        );
        expect(
            remoteError("push", "remote: error: GH007: Your push would publish a private email")
                .hint
        ).toMatch(/no-reply/);
        expect(
            remoteError("push", "git@github.com: Permission denied (publickey).").message
        ).toMatch(/SSH/);
        expect(
            remoteError("read", "fatal: repository 'x' not found\nRepository not found.").message
        ).toMatch(/not found/);
        expect(
            remoteError(
                "push",
                "fatal: unable to access 'https://x/': The requested URL returned error: 403"
            ).hint
        ).toMatch(/write access/);
    });
});
