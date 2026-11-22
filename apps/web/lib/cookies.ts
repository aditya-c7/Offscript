import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";

const OWNER_COOKIE = "offscript_uid";
const MAX_COOKIE_LENGTH = 128;
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/**
 * Return a stable, anonymous owner id for the current browser.
 *
 * The value is httpOnly and never passed to a client component. Cookie writes
 * are only possible in Route Handlers and Server Actions; during a plain
 * Server Component render the set is skipped and the next request will try
 * again (nothing secret is logged).
 */
export async function getOwnerId(): Promise<string> {
  const cookieStore = await cookies();
  const existing = cookieStore.get(OWNER_COOKIE);
  if (
    existing &&
    existing.value.length > 0 &&
    existing.value.length <= MAX_COOKIE_LENGTH
  ) {
    return existing.value;
  }

  const ownerId = randomUUID();
  try {
    cookieStore.set(OWNER_COOKIE, ownerId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: ONE_YEAR_SECONDS,
    });
  } catch {
    // Server Component render: cookies cannot be modified here. The value is
    // still returned for this request and will be persisted by a write path.
  }
  return ownerId;
}
