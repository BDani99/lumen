/**
 * Host allowlist for /api/proxy — the only external hosts Lumen legitimately
 * fetches through the authenticated media proxy (R2-mirrored scene media,
 * AI33-hosted audio, and — for the Pro pipeline, which does not mirror to R2 —
 * the stock-footage CDNs themselves). Extend this list, don't remove the check.
 */
const STATIC_ALLOWED_SUFFIXES = [
  "ai33.pro",
  "pexels.com",
  "pixabay.com",
  "wikimedia.org",
  "archive.org",
];

function hostMatchesSuffix(hostname: string, suffix: string): boolean {
  return hostname === suffix || hostname.endsWith(`.${suffix}`);
}

/** R2's public base URL host, if configured — added to the allowlist at request time. */
function r2Host(): string | null {
  const base = process.env.R2_PUBLIC_BASE_URL?.trim();
  if (!base) return null;
  try {
    return new URL(base).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function isProxyHostAllowed(hostname: string): boolean {
  const host = hostname.toLowerCase();
  const r2 = r2Host();
  if (r2 && hostMatchesSuffix(host, r2)) return true;
  return STATIC_ALLOWED_SUFFIXES.some((suffix) => hostMatchesSuffix(host, suffix));
}

const PRIVATE_IPV4_RANGES: Array<[number, number]> = [
  [ipToInt("0.0.0.0"), ipToInt("0.255.255.255")], // "this" network
  [ipToInt("10.0.0.0"), ipToInt("10.255.255.255")], // RFC1918
  [ipToInt("100.64.0.0"), ipToInt("100.127.255.255")], // CGNAT
  [ipToInt("127.0.0.0"), ipToInt("127.255.255.255")], // loopback
  [ipToInt("169.254.0.0"), ipToInt("169.254.255.255")], // link-local (cloud metadata!)
  [ipToInt("172.16.0.0"), ipToInt("172.31.255.255")], // RFC1918
  [ipToInt("192.0.0.0"), ipToInt("192.0.0.255")], // IETF protocol assignments
  [ipToInt("192.168.0.0"), ipToInt("192.168.255.255")], // RFC1918
  [ipToInt("198.18.0.0"), ipToInt("198.19.255.255")], // benchmarking
  [ipToInt("224.0.0.0"), ipToInt("255.255.255.255")], // multicast / reserved
];

function ipToInt(ip: string): number {
  const parts = ip.split(".").map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function isPrivateIpv4(ip: string): boolean {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return false;
  const value = ipToInt(ip);
  return PRIVATE_IPV4_RANGES.some(([start, end]) => value >= start && value <= end);
}

function isPrivateIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1") return true; // loopback
  if (lower === "::") return true; // unspecified
  if (lower.startsWith("fe80:") || lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return true; // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local
  // IPv4-mapped IPv6 (::ffff:a.b.c.d) — check the embedded IPv4 address too.
  const mapped = lower.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return isPrivateIpv4(mapped[1]);
  return false;
}

/** True for loopback / link-local (incl. cloud metadata 169.254.169.254) / RFC1918 / reserved addresses. */
export function isPrivateOrReservedIp(ip: string): boolean {
  return ip.includes(":") ? isPrivateIpv6(ip) : isPrivateIpv4(ip);
}
