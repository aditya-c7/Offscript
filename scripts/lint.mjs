// Lightweight static check for the project's non-negotiable code rules.
// Runs on any platform and needs no extra dependencies.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const roots = process.argv.slice(2);
if (roots.length === 0) roots.push(".");

const extensions = new Set([".ts", ".tsx", ".mts", ".cts"]);
const skipDirs = new Set([
  "node_modules",
  ".next",
  "dist",
  "coverage",
  ".git",
  "storage",
]);
const banned = [
  { re: /@ts-ignore/, label: "@ts-ignore" },
  { re: /@ts-nocheck/, label: "@ts-nocheck" },
  { re: /\bas\s+any\b/, label: "as any" },
  { re: /:\s*any\b/, label: ": any" },
  { re: /<any>/, label: "<any>" },
  { re: /Array<any>/, label: "Array<any>" },
];

const problems = [];

function walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const full = join(dir, name);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      if (!skipDirs.has(name)) walk(full);
      continue;
    }
    const dot = name.lastIndexOf(".");
    if (dot === -1 || !extensions.has(name.slice(dot))) continue;
    const source = readFileSync(full, "utf8");
    const lines = source.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (line.trimStart().startsWith("//")) return;
      for (const rule of banned) {
        if (rule.re.test(line)) {
          problems.push(
            `${relative(process.cwd(), full)}:${index + 1} ${rule.label}`,
          );
        }
      }
    });
  }
}

for (const root of roots) walk(root);

if (problems.length > 0) {
  console.error("Lint problems:");
  for (const p of problems) console.error("  " + p);
  process.exit(1);
}
console.log(`lint: clean (${roots.join(", ")})`);
