import { rmSync } from "node:fs";

type Task = () => void;

const tasks = new Set<Task>();
let installed = false;

function runAll(): void {
    for (const task of [...tasks]) {
        try {
            task();
        } catch {
            // Best effort: never let cleanup hide the real error.
        }
    }
    tasks.clear();
}

/**
 * Registers a synchronous cleanup task that runs if the process exits early
 * (e.g. a second Ctrl+C). Returns a function that unregisters it.
 */
export function onExitCleanup(task: Task): () => void {
    if (!installed) {
        installed = true;
        process.on("exit", runAll);
    }
    tasks.add(task);
    return () => {
        tasks.delete(task);
    };
}

/** Removes a directory now and on any early exit. */
export function removeDirOnExit(path: string): () => void {
    return onExitCleanup(() => rmSync(path, { recursive: true, force: true }));
}
