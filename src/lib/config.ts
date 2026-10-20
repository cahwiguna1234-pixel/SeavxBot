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
  download?: {
    /**
     * How to invoke yt-dlp, as an argv prefix. Use `["python", "-m", "yt_dlp"]`
     * when the pip launcher is blocked by policy but the module is importable.
     */
    ytdlp_command?: string[];
    /** Shorthand for a single binary; ignored when `ytdlp_command` is set. */
    ytdlp_path?: string;
    /** Directory or executable for ffmpeg, needed to merge video + audio. */
    ffmpeg_path?: string;
    /** Highest vertical resolution attempted before falling back lower. */
    max_height?: number;
    /** Wall-clock budget for one download attempt. */
    timeout_seconds?: number;
    /** .ttf used for sticker text; auto-detected when empty. */
    sticker_font?: string;
  };
  features?: {
    read_message?: boolean;
  };
  device_info?: {
    /** Address users open the device link at, e.g. "http://1.2.3.4:3000". */
    public_url?: string;
    /** Port the device-link server listens on; defaults to 3000. */
    port?: number;
  };
  schedule?: {
    /** Local `HH:MM` defaults for groups that enable the nightly schedule. */
    auto_close_time?: string;
    auto_open_time?: string;
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
