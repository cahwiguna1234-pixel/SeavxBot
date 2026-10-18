# seavxbot

A lean WhatsApp bot powered by Bun, TypeScript, and `@whiskeysockets/baileys`.

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
bun run typecheck
```

This project was created using `bun init` in bun v1.4.3. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
