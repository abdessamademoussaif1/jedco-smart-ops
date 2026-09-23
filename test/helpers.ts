import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Day, dayFromYmd } from "../src/core/dates.ts";

/** `d("2024-03-05")` → day number. */
export function d(text: string): Day {
    const [year, month, day] = text.split("-").map(Number);
    return dayFromYmd(year ?? 1970, month ?? 1, day ?? 1);
}

/** Creates a temporary directory and returns it with a cleanup function. */
export async function tempDir(prefix = "retrocommit-test-"): Promise<{
    path: string;
    cleanup: () => Promise<void>;
}> {
    const path = await mkdtemp(join(tmpdir(), prefix));
    return {
        path,
        cleanup: () => rm(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    };
}
