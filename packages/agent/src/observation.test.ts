import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "playwright";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import {
  captureObservation,
  captureScreenshots,
  computeStateToken,
  nonceTag,
} from "./observation.js";

describe("nonceTag", () => {
  it("produces matching, randomized untrusted delimiters", () => {
    const first = nonceTag("page_html");
    const second = nonceTag("page_html");

    expect(first.open.startsWith("<UNTRUSTED_PAGE_HTML_")).toBe(true);
    expect(first.close).toBe(`</${first.open.slice(1, -1)}>`);
    expect(first.open).not.toBe(second.open);
    expect(first.close).not.toBe(second.close);
  });

  it("sanitizes non-alphanumeric labels", () => {
    const tag = nonceTag("details-json");
    expect(tag.open).toMatch(/^<UNTRUSTED_DETAILS_JSON_[0-9a-f]{16}>$/);
  });
});

describe("computeStateToken", () => {
  it("is deterministic for identical text and URL", () => {
    const a = computeStateToken("hello world", "https://example.com/");
    const b = computeStateToken("hello world", "https://example.com/");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when either input changes", () => {
    const base = computeStateToken("hello", "https://example.com/");
    expect(computeStateToken("goodbye", "https://example.com/")).not.toBe(base);
    expect(computeStateToken("hello", "https://example.com/other")).not.toBe(
      base,
    );
  });
});

/* ------------------------------------------------------------------ */
/* Offline fake pages (no browser, no network)                          */
/* ------------------------------------------------------------------ */

async function sampleWebp(): Promise<Buffer> {
  return sharp({
    create: { width: 64, height: 32, channels: 3, background: "#ffffff" },
  })
    .webp()
    .toBuffer();
}

function screenshotFakePage(shot: Buffer): {
  page: Page;
  state: { styleRemoved: boolean; evaluateArgs: unknown[] };
} {
  const state = { styleRemoved: false, evaluateArgs: [] as unknown[] };
  const styleHandle = {
    evaluate: async () => {
      state.styleRemoved = true;
    },
  };
  const page = {
    addStyleTag: async () => styleHandle,
    evaluate: async (...args: unknown[]) => {
      state.evaluateArgs.push(args[1]);
      return undefined;
    },
    screenshot: async () => shot,
  } as unknown as Page;
  return { page, state };
}

function observationFakePage(bodyText: string): { page: Page } {
  const snapshot = {
    bodyText,
    headings: [{ level: 1, text: "Heading" }],
    navigation: [],
    nodes: [{ role: "heading", name: "Heading", depth: 0 }],
    targets: [
      {
        role: "link",
        name: "Docs",
        destination: "https://docs.example.com/",
        enabled: true,
      },
    ],
    omitted: [],
  };
  let evaluateCalls = 0;
  const page = {
    url: () => "https://example.com/",
    title: async () => "Example",
    evaluate: async () => {
      evaluateCalls += 1;
      return evaluateCalls === 1 ? snapshot : undefined;
    },
    locator: () => ({ boundingBox: async () => null }),
  } as unknown as Page;
  return { page };
}

describe("captureScreenshots", () => {
  const tempDirs: string[] = [];

  async function makeTempDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "offscript-shot-"));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(async () => {
    const dirs = tempDirs.splice(0);
    await Promise.all(
      dirs.map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  it("writes numbered/final WebP files under outDir/runId and returns their paths", async () => {
    const outDir = await makeTempDir();
    const runId = "run-7";
    const idx = 3;
    const shot = await sampleWebp();
    const { page, state } = screenshotFakePage(shot);

    const paths = await captureScreenshots({
      page,
      targets: [
        {
          id: "t_1",
          role: "link",
          name: "Docs",
          destination: "https://docs.example.com/",
          state: { enabled: true },
          bounds: { x: 4, y: 6, width: 40, height: 12 },
        },
      ],
      outDir,
      runId,
      idx,
    });

    const runDir = join(outDir, runId);
    expect(paths.numberedPath).toBe(join(runDir, `${idx}-numbered.webp`));
    expect(paths.finalPath).toBe(join(runDir, `${idx}-final.webp`));

    for (const path of [paths.numberedPath, paths.finalPath]) {
      const bytes = await readFile(path);
      expect((await sharp(bytes).metadata()).format).toBe("webp");
    }

    // PII mask cleanup ran in finally: the style handle was removed and the
    // overlay-clearing evaluate call happened after screenshot capture.
    expect(state.styleRemoved).toBe(true);
    expect(state.evaluateArgs.length).toBeGreaterThanOrEqual(2);
  });

  it("still writes both files when all target bounds are empty", async () => {
    const outDir = await makeTempDir();
    const shot = await sampleWebp();
    const { page } = screenshotFakePage(shot);

    const paths = await captureScreenshots({
      page,
      targets: [
        {
          id: "t_0",
          role: "button",
          name: "Go",
          destination: null,
          state: { enabled: true },
          bounds: { x: 0, y: 0, width: 0, height: 0 },
        },
      ],
      outDir,
      runId: "run-empty",
      idx: 0,
    });

    for (const path of [paths.numberedPath, paths.finalPath]) {
      const bytes = await readFile(path);
      expect((await sharp(bytes).metadata()).format).toBe("webp");
    }
  });

  it("falls back to raw bytes and still cleans up when image enhancement fails", async () => {
    const outDir = await makeTempDir();
    const bogus = Buffer.from("not-a-real-image");
    const { page, state } = screenshotFakePage(bogus);

    const paths = await captureScreenshots({
      page,
      targets: [],
      outDir,
      runId: "run-fallback",
      idx: 2,
    });

    expect((await readFile(paths.finalPath)).equals(bogus)).toBe(true);
    expect((await readFile(paths.numberedPath)).equals(bogus)).toBe(true);
    expect(state.styleRemoved).toBe(true);
  });
});

function failingObservationFakePage(): { page: Page } {
  const page = {
    url: () => "https://example.com/",
    title: async () => "Example",
    evaluate: async () => {
      throw new Error("page closed");
    },
    locator: () => ({ boundingBox: async () => null }),
  } as unknown as Page;
  return { page };
}

describe("captureObservation", () => {
  it("returns redacted, JSON-serializable observation JSON", async () => {
    const secret = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghijk";
    const { page } = observationFakePage(`Welcome ${secret} to Example`);

    const observation = await captureObservation(page);

    expect(observation.schema).toBe("offscript.observation/v2");
    expect(observation.content).not.toContain(secret);
    expect(observation.content).toContain("[REDACTED]");
    expect(() => JSON.parse(JSON.stringify(observation))).not.toThrow();
  });

  it("produces a non-empty observation with distinct tokens when DOM capture fails", async () => {
    const { page } = failingObservationFakePage();

    const first = await captureObservation(page);
    const second = await captureObservation(page);

    expect(first.content.length).toBeGreaterThan(0);
    expect(first.headings.length).toBeGreaterThan(0);
    expect(first.nodes.length).toBeGreaterThan(0);
    expect(first.errors.some((err) => err.includes("page closed"))).toBe(true);
    expect(first.state_token).not.toBe(second.state_token);
    expect(() => JSON.parse(JSON.stringify(first))).not.toThrow();
  });
});
