/**
 * Offscript edge worker.
 *
 * Routing order:
 *   1. ORIGIN_URL set  -> transparent read-through proxy (explicit escape hatch).
 *   2. WEB_CONTAINER binding present -> forward to the Next.js app running in a
 *      Cloudflare Container, managed by the `WebContainer` Durable Object.
 *   3. No binding (local dry runs without container support) -> standby page.
 *
 * This file is intentionally framework-free and dependency-free so it runs
 * directly on the Cloudflare Workers runtime with no build step.
 */

import { DurableObject } from "cloudflare:workers";

const GITHUB_REPO_URL = "https://github.com/aditya-c7/Offscript";

const PORT = 3000;
const CONTAINER_NAME = "offscript-web";
const WORKER_CONTAINER_NAME = "offscript-worker";
/** 1/2 vCPU, 4 GiB RAM, 8 GB disk — the smallest size that comfortably runs Next.js. */
const INSTANCE_TYPE = "standard-1";
const INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000;
/** Cloudflare Containers caps setInactivityTimeout at 6 hours; keep the worker warm as long as allowed. */
const WORKER_INACTIVITY_TIMEOUT_MS = 6 * 60 * 60 * 1000;
const READY_ATTEMPTS = 100;
const READY_INTERVAL_MS = 200;
const READY_PROBE_TIMEOUT_MS = 1000;

/**
 * @typedef {object} Env
 * @property {string} [ORIGIN_URL]
 * @property {{ getByName: (name: string) => { fetch: (request: Request) => Promise<Response> } }} [WEB_CONTAINER]
 * @property {{ getByName: (name: string) => { fetch: (request: Request) => Promise<Response> } }} [WORKER_CONTAINER]
 * @property {string} [DATABASE_URL]
 * @property {string} [NVIDIA_API_KEY]
 * @property {string} [GROQ_API_KEY]
 * @property {string} [GEMINI_API_KEY]
 * @property {string} [OPENROUTER_API_KEY]
 * @property {string} [OPENAI_API_KEY]
 * @property {string} [LLM_PROVIDER]
 * @property {string} [LLM_MODEL_FAST]
 * @property {string} [LLM_MODEL_AGENT]
 * @property {string} [LLM_MODEL_VISION]
 * @property {string} [NEXT_PUBLIC_SITE_URL]
 */

/**
 * Owns one container instance. The Durable Object starts the container on the
 * first request, waits for the app to answer its health probe, and then
 * forwards traffic over the container's TCP port.
 */
export class WebContainer extends DurableObject {
  /** @type {Promise<void> | undefined} */
  starting;
  /** @type {Promise<void> | undefined} */
  monitoring;

  /** @param {*} ctx @param {Env} env */
  constructor(ctx, env) {
    super(ctx, env);
    const container = ctx.container;
    if (container?.running) {
      // A Durable Object restart does not reset the platform inactivity timer.
      void ctx.blockConcurrencyWhile(() =>
        container
          .setInactivityTimeout(INACTIVITY_TIMEOUT_MS)
          .catch(() => undefined),
      );
      this.observeExit();
    }
  }

  /** @param {Request} request @returns {Promise<Response>} */
  async fetch(request) {
    const container = this.ctx.container;
    if (!container) {
      return plainResponse("No container is configured for WebContainer.", 500);
    }

    // Share startup across concurrent requests, including after a failed attempt.
    this.starting ??= this.startAndWaitForPort().finally(() => {
      this.starting = undefined;
    });
    await this.starting;

    const incoming = new URL(request.url);
    const target = new URL("http://container");
    target.pathname = incoming.pathname;
    target.search = incoming.search;

    const headers = new Headers(request.headers);
    headers.delete("host");
    for (const name of Array.from(headers.keys())) {
      if (name.startsWith("cf-")) {
        headers.delete(name);
      }
    }

    const method = request.method.toUpperCase();
    const body = method === "GET" || method === "HEAD" ? null : request.body;

    try {
      return await container.getTcpPort(PORT).fetch(target.toString(), {
        method,
        headers,
        body,
        redirect: "manual",
      });
    } catch {
      return plainResponse(
        "Bad Gateway: the application container could not be reached.",
        502,
      );
    }
  }

  /** @returns {Promise<void>} */
  async startAndWaitForPort() {
    const container = this.ctx.container;
    if (!container) {
      throw new Error("No container is configured for WebContainer.");
    }

    if (!container.running) {
      container.start({
        image: container.images.base,
        instance: INSTANCE_TYPE,
        // The app calls LLM and Postgres endpoints, so outbound access is required.
        enableInternet: true,
        env: this.containerEnv(),
      });
    }

    this.observeExit();

    try {
      await container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS);
    } catch {
      // The container still serves traffic; it just will not be kept warm.
    }

