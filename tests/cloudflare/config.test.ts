import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), "utf8");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Bodies of every TOML table or array-of-tables matching the exact header. */
function sections(source: string, header: string): string[] {
  const target = header.trim();
  const found: string[] = [];
  let current: string[] | undefined;

  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (/^\[{1,2}[A-Za-z0-9_.-]+\]{1,2}$/.test(trimmed)) {
      if (current) found.push(current.join("\n"));
      current = trimmed === target ? [] : undefined;
    } else if (current) {
      current.push(line);
    }
  }
  if (current) found.push(current.join("\n"));

  return found;
}

function tomlStringValue(body: string, key: string): string | undefined {
  const pattern = new RegExp(
    `^\\s*${escapeRegExp(key)}\\s*=\\s*["']([^"']+)["']`,
    "m",
  );
  return body.match(pattern)?.[1];
}

/** Comment lines may document that a flag is banned; only instructions count. */
function withoutDockerComments(source: string): string {
  return source
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
}

function exportedClassNames(source: string): string[] {
  const names: string[] = [];
  for (const match of source.matchAll(/export\s+class\s+([A-Za-z_$][\w$]*)/g)) {
    const name = match[1];
    if (name) names.push(name);
  }
  return names;
}

describe("wrangler.toml contract", () => {
  const wrangler = readRepoFile("wrangler.toml");
  const worker = readRepoFile("cloudflare/worker.js");

  it("names the worker and declares an explicit, existing main entry", () => {
    expect(wrangler).toMatch(/^\s*name\s*=\s*"offscript"\s*$/m);
    const main = tomlStringValue(wrangler, "main");
    expect(main, "wrangler.toml must set an explicit main").toBeTruthy();
    const mainPath = main ?? "";
    expect(mainPath).toMatch(/^[\w./-]+\.m?js$/);
    expect(existsSync(resolve(repoRoot, mainPath))).toBe(true);
  });

  it("binds a container whose class_name matches the WebContainer export and sets an image", () => {
    const webContainer = exportedClassNames(worker).find(
      (name) => name === "WebContainer",
    );
    expect(webContainer, "worker.js must export class WebContainer").toBe(
      "WebContainer",
    );

    const containers = sections(wrangler, "[[containers]]");
    expect(
      containers.length,
      "wrangler.toml must declare [[containers]]",
    ).toBeGreaterThan(0);
    const matching = containers.find(
      (body) => tomlStringValue(body, "class_name") === webContainer,
    );
    expect(
      matching,
      'a [[containers]] entry must set class_name = "WebContainer"',
    ).toBeDefined();
    // Wrangler's current durable_object policy declares the image as
    // [containers.images.base].dockerfile; older configs use a direct
    // `image` key on [[containers]]. Accept either form, but require a real
    // image source that resolves to a file on disk.
    const inlineImage = tomlStringValue(matching ?? "", "image");
    const imageBase = sections(wrangler, "[containers.images.base]")[0] ?? "";
    const dockerfilePath = tomlStringValue(imageBase, "dockerfile");
    const declaredImage = inlineImage ?? dockerfilePath;
    expect(
      declaredImage,
      "the container entry must declare an image (image or containers.images.base.dockerfile)",
    ).toBeTruthy();
    expect(
      existsSync(resolve(repoRoot, declaredImage ?? "")),
      "the declared container image/dockerfile must exist in the repo",
    ).toBe(true);
  });

  it("binds the WEB_CONTAINER durable object and exports it as a durable object", () => {
    const bindings = sections(wrangler, "[[durable_objects.bindings]]");
    expect(
      bindings.some(
        (body) => tomlStringValue(body, "name") === "WEB_CONTAINER",
      ),
      "wrangler.toml must bind WEB_CONTAINER in [[durable_objects.bindings]]",
    ).toBe(true);

    const exportsSection = sections(wrangler, "[exports.WebContainer]");
    expect(
      exportsSection.length,
      "wrangler.toml must declare [exports.WebContainer]",
    ).toBeGreaterThan(0);
    expect(tomlStringValue(exportsSection[0] ?? "", "type")).toBe(
      "durable-object",
    );
  });
});

describe("cloudflare/worker.js contract", () => {
  const worker = readRepoFile("cloudflare/worker.js");

  it("allows ORIGIN_URL only as an env-provided escape hatch, never as a hardcoded secret fallback", () => {
    // ORIGIN_URL is an opt-in proxy override read from the env binding. What is
    // forbidden is baking a URL/credential into source as a fallback value.
    expect(worker).not.toMatch(/\bORIGIN_URL\s*[:=]\s*["'`]/);
    expect(worker).not.toMatch(/\bORIGIN_URL\s*\?\?\s*["'`]/);
    expect(worker).not.toMatch(/\bORIGIN_URL\s*\|\|\s*["'`]/);
    expect(worker).not.toMatch(/https?:\/\/[^\s"'`]*:[^\s"'`]*@/);
  });

  it("contains no hardcoded IP addresses", () => {
    expect(worker).not.toMatch(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
  });

  it("has no vercel or netlify references", () => {
    expect(worker).not.toMatch(/vercel|netlify/i);
  });

  it("polls /api/health for readiness and uses getTcpPort", () => {
    expect(worker).toMatch(/\/api\/health/);
    expect(worker).toMatch(/\bgetTcpPort\b/);
  });
});

describe("container image Dockerfiles", () => {
  it("root Dockerfile binds all interfaces on port 3000 as a non-root user without disabling the sandbox", () => {
    const dockerfile = readRepoFile("Dockerfile");
    expect(dockerfile).toMatch(/^\s*USER\s+\S+/m);
    expect(dockerfile).toMatch(/\b0\.0\.0\.0\b/);
    expect(dockerfile).toMatch(/\b3000\b/);
    expect(withoutDockerComments(dockerfile)).not.toMatch(/--no-sandbox/);
  });

  it("Dockerfile.worker, when present, never disables the sandbox", () => {
    const path = resolve(repoRoot, "Dockerfile.worker");
    if (existsSync(path)) {
      expect(withoutDockerComments(readFileSync(path, "utf8"))).not.toMatch(
        /--no-sandbox/,
      );
    }
  });
});
