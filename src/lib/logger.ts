import fs from "node:fs";
import path from "node:path";

const LOGS_DIR = path.resolve(process.cwd(), "logs");
const LOG_FILE = path.join(LOGS_DIR, "session.log");

// Reset logs on process start
if (fs.existsSync(LOGS_DIR)) {
  fs.rmSync(LOGS_DIR, { recursive: true, force: true });
}
fs.mkdirSync(LOGS_DIR, { recursive: true });

const logStream = fs.createWriteStream(LOG_FILE, { flags: "a" });

function cleanup(): void {
  try {
    logStream.end();
    if (fs.existsSync(LOGS_DIR)) {
      fs.rmSync(LOGS_DIR, { recursive: true, force: true });
    }
  } catch {}
}

// Remove logs folder on process termination
process.once("exit", cleanup);
process.once("SIGINT", () => {
  cleanup();
  process.exit(0);
});
process.once("SIGTERM", () => {
  cleanup();
  process.exit(0);
});

export function logToFile(prefix: string, message: unknown): void {
  const timestamp = new Date().toISOString();
  const content =
    typeof message === "string"
      ? message
      : JSON.stringify(message, (_key, val) => (typeof val === "bigint" ? val.toString() : val), 2);

  logStream.write(`[${timestamp}] [${prefix}]\n${content}\n\n`);
}
