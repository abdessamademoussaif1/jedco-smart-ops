import { type Day, formatDay } from "../core/dates.ts";

export function formatNumber(value: number): string {
    return value.toLocaleString("en-US");
}

/** `plural(3, "commit")` → `3 commits`. */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
    return `${formatNumber(count)} ${count === 1 ? singular : pluralForm}`;
}

export function formatDuration(ms: number): string {
    if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    const minutes = Math.floor(ms / 60_000);
    const seconds = Math.round((ms % 60_000) / 1000);
    return `${minutes}m ${seconds}s`;
}

export function formatRange(from: Day, to: Day): string {
    return `${formatDay(from)} → ${formatDay(to)}`;
}

export function percent(part: number, total: number): string {
    if (total === 0) return "0%";
    return `${Math.round((part / total) * 100)}%`;
}

/** Aligns `label  value` rows, e.g. for summaries. */
export function table(rows: ReadonlyArray<readonly [string, string]>): string {
    const width = Math.max(0, ...rows.map(([label]) => label.length));
    return rows.map(([label, value]) => `${label.padEnd(width)}  ${value}`).join("\n");
}
