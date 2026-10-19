// Screenshots via thum.io: free, keyless, rendered by a real Chrome instance.
const ENDPOINT = "https://image.thum.io/get";

export interface Screenshot {
  buffer: Buffer;
  mimetype: string;
}

/**
 * Turns user input into a fetchable URL, adding `https://` when the scheme is
 * missing. Returns null for anything the service cannot render: a stray word
 * instead of a domain, or a non-HTTP scheme.
 */
export function normalizeSiteUrl(input: string): string | null {
  const raw = input.trim();

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }

  // A host without a dot is `localhost` or a bare word, not a public site.
  return url.hostname.includes(".") ? url.toString() : null;
}

/**
 * Renders a page to a 1200x900 image, or null when the service refuses.
 *
 * The target URL goes into the path **unencoded** — encoding it makes thum.io
 * answer 400. A dead domain is not a failure: the service renders the browser's
 * own "This site can't be reached" page and answers 200.
 */
export async function captureScreenshot(
  target: string,
): Promise<Screenshot | null> {
  const url = `${ENDPOINT}/width/1200/crop/900/noanimate/${target}`;

  const response = await fetch(url, {
    signal: AbortSignal.timeout(30_000),
  });

  const mimetype = response.headers.get("content-type") ?? "";

  if (!response.ok || !mimetype.startsWith("image/")) {
    await response.body?.cancel();
    return null;
  }

  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    mimetype,
  };
}
