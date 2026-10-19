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
- Website screenshots: `!ss <url>` renders a page to a PNG

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
