// Preflight guard for the production Cloudflare web deploy path.
// Fails if the effective Wrangler config brings back Containers or the
// legacy ORIGIN_URL proxy entrypoint.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const configPath = process.argv[2] ?? join("apps", "web", "wrangler.jsonc");
const packagePath = process.argv[3] ?? join("apps", "web", "package.json");
const raw = readFileSync(configPath, "utf8");
const pkg = JSON.parse(readFileSync(packagePath, "utf8"));

const problems = [];
if (/\bcontainers\b/i.test(raw)) problems.push("containers binding present");
if (/\bdurable_objects\b/i.test(raw))
  problems.push("durable_objects binding present");
if (/\bcloudflare\/worker\.js\b/i.test(raw))
  problems.push("legacy proxy entrypoint referenced");
if (/\bORIGIN_URL\b/i.test(raw))
  problems.push("legacy ORIGIN_URL proxy referenced");
if (/\bWebContainer\b|\bWorkerContainer\b/i.test(raw))
  problems.push("legacy container class referenced");

if (!/"name"\s*:\s*"offscript"/.test(raw))
  problems.push('name must be "offscript"');
if (!/"main"\s*:\s*"\.open-next\/worker\.js"/.test(raw))
  problems.push('main must be ".open-next/worker.js"');
if (!/"directory"\s*:\s*"\.open-next\/assets"/.test(raw))
  problems.push('assets directory must be ".open-next/assets"');

// The package.json deploy script is the effective production path. It must
// use the OpenNext Cloudflare build+deploy flow, pin the wrangler config
// explicitly, and preserve existing vars. Never print the script itself: it
// may contain secrets, so only the missing fragment name is reported.
const deployScript =
  typeof pkg.scripts?.deploy === "string" ? pkg.scripts.deploy : "";
const requiredDeployFragments = [
  [
    "opennextjs-cloudflare build",
    "deploy script missing 'opennextjs-cloudflare build'",
  ],
  [
    "opennextjs-cloudflare deploy",
    "deploy script missing 'opennextjs-cloudflare deploy'",
  ],
  [
    "--config ./wrangler.jsonc",
    "deploy script missing '--config ./wrangler.jsonc'",
  ],
  ["--keep-vars", "deploy script missing '--keep-vars'"],
];
for (const [fragment, problem] of requiredDeployFragments) {
  if (!deployScript.includes(fragment)) problems.push(problem);
}

if (problems.length > 0) {
  console.error("web deploy config check failed:");
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log(`web deploy config OK: ${configPath}`);
