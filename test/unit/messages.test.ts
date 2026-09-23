import { describe, expect, it } from "vitest";
import {
    findUnknownPlaceholders,
    type MessageContext,
    parseMessagesFile,
    renderTemplate,
    validateTemplate
} from "../../src/core/messages.ts";

const context: MessageContext = {
    date: "2024-01-01",
    time: "10:11:12",
    datetime: "2024-01-01T10:11:12+01:00",
    n: 2,
    count: 5,
    i: 42,
    total: 100,
    weekday: "Monday",
    year: 2024,
    month: "01",
    day: "01"
};

describe("templates", () => {
    it("renders placeholders and escaped braces", () => {
        expect(renderTemplate("Commit {n}/{count} on {date} {{literal}}", context)).toBe(
            "Commit 2/5 on 2024-01-01 {literal}"
        );
        expect(renderTemplate("#{i} of {total} · {weekday} {datetime}", context)).toBe(
            "#42 of 100 · Monday 2024-01-01T10:11:12+01:00"
        );
        expect(renderTemplate("{ date }", context)).toBe("2024-01-01");
    });

    it("finds unknown placeholders", () => {
        expect(findUnknownPlaceholders("{date} {foo} {{bar}}")).toEqual(["foo"]);
        expect(findUnknownPlaceholders("no placeholders")).toEqual([]);
    });

    it("validates templates", () => {
        expect(() => validateTemplate("   ")).toThrow(/can't be empty/);
        expect(() => validateTemplate("Update {nope}")).toThrow(/unknown placeholder \{nope\}/);
        expect(() => validateTemplate("Update {date}")).not.toThrow();
    });
});

describe("parseMessagesFile", () => {
    it("reads one message per line, skipping blanks and comments", () => {
        expect(
            parseMessagesFile("# comment\nFix typo\n\n  Refactor {date}  \r\nUpdate docs\n")
        ).toEqual(["Fix typo", "Refactor {date}", "Update docs"]);
    });

    it("rejects empty files and invalid templates", () => {
        expect(() => parseMessagesFile("# only comments\n\n")).toThrow(/no messages/);
        expect(() => parseMessagesFile("ok\nbad {x}\n")).toThrow(/unknown placeholder/);
    });
});
