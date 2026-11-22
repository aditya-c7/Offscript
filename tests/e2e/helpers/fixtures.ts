import { spawn, type ChildProcess } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Repo root: tests/e2e/helpers -> tests/e2e -> tests -> <root>. */
export const REPO_ROOT = resolve(HERE, "..", "..", "..");

export interface FixtureServers {
  stop: () => Promise<void>;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, ms);
  });
}

async function probe(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`, {
      signal: AbortSignal.timeout(1_000),
    });
    await response.body?.cancel().catch(() => {});
    return true;
  } catch {
    return false;
  }
}

function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolveExit) => {
    child.once("exit", () => resolveExit());
  });
}

async function waitForPorts(
  ports: readonly number[],
  child: ChildProcess,
  readOutput: () => string,
): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `Fixture servers exited early with code ${child.exitCode}:\n${readOutput()}`,
      );
    }
    const ready = await Promise.all(ports.map(probe));
    if (ready.every(Boolean)) return;
    await delay(100);
  }
  throw new Error(
    `Timed out waiting for fixture ports ${ports.join(", ")}:\n${readOutput()}`,
  );
}

/**
 * Start the deterministic offline fixture servers used by the e2e suite.
 * All test modules share one instance so the fixed ports are never contended.
 */
export async function startFixtureServers(): Promise<FixtureServers> {
  const child = spawn("node", ["fixtures/sites/servers.mjs"], {
    cwd: REPO_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    output += chunk.toString("utf8");
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    output += chunk.toString("utf8");
  });

  await waitForPorts([4101, 4103, 4105], child, () => output);

  return {
    stop: async () => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
      }
      await waitForExit(child);
    },
  };
}
