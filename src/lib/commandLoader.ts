import fs from "node:fs";
import path from "node:path";
import type { Command } from "@/lib/types";

export const commands = new Map<string, Command>();
export const aliases = new Map<string, string>();

export async function loadCommands(
  dir = path.resolve(import.meta.dir, "../commands"),
): Promise<void> {
  commands.clear();
  aliases.clear();

  if (!fs.existsSync(dir)) return;

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      await loadCommands(fullPath);
      continue;
    }

    if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".js")) continue;
    if (entry.name.includes(".test.") || entry.name.includes(".spec."))
      continue;

    const module = await import(`${fullPath}?t=${Date.now()}`);
    const cmd: Command = module.default || Object.values(module)[0];

    if (!cmd?.name || typeof cmd.run !== "function") continue;

    commands.set(cmd.name.toLowerCase(), cmd);

    if (Array.isArray(cmd.aliases)) {
      for (const alias of cmd.aliases) {
        aliases.set(alias.toLowerCase(), cmd.name.toLowerCase());
      }
    }
  }

  console.log(`Loaded ${commands.size} commands (${aliases.size} aliases)`);
}

export function getCommand(name: string): Command | undefined {
  const normalized = name.toLowerCase();
  const direct = commands.get(normalized);
  if (direct) return direct;

  const mapped = aliases.get(normalized);
  return mapped ? commands.get(mapped) : undefined;
}