    // `running` means startup was requested, not that the app is listening.
    const port = container.getTcpPort(PORT);
    for (let attempt = 0; attempt < READY_ATTEMPTS; attempt++) {
      try {
        const response = await port.fetch("http://container/api/health", {
          signal: AbortSignal.timeout(READY_PROBE_TIMEOUT_MS),
        });
        await response.body?.cancel();
        if (response.ok) {
          return;
        }
      } catch {
        // The port may not be listening yet; retry only the readiness probe.
      }
      await scheduler.wait(READY_INTERVAL_MS);
    }
    throw new Error(`Container did not become ready on port ${PORT}`);
  }

  /**
   * Build the environment passed to the container. Values are forwarded to the
   * app process only and are never logged or included in a response.
   * @returns {Record<string, string>}
   */
  containerEnv() {
    const env = this.env ?? {};
    const values = {
      DATABASE_URL: env.DATABASE_URL,
      NVIDIA_API_KEY: env.NVIDIA_API_KEY,
      GROQ_API_KEY: env.GROQ_API_KEY,
      GEMINI_API_KEY: env.GEMINI_API_KEY,
      OPENROUTER_API_KEY: env.OPENROUTER_API_KEY,
      OPENAI_API_KEY: env.OPENAI_API_KEY,
      LLM_PROVIDER: env.LLM_PROVIDER ?? "nvidia",
      LLM_MODEL_FAST: env.LLM_MODEL_FAST,
      LLM_MODEL_AGENT: env.LLM_MODEL_AGENT,
      LLM_MODEL_VISION: env.LLM_MODEL_VISION,
      NEXT_PUBLIC_SITE_URL:
        env.NEXT_PUBLIC_SITE_URL ?? "https://offscript.adityahq.me",
    };

    /** @type {Record<string, string>} */
    const result = {};
    for (const [key, value] of Object.entries(values)) {
      if (typeof value === "string" && value.length > 0) {
        result[key] = value;
      }
    }
    return result;
  }

  /** @returns {void} */
  observeExit() {
    if (this.monitoring) {
      return;
    }
    const container = this.ctx.container;
    if (!container || !container.running) {
      return;
    }
    this.monitoring = container
      .monitor()
      .then(() => undefined)
      .catch(() => {
        // Do not log the error object: it can include startup environment values.
        console.error("WebContainer process exited with an error.");
      })
      .finally(() => {
        this.monitoring = undefined;
      });
    this.ctx.waitUntil(this.monitoring);
  }
}

/**
 * Owns the long-lived background worker container. Unlike WebContainer there
 * is no HTTP server inside this image: a request to the Durable Object simply
 * guarantees the container is started and returns a small acknowledgement.
 */
export class WorkerContainer extends DurableObject {
  /** @type {Promise<void> | undefined} */
  starting;

  /** @param {*} ctx @param {Env} env */
  constructor(ctx, env) {
    super(ctx, env);
    const container = ctx.container;
    if (container?.running) {
      // A Durable Object restart does not reset the platform inactivity timer.
      void ctx.blockConcurrencyWhile(() =>
        container
          .setInactivityTimeout(WORKER_INACTIVITY_TIMEOUT_MS)
          .catch(() => undefined),
      );
      this.observeExit();
    }
  }

  /** @param {Request} request @returns {Promise<Response>} */
  async fetch(request) {
    const container = this.ctx.container;
    if (!container) {
      return plainResponse(
        "No container is configured for WorkerContainer.",
        500,
      );
    }

    // Share startup across concurrent requests, including after a failed attempt.
    this.starting ??= this.start().finally(() => {
      this.starting = undefined;
    });
    try {
      await this.starting;
    } catch {
      return plainResponse("The worker container could not be started.", 502);
    }

    return plainResponse("worker container running", 200);
  }

  /** @returns {Promise<void>} */
  async start() {
    const container = this.ctx.container;
    if (!container) {
      throw new Error("No container is configured for WorkerContainer.");
    }

    if (!container.running) {
      container.start({
        image: container.images.worker,
        instance: INSTANCE_TYPE,
        // The worker calls LLM and Postgres endpoints, so outbound access is required.
        enableInternet: true,
        env: this.containerEnv(),
      });
    }

    this.observeExit();

    try {
      await container.setInactivityTimeout(WORKER_INACTIVITY_TIMEOUT_MS);
    } catch {
      // The container still runs; it just will not be kept warm.
    }
  }

  /**
   * Build the environment passed to the worker container. Values are forwarded
   * to the process only and are never logged or included in a response.
   * @returns {Record<string, string>}
   */
  containerEnv() {
    const env = this.env ?? {};
    const values = {
      DATABASE_URL: env.DATABASE_URL,
      NVIDIA_API_KEY: env.NVIDIA_API_KEY,
      GROQ_API_KEY: env.GROQ_API_KEY,
      GEMINI_API_KEY: env.GEMINI_API_KEY,
      OPENROUTER_API_KEY: env.OPENROUTER_API_KEY,
      OPENAI_API_KEY: env.OPENAI_API_KEY,
      LLM_PROVIDER: env.LLM_PROVIDER ?? "nvidia",
      LLM_MODEL_FAST: env.LLM_MODEL_FAST,
      LLM_MODEL_AGENT: env.LLM_MODEL_AGENT,
      LLM_MODEL_VISION: env.LLM_MODEL_VISION,
      STORAGE_DIR: "/app/storage",
    };

    /** @type {Record<string, string>} */
    const result = {};
    for (const [key, value] of Object.entries(values)) {
      if (typeof value === "string" && value.length > 0) {
        result[key] = value;
      }
    }
    return result;
  }

