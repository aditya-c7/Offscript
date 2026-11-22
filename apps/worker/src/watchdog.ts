import { execFile } from "node:child_process";

/** How often the watchdog scans for orphaned Chromium processes. */
export const WATCHDOG_INTERVAL_MS = 15 * 60 * 1000;

/** A Chromium process older than this (with one of our markers) is an orphan. */
export const ORPHAN_MAX_AGE_MS = 6 * 60 * 1000;

export interface ProcessSample {
  pid: number;
  command: string;
  startedAt: number;
}

/** Markers that identify a Chromium instance launched by Offscript itself. */
const OWN_PROCESS_MARKERS: readonly string[] = [
  "--remote-debugging-pipe",
  "offscript-",
];

/**
 * Pure predicate. Returns true only when the command looks like one of our own
 * Chromium instances AND the process is older than `maxAgeMs`. Any process
 * without one of our markers is never considered an orphan.
 */
export function isOrphanedChromium(
  sample: ProcessSample,
  now: number,
  maxAgeMs: number = ORPHAN_MAX_AGE_MS,
): boolean {
  const looksLikeOurs = OWN_PROCESS_MARKERS.some((marker) =>
    sample.command.includes(marker),
  );
  if (!looksLikeOurs) return false;
  const ageMs = now - sample.startedAt;
  if (!Number.isFinite(ageMs)) return false;
  return ageMs > maxAgeMs;
}

// `lstart` renders `Www Mmm dd HH:mm:ss yyyy`. The weekday is deliberately
// non-capturing so groups 1-6 map directly onto parsePosixLine below.
const POSIX_LINE_RE =
  /^\s*(\d+)\s+[A-Za-z]{3}\s+([A-Za-z]{3})\s+(\d{1,2})\s+(\d{2}:\d{2}:\d{2})\s+(\d{4})\s+(.+)$/;

function parsePosixLine(line: string): ProcessSample | null {
  const match = POSIX_LINE_RE.exec(line);
  if (!match) return null;
  const pidRaw = match[1];
  const month = match[2];
  const dayRaw = match[3];
  const time = match[4];
  const yearRaw = match[5];
  const command = match[6];
  if (
    pidRaw === undefined ||
    month === undefined ||
    dayRaw === undefined ||
    time === undefined ||
    yearRaw === undefined ||
    command === undefined
  ) {
    return null;
  }
  const pid = Number(pidRaw);
  const day = Number(dayRaw);
  const year = Number(yearRaw);
  if (!Number.isInteger(pid) || pid <= 0) return null;
  if (!Number.isInteger(day) || !Number.isInteger(year)) return null;
  const startedAt = new Date(`${month} ${day} ${time} ${year}`).getTime();
  if (!Number.isFinite(startedAt)) return null;
  return { pid, command, startedAt };
}

/** Control character used to delimit PowerShell CIM fields (never in a path). */
const FIELD_SEP = "\u0001";

function parseDateValue(raw: string): number {
  const direct = new Date(raw).getTime();
  if (Number.isFinite(direct)) return direct;
  // CIM "o" format can carry 7 fractional digits; V8 expects at most 3.
  const normalized = raw.replace(/\.(\d{3})\d+/, ".$1");
  return new Date(normalized).getTime();
}

function parseWindowsLine(line: string): ProcessSample | null {
  const parts = line.split(FIELD_SEP);
  const pidRaw = parts[0];
  const dateRaw = parts[1];
  if (pidRaw === undefined || dateRaw === undefined) return null;
  const pid = Number(pidRaw);
  if (!Number.isInteger(pid) || pid <= 0) return null;
  const startedAt = parseDateValue(dateRaw);
  if (!Number.isFinite(startedAt)) return null;
  const command = parts.slice(2).join(FIELD_SEP);
  return { pid, command, startedAt };
}

const WINDOWS_PS_SCRIPT = [
  "$sep=[char]1;",
  "Get-CimInstance Win32_Process | ForEach-Object {",
  "$cl=$_.CommandLine; if($null -eq $cl){$cl=''};",
  "$cl=$cl -replace '[\\r\\n]',' ';",
  "\"$($_.ProcessId)$sep$($_.CreationDate.ToString('o'))$sep$cl\"",
  "}",
].join(" ");

/**
 * Best-effort snapshot of running processes. Uses `execFile` with an argument
 * array (no shell), returns [] on any failure. Only our own markers are
 * relevant downstream; unrelated processes are harmless and simply ignored.
 */
export function listChromiumProcesses(): Promise<ProcessSample[]> {
  return new Promise<ProcessSample[]>((resolve) => {
    const isWindows = process.platform === "win32";
    const file = isWindows ? "powershell.exe" : "ps";
    const args = isWindows
      ? ["-NoProfile", "-Command", WINDOWS_PS_SCRIPT]
      : ["-eo", "pid,lstart,args"];
    const parse = isWindows ? parseWindowsLine : parsePosixLine;
    try {
      execFile(
        file,
        args,
        { timeout: 5000, maxBuffer: 8 * 1024 * 1024 },
        (error, stdout) => {
          if (error || typeof stdout !== "string") {
            resolve([]);
            return;
          }
          const samples: ProcessSample[] = [];
          for (const line of stdout.split(/\r?\n/)) {
            const sample = parse(line);
            if (sample) samples.push(sample);
          }
          resolve(samples);
        },
      );
    } catch {
      resolve([]);
    }
  });
}

/**
 * Starts a periodic reaper. Returns a function that stops it. Overlapping
 * ticks are skipped so a slow `ps` cannot spawn concurrent scans.
 */
export function startChromiumWatchdog(opts?: {
  intervalMs?: number;
  maxAgeMs?: number;
  onReap?: (sample: ProcessSample) => void;
}): () => void {
  const intervalMs = opts?.intervalMs ?? WATCHDOG_INTERVAL_MS;
  const maxAgeMs = opts?.maxAgeMs ?? ORPHAN_MAX_AGE_MS;
  const onReap = opts?.onReap;
  let running = false;

  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const samples = await listChromiumProcesses();
      const now = Date.now();
      for (const sample of samples) {
        if (!isOrphanedChromium(sample, now, maxAgeMs)) continue;
        try {
          process.kill(sample.pid, "SIGKILL");
        } catch {
          // Already exited or not permitted; nothing further to do.
        }
        onReap?.(sample);
      }
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, intervalMs);

  return () => {
    clearInterval(timer);
  };
}
