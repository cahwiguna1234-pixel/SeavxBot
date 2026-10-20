import { MAX_MEDIA_BYTES } from "@/lib/media";

// iloveimg.com background remover. TOKEN is the site's public client token,
// not a secret.
const TOKEN =
  "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiIiLCJhdWQiOiIiLCJpYXQiOjE1MjMzNjQ4MjQsIm5iZiI6MTUyMzM2NDgyNCwianRpIjoicHJvamVjdF9wdWJsaWNfYzkwNWRkMWMwMWU5ZmQ3NzY5ODNjYTQwZDBhOWQyZjNfT1Vzd2EwODA0MGI4ZDJjN2NhM2NjZGE2MGQ2MTBhMmRkY2U3NyJ9.qvHSXgCJgqpC4gd6-paUlDLFmg0o2DsOvb1EUYPYx_E";

/**
 * Only these workers have the model loaded; the same request on any other
 * worker returns 500, so the list is ordered by what actually worked.
 */
const HOSTS = ["api4g", "api5g", "api6g"];

const DEFAULT_TIMEOUT_MS = 120_000;

export class RemoveBgError extends Error {}

export interface RemoveBgOptions {
  /** Uploads already produce a cut-out PNG for any accepted input, so only
   *  the fetched bytes are needed here. */
  fetcher?: typeof fetch;
  hosts?: string[];
  timeoutMs?: number;
}

const isPng = (image: Buffer): boolean =>
  image[0] === 0x89 &&
  image[1] === 0x50 &&
  image[2] === 0x4e &&
  image[3] === 0x47;

/** One upload + remove attempt on a single worker; null means "try the next". */
async function onHost(
  host: string,
  image: Buffer,
  options: RemoveBgOptions,
): Promise<Buffer | null> {
  const fetcher = options.fetcher ?? fetch;
  const post = (path: string, body: FormData): Promise<Response> =>
    fetcher(`https://${host}.iloveimg.com/v1/${path}`, {
      method: "POST",
      body,
      headers: { authorization: `Bearer ${TOKEN}` },
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });

  try {
    const png = isPng(image);
    const task = crypto.randomUUID().replaceAll("-", "");
    const upload = new FormData();
    upload.append("task", task);
    upload.append(
      "file",
      new Blob([image], { type: png ? "image/png" : "image/jpeg" }),
      png ? "image.png" : "image.jpg",
    );

    const uploaded = await post("upload", upload);
    if (!uploaded.ok) return null;
    const { server_filename } = (await uploaded.json()) as {
      server_filename?: string;
    };
    if (!server_filename) return null;

    const form = new FormData();
    form.append("task", task);
    form.append("server_filename", server_filename);

    const result = await post("removebackground", form);
    if (!result.ok) return null;

    const buffer = Buffer.from(await result.arrayBuffer());
    return buffer.byteLength > MAX_MEDIA_BYTES ? null : buffer;
  } catch {
    return null;
  }
}

/** Sends one image through the online remover and returns the cut-out PNG. */
export async function removeBackground(
  image: Buffer,
  options: RemoveBgOptions = {},
): Promise<Buffer> {
  for (const host of options.hosts ?? HOSTS) {
    const buffer = await onHost(host, image, options);
    if (buffer) return buffer;
  }

  throw new RemoveBgError(
    "The background remover could not process that photo. Try again later.",
  );
}
