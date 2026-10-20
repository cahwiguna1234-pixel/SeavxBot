# seavxbot

[![CI](https://github.com/seaavey/SeavxBot/actions/workflows/ci.yml/badge.svg)](https://github.com/seaavey/SeavxBot/actions/workflows/ci.yml)
![Bun](https://img.shields.io/badge/runtime-Bun-000000?logo=bun&logoColor=white)
![TypeScript](https://img.shields.io/badge/language-TypeScript-3178C6?logo=typescript&logoColor=white)
![Baileys](https://img.shields.io/badge/engine-Baileys-25D366?logo=whatsapp&logoColor=white)

A lean WhatsApp bot powered by Bun, TypeScript, and `@whiskeysockets/baileys`.

- Multi-device login: pairing code or terminal QR
- Config via `config.toml`, no parser dependency
- Commands pre-loaded into memory, O(1) lookup per message
- Built-in guards: owner, admin, group-only, bot-admin

## Commands

Run `!menu` for the live list. The downloader commands:

| Command | Aliases | Description |
| --- | --- | --- |
| `tiktok <url>` | `tt`, `ttdl` | Download a TikTok video or photo slideshow without a watermark |
| `youtube <url>` | `yt`, `ytmp4` | Download a YouTube video (up to 720p, falls back lower) |
| `instagram <url>` | `ig`, `igdl` | Download an Instagram reel, video, or photo post |

All three also accept the link as a reply to the message that contains it.
Videos are capped at WhatsApp's 64 MB media limit; the yt-dlp downloaders walk
a 720p → 480p → 360p → 240p ladder until one fits. Photos are sent inline, up
to the point WhatsApp rejects the size.

### WhatsApp status (`story`)

| Command | Aliases | Description |
| --- | --- | --- |
| `story` | `sw`, `status` | Reply to a video or photo to post it as your status in HD |

Owner-only. The media is re-encoded to WhatsApp's story canvas (1080×1920,
H.264 High, ~6 Mbps, AAC 128k) before upload, which keeps it sharp after
WhatsApp's own compression pass.

**About "HD" and compression:** WhatsApp always re-encodes status media on its
servers. There is no public API or message flag that disables it, and services
advertising "anti-compression" either patch the WhatsApp client or simply
transcode locally. What this command does is give WhatsApp the best possible
input — full story resolution, square pixels (SAR 1:1), 4:2:0 chroma, a
two-second keyframe interval — so the second encode starts from a clean master
instead of an already-degraded chat video.

The recipient list is built from every participant of every group the bot is
in. A status reaches those contacts only; direct contacts that share no group
cannot be discovered through the socket.

Requires `ffmpeg` (see below).

### Stickers

| Command | Aliases | Description |
| --- | --- | --- |
| `brat <text>` | `bratsticker` | Make a brat-style sticker from the given text |
| `sticker` | `s`, `stiker` | Turn a photo into a sticker |

`sticker` accepts the photo as the message the command replies to, or as the
media the command is attached to. Text is lowercased and blurred to match the
brat cover look, wrapped, and scaled to fit the 512×512 canvas. Photos are
centre-cropped to a square rather than letterboxed. Both need `ffmpeg` with
`libwebp`.

### Image tools

| Command | Aliases | Description |
| --- | --- | --- |
| `upscale [4]` | `hd`, `remini` | Upscale a photo 2x, or 4x for premium |
| `removebg` | `nobg`, `rmbg` | Remove the background from a photo |

`upscale` accepts a replied photo, a captioned photo, or a URL. Free users get
five successful 2x upscales; premium is unlimited and may also pass `4` (or
`4x`) for a 4x upscale. An attempt the upscaler rejects is not counted.

Accepts the photo the same way `sticker` does. The result is a transparent PNG
sent as a document, because WhatsApp flattens inline images to JPEG. Runs
through [iLoveIMG's](https://www.iloveimg.com/remove-background) public API, so
it needs no local install — only outbound HTTPS.

### Users & premium

Every inbound message is recorded in `users` (SQLite, next to the group
settings): role, message/command counts, and first/last seen. New users are
`free`. Owners grant premium with an expiry or permanently:

| Command | Aliases | Description |
| --- | --- | --- |
| `premium 7d\|30d\|permanent [target]` | `upgrade` | Grant premium (owner only) |
| `unpremium [target]` | `downgrade` | Return a user to free (owner only) |
| `userinfo [target]` | `profile` | Show role, expiry, and counts (owner only) |

A target is a mentioned user, the replied-to author, a phone number, or nobody
(meaning yourself). A typed number is checked with WhatsApp before a row is
created, so a typo cannot create a ghost user. Expiry is lazy: an expired row
is demoted the next time it is read, plus once at startup.

### Downloader requirements

- `tiktok` resolves through the public [tikwm](https://www.tikwm.com/) API and
  needs only outbound HTTPS.
- `youtube` and `instagram` shell out to [`yt-dlp`](https://github.com/yt-dlp/yt-dlp).
  Merging separate video/audio streams needs `ffmpeg` as well. Without yt-dlp
  the commands stay loaded and reply with an install hint instead of failing.

```bash
# yt-dlp — any one of these
pip install --user -U yt-dlp
pipx install yt-dlp
winget install yt-dlp.yt-dlp
brew install yt-dlp
```

If the `yt-dlp` launcher is blocked by policy (common on managed Windows), the
Python module usually still runs. Point `config.toml` at it instead:

```toml
[download]
ytdlp_command = ["python", "-m", "yt_dlp"]
```

`ffmpeg` must be reachable too. If the system one is blocked, the
`imageio-ffmpeg` wheel ships a portable build:

```bash
pip install --user imageio-ffmpeg
python -c "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())"
# put that path in config.toml -> [download] ffmpeg_path
```

## Group schedule

Each group can close itself at night and reopen in the morning. Off by default;
a group admin turns it on:

```
!settings autoclose 23:00
!settings autoopen 06:00
```

Setting a time also enables that half of the schedule; `on`/`off` toggles it
without touching the time, and `!settings` shows the current state. Times are
the host's local time. The bot must be a group admin — a group where it is not
is logged and skipped, never retried mid-day.

`config.toml` sets the defaults for groups that only run `on`:

```toml
[schedule]
auto_close_time = "23:00"
auto_open_time = "06:00"
```

## Setup

```bash
bun install
cp config.example.toml config.toml   # then set your owner numbers
bun start
```

`config.toml` and `auth_info/` are gitignored: the first holds phone numbers,
the second holds WhatsApp session credentials that grant full access to the
paired account. Never commit either.

## Scripts

```bash
bun start        # run the bot
bun dev          # run with watch mode
bun run test     # run the test suite
bun run typecheck
bun run format        # prettier --write .
bun run format:check  # prettier --check . (what CI enforces)
```

This project was created using `bun init` in bun v1.4.3. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
