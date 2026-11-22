import { createServer, type Server } from "node:http";
import { z } from "zod";

export interface TargetServer {
  readonly url: string;
  stop(): Promise<void>;
}

const PortSchema = z.object({ port: z.number().int().min(1).max(65535) });

const HOME = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Offscript integration target</title>
<meta name="description" content="Deterministic offline scan target.">
<link rel="canonical" href="/">
<link rel="sitemap" type="application/xml" href="/sitemap.xml">
</head><body>
<header><a href="/">Integration Target</a><nav>
<a href="/about">About</a><a href="/pricing">Pricing</a><a href="/contact">Contact</a>
</nav></header>
<main><h1>Integration target for the web to worker path</h1>
<p>A small deterministic page used only by the local integration suite.</p>
<button type="button" aria-label="Get started">Get started</button>
</main><footer>Integration Target</footer></body></html>`;

const ROBOTS =
  "User-agent: *\nAllow: /\nSitemap: http://localhost/sitemap.xml\n";
const SITEMAP =
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
  "<url><loc>http://localhost/</loc></url>" +
  "<url><loc>http://localhost/about</loc></url></urlset>";
const LLMS = "# Integration Target\n\nA deterministic offline page.\n";

/**
 * Disposable, offline target on an ephemeral loopback port. No external site
 * is scanned and no fixed port is shared with the e2e suite.
 */
export async function startTargetServer(): Promise<TargetServer> {
  const server: Server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0] ?? "/";
    if (path === "/robots.txt") {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end(ROBOTS);
      return;
    }
    if (path === "/sitemap.xml") {
      res.writeHead(200, { "content-type": "application/xml; charset=utf-8" });
      res.end(SITEMAP);
      return;
    }
    if (path === "/llms.txt") {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end(LLMS);
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(HOME);
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => resolveListen());
  });

  const parsed = PortSchema.safeParse(server.address());
  if (!parsed.success) {
    server.close();
    throw new Error("Target server has no usable TCP address");
  }

  return {
    url: `http://127.0.0.1:${parsed.data.port}/`,
    stop: async () => {
      await new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => (error ? rejectClose(error) : resolveClose()));
      });
    },
  };
}
