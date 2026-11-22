// Negative test: reintroducing the old Cloudflare Containers config, the
// legacy proxy entrypoint, or an unsafe deploy script must fail.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

const CHECKER = join(process.cwd(), "scripts", "check-web-deploy-config.mjs");

const GOOD_DEPLOY =
  "opennextjs-cloudflare build && opennextjs-cloudflare deploy --config ./wrangler.jsonc --keep-vars";

function runCheck(raw, deployScript = GOOD_DEPLOY) {
  const dir = mkdtempSync(join(tmpdir(), "offscript-cfg-"));
  const configPath = join(dir, "wrangler.jsonc");
  writeFileSync(configPath, raw, "utf8");
  const packagePath = join(dir, "package.json");
  writeFileSync(
    packagePath,
    JSON.stringify({ scripts: { deploy: deployScript } }),
    "utf8",
  );
  try {
    execFileSync(process.execPath, [CHECKER, configPath, packagePath], {
      encoding: "utf8",
    });
    return 0;
  } catch (error) {
    return error.status ?? 1;
  }
}

const good = `{
  "name": "offscript",
  "main": ".open-next/worker.js",
  "assets": { "directory": ".open-next/assets", "binding": "ASSETS" },
  "vars": { "DB_DRIVER": "neon-http" }
}`;

assert.equal(runCheck(good), 0, "current config should pass");

const withContainers = good.replace(
  '"name": "offscript",',
  '"containers": [{ "class_name": "WebContainer" }],\n  "name": "offscript",',
);
assert.notEqual(runCheck(withContainers), 0, "containers config must fail");

const withProxy = good.replace(
  '"main": ".open-next/worker.js",',
  '"main": "cloudflare/worker.js",',
);
assert.notEqual(runCheck(withProxy), 0, "legacy proxy entrypoint must fail");

const withoutKeepVars = GOOD_DEPLOY.replace(" --keep-vars", "");
assert.notEqual(
  runCheck(good, withoutKeepVars),
  0,
  "deploy script missing --keep-vars must fail",
);

const withoutConfig = GOOD_DEPLOY.replace(" --config ./wrangler.jsonc", "");
assert.notEqual(
  runCheck(good, withoutConfig),
  0,
  "deploy script missing explicit --config must fail",
);

console.log("negative deploy-config test OK");
