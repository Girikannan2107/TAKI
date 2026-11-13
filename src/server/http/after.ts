import "server-only";
/**
 * Post-commit work (refund jobs, SMS). Inside a Next request it uses `after()` from
 * next/server; under vitest the tasks queue up until `flushAfterTasks()`; elsewhere
 * (scripts) they run detached.
 */
import { after } from "next/server";

type Task = () => Promise<unknown> | unknown;

const g = globalThis as unknown as { __takiAfterQueue?: Task[] };

function queue(): Task[] {
  if (!g.__takiAfterQueue) g.__takiAfterQueue = [];
  return g.__takiAfterQueue;
}

function runDetached(task: Task): void {
  Promise.resolve()
    .then(task)
    .catch((e) => console.error("[taki] post-commit task failed", e));
}

export function scheduleAfter(task: Task): void {
  if (process.env.VITEST === "true") {
    queue().push(task);
    return;
  }
  try {
    after(async () => {
      try {
        await task();
      } catch (e) {
        console.error("[taki] post-commit task failed", e);
      }
    });
  } catch {
    // Not inside a request scope (scripts): run detached.
    runDetached(task);
  }
}

/** Vitest: run all queued post-commit tasks (in order) and wait for them. */
export async function flushAfterTasks(): Promise<number> {
  let n = 0;
  while (queue().length > 0) {
    const task = queue().shift()!;
    n += 1;
    await task();
  }
  return n;
}

/** Vitest: drop queued tasks. */
export function clearAfterTasks(): void {
  queue().length = 0;
}
