import type { AgentAction, PolicyEvent } from "@offscript/shared";

/* ------------------------------------------------------------------ */
/* Public surface                                                      */
/* ------------------------------------------------------------------ */

export interface ReadOnlyContext {
  context: import("playwright").BrowserContext;
  events: PolicyEvent[];
}

/** Destructive / auth / checkout control labels that must never be clicked. */
export const DESTRUCTIVE_PATTERN =
  /buy|purchase|checkout|pay|payment|submit|delete|remove|sign\s*in|log\s*in|sign\s*up|subscribe|send\s*message/i;

/** Input types that must never receive typed values. */
export const SENSITIVE_INPUT_PATTERN =
  /password|email|tel|number|card|cvv|cvc|otp|one[-_ ]?time[-_ ]?code/i;

/* ------------------------------------------------------------------ */
/* Network-level read-only enforcement                                  */
/* ------------------------------------------------------------------ */

const BLOCKED_RESOURCE_TYPES: ReadonlySet<string> = new Set([
  "beacon",
  "eventsource",
]);

const BLOCKED_METHODS: ReadonlySet<string> = new Set([
  "PUT",
  "PATCH",
  "DELETE",
  "TRACE",
  "TRACK",
]);

const BLOCKED_PATH_PATTERN =
  /\/checkout|\/cart|\/pay|\/payment|\/login|\/signin|\/signup|\/oauth|\/delete/i;

/**
 * Paths where a POST is known to be a read-only query (search / GraphQL).
 * Everything else that looks like a form submission is blocked.
 */
export const READ_ONLY_POST_PATH_PATTERN =
  /\/(graphql|graphiql|search|query|lookup|suggest)(\/|$|\?)/i;

const GRAPHQL_MUTATION_PATTERN = /\bmutation\b/i;
const FORM_CONTENT_TYPE_PATTERN =
  /application\/x-www-form-urlencoded|multipart\/form-data/i;

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function now(): string {
  return new Date().toISOString();
}

/**
 * Create a Playwright browser context hardened for strictly read-only use.
 * No `--no-sandbox` flag is ever used here.
 */
export async function createReadOnlyContext(
  browser: import("playwright").Browser,
): Promise<ReadOnlyContext> {
  const events: PolicyEvent[] = [];

  const context = await browser.newContext({ serviceWorkers: "block" });

  await context.routeWebSocket("**/*", (ws) => {
    events.push({
      at: now(),
      rule: "websocket_blocked",
      detail: "WebSocket connections are disabled in read-only mode",
      blocked: true,
    });
    void ws.close({ code: 1008, reason: "read-only" }).catch(() => {});
  });

  await context.route("**/*", (route) => {
    const request = route.request();
    const method = request.method().toUpperCase();
    const resourceType = request.resourceType();
    const url = request.url();
    const path = pathOf(url);

    const block = (rule: string, detail: string): void => {
      events.push({ at: now(), rule, detail, blocked: true });
      void route.abort().catch(() => {});
    };

    if (BLOCKED_RESOURCE_TYPES.has(resourceType)) {
      block(
        "resource_type_blocked",
        `${resourceType} request to ${url} was aborted`,
      );
      return;
    }

    if (BLOCKED_METHODS.has(method)) {
      block("method_blocked", `${method} request to ${url} was aborted`);
      return;
    }

    if (BLOCKED_PATH_PATTERN.test(path)) {
      block("path_blocked", `${method} request to blocked path ${path}`);
      return;
    }

    const postData = request.postData();
    const contentType = request.headers()["content-type"] ?? "";

    if (method === "POST" && postData !== null) {
      if (GRAPHQL_MUTATION_PATTERN.test(postData)) {
        block("graphql_mutation_blocked", `GraphQL mutation POST to ${path}`);
        return;
      }
      if (
        FORM_CONTENT_TYPE_PATTERN.test(contentType) &&
        !READ_ONLY_POST_PATH_PATTERN.test(path)
      ) {
        block(
          "form_submit_blocked",
          `Form submission (${contentType}) POST to ${path}`,
        );
        return;
      }
    }

    events.push({
      at: now(),
      rule: "request_allowed",
      detail: `${method} ${url} (${resourceType})`,
      blocked: false,
    });
    void route.continue().catch(() => {});
  });

  return { context, events };
}

