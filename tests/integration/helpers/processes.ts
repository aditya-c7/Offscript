import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
/** tests/integration/helpers -> tests/integration -> tests -> <root>. */
export const REPO_ROOT = resolve(HERE, "..", "..", "..");

const LOG_LIMIT = 4000;

function redact(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length > 0) out = out.split(secret).join("[REDACTED]");
  }
  return out;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, ms);
  });
}

function waitExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolveExit) => {
    child.once("exit", () => resolveExit());
  });
}

export interface ManagedProcess {
  readonly label: string;
  readonly child: ChildProcess;
  /** Last (redacted) log bytes, for actionable failure messages only. */
  readLog(): string;
  stop(): Promise<void>;
}

function spawnManaged(options: {
  label: string;
  command: string;
  args: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  secrets: readonly string[];
}): ManagedProcess {
  const child = spawn(options.command, [...options.args], {
    cwd: options.cwd,
    env: options.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let log = "";
  const collect = (chunk: Buffer): void => {
    log = (log + redact(chunk.toString("utf8"), options.secrets)).slice(
      -LOG_LIMIT,
    );
  };
  child.stdout?.on("data", collect);
  child.stderr?.on("data", collect);

  return {
    label: options.label,
    child,
    readLog: () => log,
    stop: async () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill("SIGTERM");
      const exited = await Promise.race([
        waitExit(child).then(() => true),
        delay(5000).then(() => false),
      ]);
      if (!exited) {
        child.kill("SIGKILL");
        await waitExit(child);
      }
    },
  };
}

/**
 * Readiness probe. A 404 from the worker means its HTTP front door is up;
 * a 200 from /api/health means Next is serving.
 */
export async function waitForHttp(
  url: string,
  process: ManagedProcess,
  acceptable: readonly number[],
  timeoutMs: number,
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (process.child.exitCode !== null) {
      throw new Error(
        `${process.label} exited early (code ${process.child.exitCode}). ` +
          `Redacted log tail:\n${process.readLog()}`,
      );
    }
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.body) await response.body.cancel().catch(() => undefined);
      if (acceptable.includes(response.status)) return response.status;
    } catch {
      // Not listening yet.
    }
    await delay(150);
  }
  throw new Error(
    `Timed out waiting for ${process.label} at its loopback port. ` +
      `Redacted log tail:\n${process.readLog()}`,
  );
}

export function startWorker(options: {
  databaseUrl: string;
  port: number;
  token: string;
  storageDir: string;
}): ManagedProcess {
  mkdirSync(options.storageDir, { recursive: true });
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: options.databaseUrl,
    DB_DRIVER: "node",
    WORKER_ENQUEUE_HOST: "127.0.0.1",
    WORKER_ENQUEUE_PORT: String(options.port),
    WORKER_ENQUEUE_URL: `http://127.0.0.1:${options.port}/enqueue`,
    WORKER_ENQUEUE_TOKEN: options.token,
    STORAGE_DIR: options.storageDir,
    WORKER_MEMORY_MB: "512",
  };
  // Deliberately NOT using `pnpm worker`: its start script loads ../../.env.
  return spawnManaged({
    label: "worker",
    command: process.execPath,
    args: ["--import", "tsx", "src/index.ts"],
    cwd: resolve(REPO_ROOT, "apps", "worker"),
    env,
    secrets: [options.databaseUrl, options.token],
  });
}

export function startWeb(options: {
  databaseUrl: string;
  port: number;
  workerPort: number;
  token: string;
  storageDir: string;
}): ManagedProcess {
  const nextBin = resolve(
    REPO_ROOT,
    "node_modules",
    "next",
    "dist",
    "bin",
    "next",
  );
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: options.databaseUrl,
    DB_DRIVER: "node",
    WORKER_ENQUEUE_URL: `http://127.0.0.1:${options.workerPort}/enqueue`,
    WORKER_ENQUEUE_TOKEN: options.token,
    STORAGE_DIR: options.storageDir,
    NEXT_TELEMETRY_DISABLED: "1",
  };
  return spawnManaged({
    label: "web",
    command: process.execPath,
    args: [nextBin, "dev", "-p", String(options.port)],
    cwd: resolve(REPO_ROOT, "apps", "web"),
    env,
    secrets: [options.databaseUrl, options.token],
  });
}