  /** @returns {void} */
  observeExit() {
    const container = this.ctx.container;
    if (!container || !container.running) {
      return;
    }
    // Keep the monitor alive for the lifetime of the Durable Object without
    // logging the rejection, which can include startup environment values.
    this.ctx.waitUntil(container.monitor().catch(() => undefined));
  }
}

export default {
  /** @param {Request} request @param {Env} env @returns {Promise<Response>} */
  async fetch(request, env) {
    // Internal control route: explicitly start the long-lived worker container.
    // Everything else still goes through the ORIGIN_URL escape hatch / WEB_CONTAINER.
    if (request.method.toUpperCase() === "GET") {
      let pathname = "";
      try {
        pathname = new URL(request.url).pathname;
      } catch {
        // Fall through to normal routing for malformed URLs.
      }
      if (pathname === "/_internal/worker/start") {
        const workerBinding = env?.WORKER_CONTAINER;
        if (!workerBinding || typeof workerBinding.getByName !== "function") {
          return plainResponse("Worker container is not configured.", 503);
        }
        try {
          return await workerBinding
            .getByName(WORKER_CONTAINER_NAME)
            .fetch(request);
        } catch {
          return plainResponse(
            "Bad Gateway: the worker container is unavailable.",
            502,
          );
        }
      }
    }

    const rawOrigin =
      typeof env?.ORIGIN_URL === "string" ? env.ORIGIN_URL.trim() : "";

    if (rawOrigin) {
      let origin;
      try {
        origin = new URL(rawOrigin);
      } catch {
        return plainResponse(
          "Misconfigured ORIGIN_URL: expected an absolute URL.",
          500,
        );
      }

      if (origin.protocol !== "http:" && origin.protocol !== "https:") {
        return plainResponse(
          "Misconfigured ORIGIN_URL: expected an http(s) URL.",
          500,
        );
      }

      return proxyToOrigin(request, origin);
    }

    const binding = env?.WEB_CONTAINER;
    if (binding && typeof binding.getByName === "function") {
      try {
        return await binding.getByName(CONTAINER_NAME).fetch(request);
      } catch {
        return plainResponse(
          "Bad Gateway: the application container is unavailable.",
          502,
        );
      }
    }

    return standbyPage();
  },
};

/**
 * Forward the request to the configured origin, preserving method, path and query.
 * @param {Request} request
 * @param {URL} origin
 * @returns {Promise<Response>}
 */
async function proxyToOrigin(request, origin) {
  const incoming = new URL(request.url);
  const basePath = origin.pathname.replace(/\/+$/, "");

  const target = new URL(origin.origin);
  target.pathname = basePath + incoming.pathname;
  target.search = incoming.search;

  const headers = new Headers(request.headers);
  headers.delete("host");
  for (const name of Array.from(headers.keys())) {
    if (name.startsWith("cf-")) {
      headers.delete(name);
    }
  }

  const method = request.method.toUpperCase();
  const body = method === "GET" || method === "HEAD" ? null : request.body;

  try {
    return await fetch(target.toString(), {
      method,
      headers,
      body,
      redirect: "manual",
    });
  } catch {
    return plainResponse(
      "Bad Gateway: the configured origin could not be reached.",
      502,
    );
  }
}

/**
 * @param {string} message
 * @param {number} status
 * @returns {Response}
 */
function plainResponse(message, status) {
  return new Response(`${message}\n`, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

/**
 * @returns {Response}
 */
function standbyPage() {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Offscript</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    display: grid;
    place-items: center;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    background: #0b0f19;
    color: #e6e9f0;
  }
  main {
    width: min(34rem, calc(100% - 2rem));
    padding: 2.5rem;
    border: 1px solid #242b3d;
    border-radius: 1rem;
    background: #121826;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.35);
  }
  h1 { margin: 0 0 .25rem; font-size: 1.75rem; letter-spacing: -0.02em; }
  .tag { margin: 0 0 1.5rem; color: #8b93a7; font-size: .95rem; }
  .status {
    display: inline-flex; align-items: center; gap: .5rem;
    margin: 0 0 1.5rem; padding: .5rem .75rem;
    border: 1px solid #1f6f4a; border-radius: 999px;
    background: #10261d; color: #7ee2b8; font-size: .875rem;
  }
  .dot { width: .5rem; height: .5rem; border-radius: 50%; background: #34d399; }
  a { color: #8ab4ff; text-decoration: none; }
  a:hover { text-decoration: underline; }
</style>
</head>
<body>
  <main>
    <h1>Offscript</h1>
    <p class="tag">Automated, read-only website auditing.</p>
    <p class="status"><span class="dot"></span> Operational — edge worker is live in standby mode.</p>
    <p><a href="${GITHUB_REPO_URL}">View the source on GitHub →</a></p>
  </main>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
