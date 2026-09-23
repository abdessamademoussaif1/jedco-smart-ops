import { describe, expect, it } from "vitest";
import {
    validateApiUrl,
    validateAuthorName,
    validateBranchName,
    validateContentPath,
    validateDescription,
    validateEmail,
    validateHost,
    validateOwnerName,
    validateRemoteUrl,
    validateRepoName,
    validateTopics
} from "../../src/config/validate.ts";

describe("validators", () => {
    it("checks repository names", () => {
        expect(validateRepoName(" activity-log ")).toBe("activity-log");
        expect(validateRepoName("my.repo_2")).toBe("my.repo_2");
        for (const bad of ["", "a b", "..", "repo.git", "ñandú", "x".repeat(101)]) {
            expect(() => validateRepoName(bad), bad).toThrow();
        }
    });

    it("checks owners", () => {
        expect(validateOwnerName("abpineda")).toBe("abpineda");
        expect(validateOwnerName("my-org-2")).toBe("my-org-2");
        for (const bad of ["-org", "org-", "a--b", "a_b", "x".repeat(40)]) {
            expect(() => validateOwnerName(bad), bad).toThrow();
        }
    });

    it("checks branch names like git does", () => {
        for (const good of ["main", "feature/x", "v1.0", "release-2024"]) {
            expect(validateBranchName(good)).toBe(good);
        }
        for (const bad of [
            "",
            "@",
            "-x",
            "a..b",
            "a b",
            "a~b",
            "a^b",
            "a:b",
            "x.lock",
            "a/.b",
            "a//b",
            "end/",
            "x.",
            "a@{b"
        ]) {
            expect(() => validateBranchName(bad), bad).toThrow();
        }
    });

    it("checks topics", () => {
        expect(validateTopics(["Retrocommit", "retrocommit", "activity"])).toEqual([
            "retrocommit",
            "activity"
        ]);
        expect(() => validateTopics(["bad topic"])).toThrow();
        expect(() => validateTopics(Array.from({ length: 21 }, (_, i) => `t${i}`))).toThrow(/20/);
    });

    it("checks content paths", () => {
        expect(validateContentPath("logs/activity.log")).toBe("logs/activity.log");
        expect(validateContentPath("logs\\daily\\")).toBe("logs/daily");
        for (const bad of ["../x", "/abs", ".git/config", "a/./b", "with space", ""]) {
            expect(() => validateContentPath(bad), bad).toThrow();
        }
    });

    it("checks author identities and descriptions", () => {
        expect(validateAuthorName(" Ada ")).toBe("Ada");
        expect(() => validateAuthorName("<evil>")).toThrow();
        expect(validateEmail("1+ada@users.noreply.github.com")).toBe(
            "1+ada@users.noreply.github.com"
        );
        expect(() => validateEmail("ada")).toThrow();
        expect(() => validateEmail("a b@c.d")).toThrow();
        expect(() => validateDescription("line\nbreak")).toThrow();
        expect(() => validateDescription("x".repeat(351))).toThrow();
    });

    it("only accepts safe remote URLs", () => {
        for (const good of [
            "https://github.com/a/b.git",
            "ssh://git@github.com/a/b.git",
            "git@github.com:a/b.git",
            "file:///tmp/repo.git",
            "/tmp/repo.git",
            "./repo",
            "C:\\repos\\x.git"
        ]) {
            expect(validateRemoteUrl(good)).toBe(good);
        }
        for (const bad of ["ext::sh -c id", "fd::7", "-upload-pack=evil", "github.com/a/b", ""]) {
            expect(() => validateRemoteUrl(bad), bad).toThrow();
        }
    });

    it("checks hosts and API URLs", () => {
        expect(validateHost("https://GitHub.acme.com/")).toBe("github.acme.com");
        expect(validateHost("git.local:8443")).toBe("git.local:8443");
        expect(() => validateHost("localhost")).toThrow();
        expect(validateApiUrl("https://api.acme.com/v3/")).toBe("https://api.acme.com/v3");
        expect(() => validateApiUrl("ftp://x")).toThrow();
        expect(() => validateApiUrl("nope")).toThrow();
    });
});
