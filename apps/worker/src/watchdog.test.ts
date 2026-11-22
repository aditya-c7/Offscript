import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ORPHAN_MAX_AGE_MS,
  WATCHDOG_INTERVAL_MS,
  isOrphanedChromium,
  listChromiumProcesses,
  startChromiumWatchdog,
  type ProcessSample,
} from "./watchdog.js";

const { execFileMock } = vi.hoisted(() => ({ execFileMock: vi.fn() }));
vi.mock("node:child_process", () => ({ execFile: execFileMock }));

type ExecCallback = (error: Error | null, stdout: string) => void;

function output(stdout: string): void {
  execFileMock.mockImplementation(
    (
      _file: unknown,
      _args: unknown,
      _opts: unknown,
      callback: ExecCallback,
    ) => {
      callback(null, stdout);
    },
  );
}

const SEP = "\u0001";
// Process listings are platform-specific; fixtures follow the host so the
// production parser exercised by each test is the same one CI will use.
const EOL = process.platform === "win32" ? "\r\n" : "\n";
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

function formatLine(pid: number, startedAtMs: number, command: string): string {
  const date = new Date(startedAtMs);
  if (process.platform === "win32") {
    return [String(pid), date.toISOString(), command].join(SEP);
  }
  const weekday = DAYS[date.getDay()] ?? "Sun";
  const month = MONTHS[date.getMonth()] ?? "Jan";
  const day = String(date.getDate()).padStart(2, " ");
  const time = date.toTimeString().slice(0, 8);
  return `${String(pid).padStart(5)} ${weekday} ${month} ${day} ${time} ${date.getFullYear()} ${command}`;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  execFileMock.mockReset();
});

describe("constants", () => {
  it("exposes the expected intervals", () => {
    expect(WATCHDOG_INTERVAL_MS).toBe(900_000);
    expect(ORPHAN_MAX_AGE_MS).toBe(360_000);
  });
});

describe("isOrphanedChromium", () => {
  const now = 1_700_000_000_000;
  const old = now - ORPHAN_MAX_AGE_MS - 1;

  it("matches an old process with the remote debugging marker", () => {
    const sample: ProcessSample = {
      pid: 1,
      command: "/chrome --remote-debugging-pipe --user-data-dir=/tmp/offscript",
      startedAt: old,
    };
    expect(isOrphanedChromium(sample, now)).toBe(true);
  });

  it("matches an old process with the offscript marker", () => {
    const sample: ProcessSample = {
      pid: 2,
      command: "/cache/offscript-chrome --headless",
      startedAt: old,
    };
    expect(isOrphanedChromium(sample, now)).toBe(true);
  });

  it("does not match a fresh own process", () => {
    const sample: ProcessSample = {
      pid: 3,
      command: "chrome --remote-debugging-pipe",
      startedAt: now - 1000,
    };
    expect(isOrphanedChromium(sample, now)).toBe(false);
  });

  it("never matches an unrelated old process", () => {
    const sample: ProcessSample = {
      pid: 4,
      command: "/usr/bin/sshd -D",
      startedAt: old - 10_000,
    };
    expect(isOrphanedChromium(sample, now)).toBe(false);
  });

  it("is strict about the age boundary", () => {
    const sample: ProcessSample = {
      pid: 5,
      command: "chrome --remote-debugging-pipe",
      startedAt: now - ORPHAN_MAX_AGE_MS,
    };
    expect(isOrphanedChromium(sample, now)).toBe(false);
    expect(isOrphanedChromium({ ...sample, startedAt: old }, now)).toBe(true);
  });

  it("honours a custom max age", () => {
    const sample: ProcessSample = {
      pid: 6,
      command: "offscript-chrome",
      startedAt: now - 5000,
    };
    expect(isOrphanedChromium(sample, now, 1000)).toBe(true);
    expect(isOrphanedChromium(sample, now, 10_000)).toBe(false);
  });

  it("ignores invalid timestamps", () => {
    const sample: ProcessSample = {
      pid: 7,
      command: "chrome --remote-debugging-pipe",
      startedAt: Number.NaN,
    };
    expect(isOrphanedChromium(sample, now)).toBe(false);
  });
});

describe("listChromiumProcesses", () => {
  it("returns an empty array on exec failure", async () => {
    execFileMock.mockImplementation(
      (_f: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => {
        cb(new Error("ps unavailable"), "");
      },
    );
    await expect(listChromiumProcesses()).resolves.toEqual([]);
  });

  it("parses process listings into validated samples", async () => {
    const first = 1_700_000_000_000;
    const second = first + 60_000;
    const stdout = [
      process.platform === "win32"
        ? "PID STARTED CMD"
        : "    PID                  STARTED CMD",
      formatLine(4242, first, "chrome.exe --remote-debugging-pipe"),
      formatLine(9999, second, "system-idle-process"),
    ].join(EOL);

    output(stdout);

    const samples = await listChromiumProcesses();
    expect(samples).toHaveLength(2);
    expect(samples[0]?.pid).toBe(4242);
    expect(samples[0]?.command).toContain("--remote-debugging-pipe");
    expect(samples[0]?.startedAt).toBe(new Date(first).getTime());
    expect(samples[1]?.pid).toBe(9999);
  });
});

describe("startChromiumWatchdog", () => {
  it("reaps only orphaned own processes and can be stopped", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-11-22T12:00:00.000Z").getTime();
    vi.setSystemTime(now);

    const orphanAt = now - ORPHAN_MAX_AGE_MS - 1000;
    const freshAt = now - 1000;
    const stdout = [
      formatLine(111, orphanAt, "chrome --remote-debugging-pipe"),
      formatLine(222, freshAt, "chrome --remote-debugging-pipe"),
      formatLine(333, orphanAt, "unrelated-daemon"),
    ].join(EOL);
    output(stdout);

    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    const onReap = vi.fn();

    const stop = startChromiumWatchdog({ intervalMs: 1000, onReap });
    await vi.advanceTimersByTimeAsync(1000);

    expect(kill).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledWith(111, "SIGKILL");
    expect(onReap).toHaveBeenCalledTimes(1);
    expect(onReap.mock.calls[0]?.[0]).toMatchObject({ pid: 111 });

    stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(kill).toHaveBeenCalledTimes(1);
  });

  it("keeps running when process.kill throws", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-11-22T12:00:00.000Z").getTime();
    vi.setSystemTime(now);
    output(formatLine(444, now - ORPHAN_MAX_AGE_MS - 1000, "offscript-chrome"));

    const kill = vi.spyOn(process, "kill").mockImplementation(() => {
      throw new Error("ESRCH");
    });
    const onReap = vi.fn();

    const stop = startChromiumWatchdog({ intervalMs: 1000, onReap });
    await vi.advanceTimersByTimeAsync(1000);

    expect(kill).toHaveBeenCalledWith(444, "SIGKILL");
    expect(onReap).toHaveBeenCalledTimes(1);
    stop();
  });
});
