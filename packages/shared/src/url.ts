import ipaddr from "ipaddr.js";

/** Error thrown when a URL fails normalization or SSRF safety validation. */
export class UrlValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UrlValidationError";
  }
}

export interface NormalizedUrl {
  /** Fully normalized URL string (no credentials, no hash, lowercase host). */
  href: string;
  url: URL;
  host: string;
  hostname: string;
  protocol: "http:" | "https:";
}

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.goog",
]);

/**
 * Normalize a user-supplied web address.
 * - Rejects anything that is not http/https.
 * - Strips credentials, fragments, and default ports.
 * - Punycode-normalizes international hostnames.
 */
export function normalizeUrl(input: string): NormalizedUrl {
  const raw = input.trim();
  if (raw.length === 0) {
    throw new UrlValidationError("Enter a web address.");
  }

  // Reject explicit non-web schemes before adding a default scheme.
  const schemeMatch = /^([a-z][a-z0-9+.-]*):/i.exec(raw);
  if (schemeMatch && schemeMatch[1] !== undefined) {
    const scheme = schemeMatch[1].toLowerCase();
    if (scheme !== "http" && scheme !== "https") {
      throw new UrlValidationError(
        "Only http and https addresses are supported.",
      );
    }
  }

  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new UrlValidationError(
      "That does not look like a valid web address.",
    );
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UrlValidationError(
      "Only http and https addresses are supported.",
    );
  }

  // Strip credentials and fragment.
  url.username = "";
  url.password = "";
  url.hash = "";

  // Normalize host to lowercase ASCII (punycode).
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  let asciiHost = hostname;
  try {
    asciiHost = new URL(`http://${hostname}/`).hostname.toLowerCase();
  } catch {
    // keep the raw lowercase hostname
  }
  url.hostname = asciiHost;

  // Remove default ports.
  if (url.protocol === "http:" && url.port === "80") url.port = "";
  if (url.protocol === "https:" && url.port === "443") url.port = "";

  if (
    HOSTNAME_BLOCKLIST.has(
      asciiHost.startsWith("[") ? asciiHost.slice(1, -1) : asciiHost,
    )
  ) {
    throw new UrlValidationError(
      "That address points to a private or reserved network.",
    );
  }
  if (BLOCKED_HOSTNAMES.has(asciiHost)) {
    throw new UrlValidationError(
      "That address points to a private or reserved network.",
    );
  }

  const href = url.toString();
  return {
    href,
    url,
    host: url.host,
    hostname: asciiHost,
    protocol: url.protocol as "http:" | "https:",
  };
}

const HOSTNAME_BLOCKLIST = new Set<string>();

/**
 * Determine whether a resolved IP address is safe to connect to.
 * Blocks loopback, RFC1918, CGNAT, link-local, cloud metadata, multicast,
 * reserved ranges, and IPv4-mapped IPv6 addresses.
 */
export function isSafeIpAddress(ip: string): boolean {
  let parsed: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    parsed = ipaddr.parse(ip);
  } catch {
    return false;
  }

  // Normalize IPv4-mapped IPv6 (::ffff:127.0.0.1) to IPv4.
  if (parsed.kind() === "ipv6") {
    const v6 = parsed as ipaddr.IPv6;
    if (v6.isIPv4MappedAddress()) {
      parsed = v6.toIPv4Address();
    }
  }

  if (parsed.kind() === "ipv4") {
    const range = (parsed as ipaddr.IPv4).range();
    // Allowed public ranges only.
    return range === "unicast";
  }

  // Any non-mapped IPv6 is treated as unsafe unless explicitly global unicast.
  const v6 = parsed as ipaddr.IPv6;
  return v6.range() === "unicast";
}

/** Strip a trailing dot and brackets from a hostname for IP checks. */
export function hostnameToIpLiteral(hostname: string): string | null {
  const cleaned = hostname
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .replace(/\.$/, "");
  if (ipaddr.isValid(cleaned)) return cleaned;
  return null;
}
