import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  chromium,
  type Browser,
  type Request,
  type WebSocket,
} from "playwright";
import { AgentActionSchema } from "@offscript/shared";
import {
  assertActionAllowed,
  createReadOnlyContext,
  nonceTag,
  redactText,
} from "@offscript/agent";
import {
  startFixtureServers,
  type FixtureServers,
} from "./helpers/fixtures.js";
import {
  installWebSocketCloseRecorder,
  readWebSocketCloseRecords,
  resolveChromiumExecutable,
  type WsCloseRecord,
} from "./helpers/browser.js";

const TRAP_URL = "http://127.0.0.1:4105/";
const CLOAK_URL = "http://127.0.0.1:4103/";
const GOLD_ORIGIN = "http://127.0.0.1:4101";

const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

let servers: FixtureServers | undefined;
let browser: Browser | undefined;

function getBrowser(): Browser {
  if (browser === undefined) {
    throw new Error("Chromium was not launched");
  }
  return browser;
}

beforeAll(async () => {
  servers = await startFixtureServers();
  browser = await chromium.launch({
    headless: true,
    executablePath: resolveChromiumExecutable(),
  });
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await servers?.stop();
}, 60_000);

describe("05 prompt-injection mutation trap — read-only contract", () => {
  it("never emits unsafe requests, closes injected WebSockets, and rejects sensitive actions", async () => {
    const readOnly = await createReadOnlyContext(getBrowser());
    const context = readOnly.context;

    const requests: Array<{ method: string; url: string }> = [];
    const sockets: WebSocket[] = [];

    try {
      const page = await context.newPage();
      // Playwright 1.65 types expose the websocket event on Page (not on
      // BrowserContext), so observe sockets through the page here.
      page.on("websocket", (socket: WebSocket) => {
        sockets.push(socket);
      });
      page.on("request", (request: Request) => {
        requests.push({
          method: request.method().toUpperCase(),
          url: request.url(),
        });
      });
      await installWebSocketCloseRecorder(page);

      await page.goto(TRAP_URL, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(500);

      // 1. No state-changing HTTP methods ever leave the browser.
      const unsafeMethods = requests.filter(({ method }) =>
        ["PUT", "PATCH", "DELETE", "TRACE"].includes(method),
      );
      expect(unsafeMethods, "no PUT/PATCH/DELETE/TRACE requests").toEqual([]);

      // 2. No POST to the trap's charge/pay endpoints.
      const mutationPosts = requests.filter(({ method, url }) => {
        if (method !== "POST") return false;
        const path = new URL(url).pathname;
        return (
          path === "/charge" ||
          path === "/pay" ||
          path.startsWith("/charge/") ||
          path.startsWith("/pay/")
        );
      });
      expect(mutationPosts, "no POST to /charge or /pay").toEqual([]);

      // 3. Any WebSocket created by the injected script is closed with 1008
      //    (or never opens at all).
      let closeRecords: WsCloseRecord[] = await readWebSocketCloseRecords(page);
      for (
        let attempt = 0;
        attempt < 20 && closeRecords.length === 0;
        attempt += 1
      ) {
        await page.waitForTimeout(50);
        closeRecords = await readWebSocketCloseRecords(page);
      }
      expect(
        closeRecords.every((record) => record.code === 1008),
        `every observed WebSocket close uses code 1008 (got ${JSON.stringify(closeRecords)})`,
      ).toBe(true);
      expect(
        sockets.every((socket) => socket.isClosed()),
        "no WebSocket is left open",
      ).toBe(true);
      expect(
        readOnly.events.some(
          (event) => event.rule === "websocket_blocked" && event.blocked,
        ),
        "the read-only policy recorded the blocked WebSocket",
      ).toBe(true);

      // 4. Typing into the injected password field is refused.
      expect(
        assertActionAllowed(
          AgentActionSchema.parse({
            kind: "type",
            target_id: "x",
            value: "pw",
            reasoning: "r",
          }),
          {
            role: "textbox",
            name: "password",
            destination: null,
            inputType: "password",
            autocomplete: "current-password",
          },
        ).allowed,
      ).toBe(false);

      // 5. Clicking the injected "Buy Now" control is refused.
      expect(
        assertActionAllowed(
          AgentActionSchema.parse({
            kind: "click",
            target_id: "x",
            reasoning: "r",
          }),
          { role: "button", name: "Buy Now", destination: null },
        ).allowed,
      ).toBe(false);

      // 6. A harmless navigation target remains allowed.
      expect(
        assertActionAllowed(
          AgentActionSchema.parse({
            kind: "click",
            target_id: "x",
            reasoning: "r",
          }),
          { role: "link", name: "About", destination: "/about" },
        ).allowed,
      ).toBe(true);
    } finally {
      await context.close();
    }
  });
});

describe("03 cloaking / bot block", () => {
  it("serves 403 to the Offscript agent and 200 to a Chrome user agent", async () => {
    const agentResponse = await fetch(CLOAK_URL, {
      headers: { "User-Agent": "Offscript-Agent/1.0" },
    });
    expect(agentResponse.status).toBe(403);
    await agentResponse.body?.cancel().catch(() => {});

    const humanResponse = await fetch(CLOAK_URL, {
      headers: { "User-Agent": CHROME_UA },
    });
    expect(humanResponse.status).toBe(200);
    await humanResponse.body?.cancel().catch(() => {});
  });
});

describe("01 gold standard SSR discovery surfaces", () => {
  it("exposes llms.txt, the agent card and the OpenAPI document", async () => {
    for (const path of [
      "/llms.txt",
      "/.well-known/agent-card.json",
      "/openapi.json",
    ]) {
      const response = await fetch(`${GOLD_ORIGIN}${path}`);
      expect(response.status, path).toBe(200);
      await response.body?.cancel().catch(() => {});
    }
  });

  it("returns 404 for an unknown path", async () => {
    const response = await fetch(`${GOLD_ORIGIN}/__nonexistent-xyz`);
    expect(response.status).toBe(404);
    await response.body?.cancel().catch(() => {});
  });

  it("negotiates markdown using the Accept header", async () => {
    const response = await fetch(`${GOLD_ORIGIN}/`, {
      headers: { Accept: "text/markdown" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type") ?? "").toContain(
      "text/markdown",
    );
    expect(response.headers.get("vary") ?? "").toMatch(/accept/i);
    await response.body?.cancel().catch(() => {});
  });
});

describe("PII redaction and untrusted-content delimiters", () => {
  it("redacts a bearer JWT and a Groq-style API key", () => {
    // The "..." in the shorthand token denotes an elided JWT; a full
    // three-part token is used so the secret shape is actually exercised.
    const jwtResult = redactText(
      "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
    );
    expect(jwtResult.count).toBeGreaterThanOrEqual(1);
    expect(jwtResult.text).toContain("[REDACTED]");
    expect(jwtResult.text).not.toContain("eyJhbGciOi");

    const keyResult = redactText("gsk_secretkey1234567890");
    expect(keyResult.count).toBeGreaterThanOrEqual(1);
    expect(keyResult.text).toContain("[REDACTED]");
  });

  it("generates a different delimiter on every nonceTag call", () => {
    const first = nonceTag("X");
    const second = nonceTag("X");
    expect(first.open).not.toBe(second.open);
    expect(first.close).not.toBe(second.close);
    expect(first.open).toMatch(/^<UNTRUSTED_X_[0-9a-f]+>$/);
    expect(first.close).toBe(`</${first.open.slice(1, -1)}>`);
  });
});
