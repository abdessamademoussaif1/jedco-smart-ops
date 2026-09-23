import { InvalidValueError } from "../errors.ts";

/** GitHub repository names: letters, digits, `.`, `-` and `_`, up to 100 characters. */
export function validateRepoName(input: string): string {
    const name = input.trim();
    if (name.length === 0) throw new InvalidValueError("the repository name is empty");
    if (name.length > 100)
        throw new InvalidValueError("repository names can have at most 100 characters");
    if (!/^[A-Za-z0-9._-]+$/.test(name)) {
        throw new InvalidValueError(
            `"${name}" is not a valid repository name (use letters, digits, ".", "-" and "_")`
        );
    }
    if (name === "." || name === "..") throw new InvalidValueError(`"${name}" is a reserved name`);
    if (name.toLowerCase().endsWith(".git")) {
        throw new InvalidValueError(
            `repository names can't end with ".git" (use "${name.slice(0, -4)}")`
        );
    }
    return name;
}

/** GitHub user/organization names: alphanumerics and single hyphens, up to 39 characters. */
export function validateOwnerName(input: string): string {
    const name = input.trim();
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(name)) {
        throw new InvalidValueError(`"${name}" is not a valid GitHub user or organization name`);
    }
    return name;
}

/** The rules of `git check-ref-format --branch`. */
export function validateBranchName(input: string): string {
    const name = input.trim();
    const invalid =
        name.length === 0 ||
        name === "@" ||
        name.startsWith("-") ||
        name.startsWith("/") ||
        name.endsWith("/") ||
        name.endsWith(".") ||
        name.includes("..") ||
        name.includes("@{") ||
        name.includes("//") ||
        // biome-ignore lint/suspicious/noControlCharactersInRegex: git forbids control characters.
        /[\u0000- \u007f~^:?*[\\]/.test(name) ||
        name.split("/").some((part) => part.startsWith(".") || part.endsWith(".lock"));
    if (invalid) throw new InvalidValueError(`"${name}" is not a valid branch name`);
    return name;
}

/** GitHub topics: lowercase letters, digits and hyphens, up to 50 characters, max 20 topics. */
export function validateTopics(input: readonly string[]): string[] {
    const topics = [...new Set(input.map((topic) => topic.trim().toLowerCase()).filter(Boolean))];
    if (topics.length > 20) throw new InvalidValueError("GitHub allows at most 20 topics");
    for (const topic of topics) {
        if (!/^[a-z0-9][a-z0-9-]{0,49}$/.test(topic)) {
            throw new InvalidValueError(
                `"${topic}" is not a valid topic (lowercase letters, digits and hyphens, max 50 characters)`
            );
        }
    }
    return topics;
}

/** Paths written inside the repository: relative, simple characters, never inside `.git`. */
export function validateContentPath(input: string): string {
    const path = input.trim().replace(/\\/g, "/").replace(/\/+$/, "");
    if (!/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(path)) {
        throw new InvalidValueError(
            `"${input}" is not a valid path (use a relative path with letters, digits, ".", "-", "_" and "/")`
        );
    }
    const parts = path.split("/");
    if (parts.some((part) => part === "." || part === "..")) {
        throw new InvalidValueError(`"${input}" can't contain "." or ".." segments`);
    }
    if (parts[0]?.toLowerCase() === ".git")
        throw new InvalidValueError(`"${input}" can't be inside .git`);
    return path;
}

export function validateAuthorName(input: string): string {
    const name = input.trim();
    if (name.length === 0) throw new InvalidValueError("the author name is empty");
    if (name.length > 200) throw new InvalidValueError("the author name is too long");
    if (/[<>\n\r\0]/.test(name))
        throw new InvalidValueError("the author name can't contain <, > or line breaks");
    return name;
}

export function validateEmail(input: string): string {
    const email = input.trim();
    if (!/^[^\s<>@]+@[^\s<>@]+$/.test(email) || email.length > 254) {
        throw new InvalidValueError(`"${email}" is not a valid email address`);
    }
    return email;
}

export function validateDescription(input: string): string {
    const text = input.trim();
    if (/[\n\r]/.test(text)) throw new InvalidValueError("the description must be a single line");
    if (text.length > 350)
        throw new InvalidValueError("the description can have at most 350 characters");
    return text;
}

/**
 * Remote URLs we are willing to hand to git: https/http, ssh, git, file, scp-like
 * (`git@host:owner/repo.git`) and local paths. Transport helpers such as `ext::` are refused.
 */
export function validateRemoteUrl(input: string): string {
    const url = input.trim();
    if (url.length === 0) throw new InvalidValueError("the remote URL is empty");
    if (/^[a-z][a-z0-9+.-]*::/i.test(url) || url.startsWith("-")) {
        throw new InvalidValueError(`"${url}" uses a transport that isn't allowed`);
    }
    if (/^(?:https?|ssh|git|file):\/\/\S+$/i.test(url)) return url;
    if (/^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+:\S+$/.test(url)) return url;
    if (/^(?:\/|\.{1,2}\/|[A-Za-z]:[\\/]|\\\\)/.test(url)) return url;
    throw new InvalidValueError(
        `"${url}" is not a supported remote URL (use https://…, ssh://…, git@host:owner/repo.git or a local path)`
    );
}

export function validateHost(input: string): string {
    const host = input
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, "")
        .replace(/\/+$/, "");
    if (!/^[a-z0-9.-]+(?::\d{1,5})?$/.test(host) || !host.includes(".")) {
        throw new InvalidValueError(`"${input}" is not a valid host name (e.g. github.com)`);
    }
    return host;
}

export function validateApiUrl(input: string): string {
    let url: URL;
    try {
        url = new URL(input.trim());
    } catch {
        throw new InvalidValueError(`"${input}" is not a valid URL`);
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
        throw new InvalidValueError(`"${input}" must be an http(s) URL`);
    }
    return url.toString().replace(/\/+$/, "");
}
