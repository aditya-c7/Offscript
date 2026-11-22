/// <reference path="../../../node_modules/.pnpm/node_modules/@types/node/index.d.ts" />
import { promises as dns } from "node:dns";
import ipaddr from "ipaddr.js";
import {
  hostnameToIpLiteral,
  isSafeIpAddress,
  normalizeUrl,
  UrlValidationError,
} from "@offscript/shared";

/** Error raised when a URL or resolved address fails SSRF validation. */
export class SsrfValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfValidationError";
  }
}

/**
 * Extra blocked ranges beyond `isSafeIpAddress`. The 169.0.0.0/8 block is
 * intentionally conservative: it covers the 169.254.0.0/16 metadata and
 * link-local range together with its wider surrounding prefix.
 */
function ipv4Octets(ip: string): number[] | null {
  try {
    const parsed = ipaddr.parse(ip);
    if (parsed instanceof ipaddr.IPv6 && parsed.isIPv4MappedAddress()) {
      return parsed.toIPv4Address().octets;
    }
    if (parsed instanceof ipaddr.IPv4) {
      return parsed.octets;
    }
    return null;
  } catch {
    return null;
  }
}

function isExtraBlockedIp(ip: string): boolean {
  const octets = ipv4Octets(ip);
  return octets !== null && octets[0] === 169;
}

async function lookupAddresses(
  hostname: string,
): Promise<ReadonlyArray<{ address: string; family: number }>> {
  try {
    return await dns.lookup(hostname, { all: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new SsrfValidationError(`Could not resolve hostname: ${message}`);
  }
}

function assertIpIsSafe(ip: string): void {
  if (!isSafeIpAddress(ip) || isExtraBlockedIp(ip)) {
    throw new SsrfValidationError(
      "That address points to a private or reserved network.",
    );
  }
}

/**
 * Resolve a hostname and return one IP literal that is safe to connect to.
 *
 * Every resolved address is validated; a single private/reserved answer causes
 * the whole resolution to be rejected (DNS rebinding defence). Literal IPs are
 * validated directly without a DNS lookup.
 */
export async function resolveAndValidate(hostname: string): Promise<string> {
  const literal = hostnameToIpLiteral(hostname);
  if (literal !== null) {
    assertIpIsSafe(literal);
    return literal;
  }

  const addresses = await lookupAddresses(hostname);

  if (addresses.length === 0) {
    throw new SsrfValidationError("Hostname resolved to no addresses.");
  }

  for (const entry of addresses) {
    assertIpIsSafe(entry.address);
  }

  const first = addresses[0];
  if (first === undefined) {
    throw new SsrfValidationError("Hostname resolved to no addresses.");
  }
  return first.address;
}

/**
 * Normalize a raw URL and validate both its literal IP (when present) and any
 * addresses its hostname resolves to. The returned URL is safe to fetch.
 */
export async function assertSafeUrl(
  rawUrl: string,
): Promise<{ url: URL; ip: string }> {
  let normalized: ReturnType<typeof normalizeUrl>;
  try {
    normalized = normalizeUrl(rawUrl);
  } catch (error: unknown) {
    if (error instanceof UrlValidationError) {
      throw new SsrfValidationError(error.message);
    }
    throw error;
  }

  const { url } = normalized;
  const ip = await resolveAndValidate(normalized.hostname);
  return { url, ip };
}
