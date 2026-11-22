/// <reference path="../../../node_modules/.pnpm/node_modules/@types/node/index.d.ts" />
import { Agent, buildConnector, fetch as undiciFetch } from "undici";
import { normalizeUrl } from "@offscript/shared";
import { assertSafeUrl, resolveAndValidate } from "./ssrf.js";

/** A bounded, fully-read HTTP response. */
export interface SafeFetchResponse {
  status: number;
  headers: Record<string, string>;
  text: string;
  url: string;
  contentType: string;
}

export interface SafeFetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

const MAX_REDIRECTS = 5;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_USER_AGENT = "Offscript-Agent/1.0";
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

type PinnedConnector = ReturnType<typeof buildConnector>;

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * A connector that pins the TCP connection to an SSRF-validated IP while
 * keeping the original hostname for the HTTP Host header and TLS SNI.
 */
function createPinnedConnector(): PinnedConnector {
  return buildConnector({
    timeout: DEFAULT_TIMEOUT_MS,
    lookup: (hostname: string, _options: unknown, callback) => {
      void resolveAndValidate(hostname).then(
        (ip: string) => callback(null, ip, ip.includes(":") ? 6 : 4),
        (error: unknown) => callback(toError(error), "", 4),
      );
    },
  });
}

function headerValue(
  headers: Record<string, string>,
  name: string,
): string | undefined {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) return value;
  }
  return undefined;
}

function mergedHeaders(init: SafeFetchInit): Record<string, string> {
  const result: Record<string, string> = { "user-agent": DEFAULT_USER_AGENT };
  if (init.headers !== undefined) {
    for (const [key, value] of Object.entries(init.headers)) {
      const existing = headerValue(result, key);
      if (existing !== undefined) {
        for (const oldKey of Object.keys(result)) {
          if (oldKey.toLowerCase() === key.toLowerCase()) delete result[oldKey];
        }
      }
      result[key] = value;
    }
  }
  return result;
}

async function readBoundedBody(response: { body: unknown }): Promise<string> {
  const stream: unknown = response.body;
  if (!(stream instanceof ReadableStream)) return "";
  const reader = stream.getReader();

  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done === true) break;
      const value: unknown = result.value;
      if (!(value instanceof Uint8Array)) continue;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("Response body exceeded the size limit.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function responseHeaders(response: {
  headers: { forEach(callback: (value: string, key: string) => void): void };
}): Record<string, string> {
  const result: Record<string, string> = {};
  response.headers.forEach((value: string, key: string) => {
    result[key.toLowerCase()] = value;
  });
  return result;
}

/**
 * Fetch a URL with DNS validation, IP pinning, manual redirect validation,
 * a response-size cap and a hard timeout. Network failures are thrown.
 */
export async function safeFetch(
  rawUrl: string,
  init: SafeFetchInit = {},
): Promise<SafeFetchResponse> {
  const timeoutMs = init.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const method = init.method ?? "GET";
  const headers = mergedHeaders(init);
  let currentUrl = normalizeUrl(rawUrl).href;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    // Re-validate on every hop, before following any redirect.
    const { url } = await assertSafeUrl(currentUrl);
    const agent = new Agent({ connect: createPinnedConnector() });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await undiciFetch(url, {
        method,
        headers,
        body: init.body,
        dispatcher: agent,
        redirect: "manual",
        signal: controller.signal,
      });
      const finalHeaders = responseHeaders(response);

      if (REDIRECT_STATUSES.has(response.status)) {
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (location === null || location.trim().length === 0) {
          return {
            status: response.status,
            headers: finalHeaders,
            text: "",
            url: response.url || url.href,
            contentType: finalHeaders["content-type"] ?? "",
          };
        }
        const next = new URL(location, url);
        if (next.protocol !== "http:" && next.protocol !== "https:") {
          throw new Error("Redirect to a non-HTTP scheme was blocked.");
        }
        currentUrl = next.toString();
        continue;
      }

      const text = await readBoundedBody(response);
      return {
        status: response.status,
        headers: finalHeaders,
        text,
        url: response.url || url.href,
        contentType: finalHeaders["content-type"] ?? "",
      };
    } finally {
      clearTimeout(timer);
      await agent.close();
    }
  }

  throw new Error("Too many redirects.");
}
