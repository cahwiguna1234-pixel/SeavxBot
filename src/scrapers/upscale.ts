/** Free, keyless upscaler. Returns the result as a base64 data URL. */
const ENDPOINT = "https://imgmend.com/api/denoise";
const MAX_ATTEMPTS = 3;

/** A run either returns the image inline or an error object. */
interface DenoiseResponse {
  processedImage?: string;
}

/** Converts a data URL to a Blob so callers can send it like any other image. */
function toBlob(dataUrl: string): Blob | null {
  const match = dataUrl.match(/^data:([^;]+);base64,([\s\S]+)$/);
  const mime = match?.[1];
  const base64 = match?.[2];
  if (!mime || !base64) return null;

  return new Blob([Buffer.from(base64, "base64")], { type: mime });
}

/** One upload attempt. */
async function attempt(
  image: Uint8Array,
  filename: string,
): Promise<Blob | null> {
  const form = new FormData();
  form.append("image", new Blob([image], { type: "image/jpeg" }), filename);

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      body: form,
      headers: {
        origin: "https://imgmend.com",
        referer: "https://imgmend.com/",
      },
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) return null;

    const { processedImage } = (await res.json()) as DenoiseResponse;
    return processedImage ? toBlob(processedImage) : null;
  } catch {
    return null;
  }
}

/**
 * Upscales the image at `imageUrl` 2x and returns the result as a Blob, or null.
 *
 * Free and keyless, but the service answers `{"error": ...}` on roughly two in
 * five requests, so retrying is required rather than defensive. A null result
 * after every attempt means the provider is down — surface it, don't hang.
 */
export async function upscale(imageUrl: string): Promise<Blob | null> {
  const source = await fetch(imageUrl, { signal: AbortSignal.timeout(30_000) });
  if (!source.ok) return null;

  const image = new Uint8Array(await source.arrayBuffer());
  const filename = imageUrl.split("/").pop()?.split("?")[0] || "image.jpg";

  for (let index = 0; index < MAX_ATTEMPTS; index += 1) {
    const result = await attempt(image, filename);
    if (result) return result;
  }

  return null;
}
