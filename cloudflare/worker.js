/**
 * Offscript edge worker.
 *
 * - When ORIGIN_URL is configured, act as a transparent read-through proxy:
 *   the incoming method, path and query string are forwarded to the origin and
 *   the upstream response is returned unchanged.
 * - When ORIGIN_URL is not configured, serve a small standby status page.
 *
 * This file is intentionally framework-free and dependency-free so it runs
 * directly on the Cloudflare Workers runtime with no build step.
 */

const GITHUB_REPO_URL = "https://github.com/aditya-c7/Offscript";

/** @typedef {{ ORIGIN_URL?: string }} Env */

/**
 * @param {Request} request
 * @param {Env} env
 * @returns {Promise<Response>}
 */
export default {
  async fetch(request, env) {
    const rawOrigin =
      typeof env?.ORIGIN_URL === "string" ? env.ORIGIN_URL.trim() : "";

    if (!rawOrigin) {
      return standbyPage();
    }

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
