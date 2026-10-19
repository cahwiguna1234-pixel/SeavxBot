export interface BotConfig {
  bot_name: string;
  prefixes: string[];
  owners: string[];
  auth: {
    dir: string;
    default_method?: string;
    phone_number?: string;
  };
  logging: {
    level: "fatal" | "error" | "warn" | "info" | "debug" | "trace";
  };
  storage?: {
    path?: string;
  };
  features?: {
    read_message?: boolean;
  };
  messages?: {
    owner_only?: string;
    admin_only?: string;
    group_only?: string;
    bot_admin_only?: string;
    error?: string;
    welcome_text?: string;
    goodbye_text?: string;
  };
}

let raw: unknown;
try {
  raw = (await import("../../config.toml")).default;
} catch {
  throw new Error(
    "Missing config.toml — copy config.example.toml to config.toml and set your owner numbers.",
  );
}

export const botConfig = raw as BotConfig;