/* ------------------------------------------------------------------ */
/* Action-level read-only enforcement                                   */
/* ------------------------------------------------------------------ */

const SENSITIVE_AUTOCOMPLETE_PATTERN =
  /cc-|current-password|new-password|one-time-code|card|cvv|cvc|otp/i;

/**
 * Descriptor for the element an action targets. Every field is optional so a
 * caller may pass a full `ObservationTarget` straight through instead of a
 * lossy `{ role, name, destination }` projection: observations carry the
 * accessible `name`, `role`, `destination` and `state`, while richer captures
 * may also provide `attributes`, `inputType` and `autocomplete`. The policy
 * inspects all of these sources before allowing a `type` action.
 */
export interface ActionTarget {
  role?: string;
  name?: string;
  destination?: string | null;
  inputType?: string;
  autocomplete?: string;
  attributes?: Record<string, unknown>;
  state?: Record<string, unknown>;
}

export interface ActionPolicyResult {
  allowed: boolean;
  event: PolicyEvent;
}

/** Read a string value from a string-keyed record without unchecked casts. */
function stringValue(
  record: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = record?.[key];
  return typeof value === "string" ? value : undefined;
}

function firstString(...values: Array<string | undefined>): string {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) return value;
  }
  return "";
}

/**
 * Collect every hint that may identify a sensitive input. Observations do not
 * carry `inputType`/`autocomplete` directly, so the accessible name, arbitrary
 * DOM `attributes`, and passthrough `state` are checked as well.
 */
function sensitiveSignals(target: ActionTarget): string {
  const values = [
    target.inputType,
    target.autocomplete,
    target.name,
    stringValue(target.attributes, "type"),
    stringValue(target.attributes, "autocomplete"),
    stringValue(target.attributes, "name"),
    stringValue(target.attributes, "placeholder"),
    stringValue(target.attributes, "aria-label"),
    stringValue(target.state, "inputType"),
    stringValue(target.state, "autocomplete"),
    stringValue(target.state, "type"),
    stringValue(target.state, "name"),
    stringValue(target.state, "placeholder"),
  ];
  return values
    .filter((value): value is string => typeof value === "string")
    .join(" ");
}

/**
 * Check a single agent action against the read-only policy. Always returns an
 * audit event, whether the action was allowed or blocked.
 */
export function assertActionAllowed(
  action: AgentAction,
  target: ActionTarget = {},
): ActionPolicyResult {
  const role = target.role ?? "";
  const name = target.name ?? "";
  let label: string;
  let suffix: string;
  if (role.length === 0 && name.length === 0) {
    // Navigation, scroll, extract and done actions have no element target.
    // Report the URL for navigation instead of logging an empty label.
    label = action.kind === "navigate" ? "navigation" : "(no target)";
    suffix = action.kind === "navigate" ? action.url : "no destination";
  } else {
    label = `${role} "${name}"`.trim();
    suffix = target.destination ?? "no destination";
  }

  let blocked = false;
  let rule = "action_allowed";
  let detail = `${action.kind} on ${label} (${suffix}) allowed`;

  const signals = sensitiveSignals(target);
  if (
    action.kind === "type" &&
    signals.length > 0 &&
    (SENSITIVE_INPUT_PATTERN.test(signals) ||
      SENSITIVE_AUTOCOMPLETE_PATTERN.test(signals))
  ) {
    blocked = true;
    rule = "sensitive_input_blocked";
    const inputType = firstString(
      target.inputType,
      stringValue(target.attributes, "type"),
      stringValue(target.state, "type"),
      stringValue(target.state, "inputType"),
    );
    const autocomplete = firstString(
      target.autocomplete,
      stringValue(target.attributes, "autocomplete"),
      stringValue(target.state, "autocomplete"),
    );
    detail = `Refusing to type into sensitive field ${label} (type=${inputType}, autocomplete=${autocomplete})`;
  } else if (action.kind === "click" && DESTRUCTIVE_PATTERN.test(label)) {
    blocked = true;
    rule = "destructive_click_blocked";
    detail = `Refusing to click destructive/auth/checkout control ${label} (${suffix})`;
  }

  return {
    allowed: !blocked,
    event: { at: now(), rule, detail, blocked },
  };
}
