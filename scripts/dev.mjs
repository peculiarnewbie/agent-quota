import { spawn } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const root = join(__dirname, "..");

const children = [];

function run(label, command, args, opts = {}) {
  const child = spawn(command, args, {
    stdio: "inherit",
    cwd: root,
    ...opts,
  });
  child.on("exit", (code, signal) => {
    if (signal) return;
    console.error(`[${label}] exited with code ${code}`);
    shutdown(code ?? 1);
  });
  children.push(child);
  return child;
}

function shutdown(code = 0) {
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

console.log("Starting Rust API on :6767 and Vite on :6769 ...");
run("server", "cargo", [
  "run",
  "--manifest-path",
  "packages/server/Cargo.toml",
  "--",
  "--port",
  "6767",
]);
run("web", "pnpm", ["--filter", "@agent-quota/web", "dev"]);
