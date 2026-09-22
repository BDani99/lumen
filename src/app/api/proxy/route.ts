import { NextResponse } from "next/server";
import { lookup } from "node:dns/promises";
import { requireUserApi } from "@/lib/auth";
import { isProxyHostAllowed, isPrivateOrReservedIp } from "@/lib/proxy-allowlist";

const FETCH_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 200 * 1024 * 1024; // 200 MB — generous for a Wan clip, still bounded
const MAX_REDIRECTS = 1;

/**
 * Authenticated media proxy used by the editor/export flow to download scene
 * media (R2, AI33 audio, and — for the Pro pipeline — stock-footage CDNs)
 * client-side without CORS issues. NOT a general-purpose fetch relay: the
 * target host must be on the allowlist, and the resolved IP must not be a
 * private/loopback/link-local address (blocks SSRF and DNS-rebinding against
 * internal infra, e.g. the 169.254.169.254 cloud metadata endpoint).
 */
export async function GET(req: Request) {
  const auth = await requireUserApi();
  if (auth.error) return auth.error;

  const { searchParams } = new URL(req.url);
  const rawUrl = searchParams.get("url");
  if (!rawUrl) {
    return NextResponse.json({ error: "Missing URL parameter" }, { status: 400 });
  }

  try {
    const buffer = await fetchAllowed(rawUrl, 0);
    return new NextResponse(buffer.body, {
      headers: {
        "Content-Type": buffer.contentType,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Proxy fetch failed";
    const status = error instanceof ProxyError ? error.status : 502;
    return NextResponse.json({ error: message }, { status });
  }
}

class ProxyError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function assertSafeTarget(url: URL): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ProxyError("Unsupported protocol", 400);
  }
  if (!isProxyHostAllowed(url.hostname)) {
    throw new ProxyError("Host not allowed", 403);
  }
  const resolved = await lookup(url.hostname, { all: true }).catch(() => []);
  if (resolved.length === 0) {
    throw new ProxyError("Could not resolve host", 502);
  }
  if (resolved.some((entry) => isPrivateOrReservedIp(entry.address))) {
    throw new ProxyError("Host resolves to a disallowed address", 403);
  }
}

async function fetchAllowed(
  rawUrl: string,
  redirectCount: number
): Promise<{ body: ArrayBuffer; contentType: string }> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ProxyError("Invalid URL", 400);
  }
  await assertSafeTarget(url);

  const response = await fetch(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("Location");
    if (!location || redirectCount >= MAX_REDIRECTS) {
      throw new ProxyError("Too many redirects", 502);
    }
    const nextUrl = new URL(location, url);
    return fetchAllowed(nextUrl.toString(), redirectCount + 1);
  }

  if (!response.ok) {
    throw new ProxyError(`Upstream error (${response.status})`, 502);
  }

  const contentLength = response.headers.get("Content-Length");
  if (contentLength && Number(contentLength) > MAX_RESPONSE_BYTES) {
    throw new ProxyError("Response too large", 502);
  }

  const body = await response.arrayBuffer();
  if (body.byteLength > MAX_RESPONSE_BYTES) {
    throw new ProxyError("Response too large", 502);
  }

  return {
    body,
    contentType: response.headers.get("Content-Type") || "application/octet-stream",
  };
}
