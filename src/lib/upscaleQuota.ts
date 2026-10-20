import type { User } from "@/lib/users";

/** Successful 2x upscales a free user gets before the command refuses. */
export const FREE_UPSCALE_LIMIT = 5;

export const FREE_UPSCALE_EXHAUSTED =
  "🚩 Kuota upscale 2x kamu sudah habis (5/5). Upgrade ke premium untuk unlimited.";

export const UPSCALE_4X_PREMIUM_ONLY =
  "🚩 Upscale 4x hanya untuk pengguna premium.";

export type UpscaleScale = 2 | 4;

/** `2` or `4`; anything else falls back to 2, which every role may run. */
export function parseScale(args: string[]): UpscaleScale {
  return args.find((arg) => arg === "4" || arg === "4x") ? 4 : 2;
}

/** First unmet guard for an upscale request, or undefined when allowed. */
export function upscaleDenial(
  user: User | null,
  scale: UpscaleScale,
  premium: boolean,
): string | undefined {
  if (scale === 4) return premium ? undefined : UPSCALE_4X_PREMIUM_ONLY;
  if (premium) return undefined;

  // A grant to a user the bot has never seen leaves them with one credit.
  const used = user?.upscale2Count ?? 0;
  return used >= FREE_UPSCALE_LIMIT ? FREE_UPSCALE_EXHAUSTED : undefined;
}
