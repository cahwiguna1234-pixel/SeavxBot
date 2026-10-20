import { MAX_MEDIA_BYTES } from "@/lib/media";

// iloveimg.com upscaler, 2x. Returns null on any failure.
// TOKEN is the site's public client token, not a secret.
const TOKEN =
  "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiIiLCJhdWQiOiIiLCJpYXQiOjE1MjMzNjQ4MjQsIm5iZiI6MTUyMzM2NDgyNCwianRpIjoicHJvamVjdF9wdWJsaWNfYzkwNWRkMWMwMWU5ZmQ3NzY5ODNjYTQwZDBhOWQyZjNfT1Vzd2EwODA0MGI4ZDJjN2NhM2NjZGE2MGQ2MTBhMmRkY2U3NyJ9.qvHSXgCJgqpC4gd6-paUlDLFmg0o2DsOvb1EUYPYx_E";

function post(path: string, form: FormData): Promise<Response> {
  return fetch(`https://api20g.iloveimg.com/v1/${path}`, {
    method: "POST",
    body: form,
    headers: { authorization: `Bearer ${TOKEN}` },
    signal: AbortSignal.timeout(90_000),
  });
}

export async function upscale(imageUrl: string): Promise<Blob | null> {
  try {
    const source = await fetch(imageUrl, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!source.ok) return null;

    // Only jpg/png are accepted, and the task must be 32 hex chars.
    const isPng =
      source.headers.get("content-type")?.startsWith("image/png") ?? false;
    const upload = new FormData();
    const task = crypto.randomUUID().replaceAll("-", "");
    upload.append("task", task);
    upload.append(
      "file",
      new Blob([await source.arrayBuffer()], {
        type: isPng ? "image/png" : "image/jpeg",
      }),
      isPng ? "image.png" : "image.jpg",
    );

    const res = await post("upload", upload);
    if (!res.ok) return null;
    const { server_filename } = (await res.json()) as {
      server_filename?: string;
    };
    if (!server_filename) return null;

    const form = new FormData();
    form.append("task", task);
    form.append("server_filename", server_filename);
    form.append("scale", "2");

    const result = await post("upscale", form);
    return result.ok ? await result.blob() : null;
  } catch {
    return null;
  }
}

/** Sends image bytes through the upscaler; null means "tell the user it failed". */
export async function upscaleBuffer(image: Buffer): Promise<Buffer | null> {
  // The upload labels the file from the URL's media type, so it must match.
  const png =
    image[0] === 0x89 && image[1] === 0x50 && image[2] === 0x4e && image[3] === 0x47;
  const blob = await upscale(
    `data:image/${png ? "png" : "jpeg"};base64,${image.toString("base64")}`,
  );
  if (!blob) return null;

  const buffer = Buffer.from(await blob.arrayBuffer());
  return buffer.byteLength > MAX_MEDIA_BYTES ? null : buffer;
}
