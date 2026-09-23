import { InvalidValueError } from "../errors.ts";

export const PLACEHOLDERS = [
    "date",
    "time",
    "datetime",
    "n",
    "count",
    "i",
    "total",
    "weekday",
    "year",
    "month",
    "day"
] as const;

export type Placeholder = (typeof PLACEHOLDERS)[number];
export type MessageContext = Readonly<Record<Placeholder, string | number>>;

const TOKEN_RE = /\{\{|\}\}|\{([^{}]*)\}/g;
const KNOWN = new Set<string>(PLACEHOLDERS);

/** Returns the placeholders used in a template that don't exist. */
export function findUnknownPlaceholders(template: string): string[] {
    const unknown: string[] = [];
    for (const match of template.matchAll(TOKEN_RE)) {
        const name = match[1];
        if (name !== undefined && !KNOWN.has(name.trim())) unknown.push(name);
    }
    return unknown;
}

/** Throws a user-facing error if the template is empty or uses unknown placeholders. */
export function validateTemplate(template: string): void {
    if (template.trim() === "") throw new InvalidValueError("the commit message can't be empty");
    if (/[\0]/.test(template))
        throw new InvalidValueError("the commit message contains a NUL byte");
    const unknown = findUnknownPlaceholders(template);
    if (unknown.length > 0) {
        const list = unknown.map((name) => `{${name}}`).join(", ");
        throw new InvalidValueError(
            `unknown placeholder ${list}. Available: ${PLACEHOLDERS.map((name) => `{${name}}`).join(" ")} (use {{ and }} for literal braces)`
        );
    }
}

/** Replaces `{placeholders}`; `{{` and `}}` produce literal braces. */
export function renderTemplate(template: string, context: MessageContext): string {
    return template.replace(TOKEN_RE, (match, name: string | undefined) => {
        if (match === "{{") return "{";
        if (match === "}}") return "}";
        const key = (name ?? "").trim() as Placeholder;
        return String(context[key] ?? match);
    });
}

/** One message per line. Blank lines and lines starting with `#` are ignored. */
export function parseMessagesFile(text: string): string[] {
    const messages = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("#"));
    if (messages.length === 0) {
        throw new InvalidValueError("the messages file has no messages (one per line)");
    }
    for (const message of messages) validateTemplate(message);
    return messages;
}
