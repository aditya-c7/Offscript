// Validates that required runtime variables are present without printing values.
const required = ["DATABASE_URL", "DB_DRIVER", "WORKER_ENQUEUE_URL"];
const providerKeys = ["OPENROUTER_API_KEY", "GROQ_API_KEY", "NVIDIA_API_KEY"];

const problems = [];
for (const name of required) {
  if (typeof process.env[name] !== "string" || process.env[name] === "") {
    problems.push(name);
  }
}
if (process.env.DB_DRIVER !== "neon-http") problems.push("DB_DRIVER=neon-http");
if (!providerKeys.some((name) => (process.env[name] ?? "").length > 0)) {
  problems.push("at least one provider key");
}

if (problems.length > 0) {
  console.error("runtime config check failed for: " + problems.join(", "));
  process.exit(1);
}
console.log("runtime config OK (values not printed)");
