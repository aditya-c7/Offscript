import { existsSync } from "node:fs";
import { chromium, type Page } from "playwright";

declare global {
  var __offscriptWsCloses: WsCloseRecord[] | undefined;
}

export interface WsCloseRecord {
  url: string;
  code: number;
  reason: string;
}

/**
 * Resolve a local Chromium binary without any network access. Prefer the
 * Playwright-managed browser; fall back to a system Chrome/Edge installation.
 * No `--no-sandbox` flag is ever used.
 */
export function resolveChromiumExecutable(): string | undefined {
  const candidates: readonly string[] = [
    chromium.executablePath(),
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

/**
 * Record the close code that the *page* observes for every WebSocket it opens.
 * Playwright's WebSocket object does not expose the close code, so we wrap the
 * constructor before any page script runs.
 */
export async function installWebSocketCloseRecorder(page: Page): Promise<void> {
  await page.addInitScript(() => {
    globalThis.__offscriptWsCloses = [];
    const NativeWebSocket = globalThis.WebSocket;

    class TrackedWebSocket extends NativeWebSocket {
      constructor(...args: ConstructorParameters<typeof WebSocket>) {
        super(...args);
        this.addEventListener("close", (event) => {
          globalThis.__offscriptWsCloses?.push({
            url: this.url,
            code: event.code,
            reason: event.reason,
          });
        });
      }
    }

    globalThis.WebSocket = TrackedWebSocket;
  });
}

export async function readWebSocketCloseRecords(
  page: Page,
): Promise<WsCloseRecord[]> {
  return page.evaluate(() => globalThis.__offscriptWsCloses ?? []);
}
