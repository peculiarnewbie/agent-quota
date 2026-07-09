import { execSync } from "node:child_process";
import { platform } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { copyFileSync, mkdirSync } from "node:fs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const root = join(__dirname, "..");
const isWin = platform() === "win32";
const ext = isWin ? ".exe" : "";

console.log("Building frontend (vite)...");
execSync("pnpm --filter @agent-quota/web build", { stdio: "inherit", cwd: root });

console.log("Building Rust server...");
mkdirSync(join(root, "dist"), { recursive: true });
execSync("cargo build --release", {
  stdio: "inherit",
  cwd: join(root, "packages", "server"),
});

const rustBin = join(
  root,
  "packages",
  "server",
  "target",
  "release",
  `agent-quota${ext}`,
);
const destBin = join(root, "dist", `agent-quota${ext}`);
copyFileSync(rustBin, destBin);

console.log(`Done. Binary at dist/agent-quota${ext}`);
console.log(`Static UI at packages/web/dist`);
