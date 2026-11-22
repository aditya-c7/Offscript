import type { Page } from "playwright";

const REDACTION = "[REDACTED]";

/* ------------------------------------------------------------------ */
/* Text redaction                                                      */
/* ------------------------------------------------------------------ */

const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const OPENROUTER_KEY_PATTERN = /\bsk-or-v1-[A-Za-z0-9_-]{8,}/g;
const GROQ_KEY_PATTERN = /\bgsk_[A-Za-z0-9_-]{8,}/g;
const GENERIC_SK_KEY_PATTERN = /\bsk-[A-Za-z0-9_-]{12,}/g;
const SSN_PATTERN = /\b\d{3}-\d{2}-\d{4}\b/g;
const CARD_PATTERN = /\b(?:\d[ -]?){12,18}\d\b/g;
const PASSWORD_JSON_PATTERN = /(["'])password\1\s*:\s*(["'])[^"']*\2/gi;
const PASSWORD_ASSIGNMENT_PATTERN =
  /\bpassword\s*=\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi;
const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const PHONE_PATTERN =
  /\b(?:\+\d{1,3}[-. ]?)?\(?\d{3}\)?[-. ]?\d{3}[-. ]?\d{4}\b/g;

const SECRET_PROBES: readonly RegExp[] = [
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/,
  /\bsk-or-v1-[A-Za-z0-9_-]{8,}/,
  /\bgsk_[A-Za-z0-9_-]{8,}/,
  /\bsk-[A-Za-z0-9_-]{12,}/,
  /\b\d{3}-\d{2}-\d{4}\b/,
  /\b(?:\d[ -]?){12,18}\d\b/,
  /\bpassword\s*[:=]/i,
  /(["'])password\1\s*:/i,
];

function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    const code = digits.charCodeAt(i) - 48;
    if (code < 0 || code > 9) return false;
    let value = code;
    if (double) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * Redact known secret/PII shapes from a string. Emails and phone numbers are
 * only redacted when the same string also contains a secret, so ordinary
 * contact information on a scanned page is preserved.
 */
export function redactText(input: string): { text: string; count: number } {
  if (input.length === 0) return { text: input, count: 0 };

  const hadSecret = SECRET_PROBES.some((probe) => probe.test(input));
  let text = input;
  let count = 0;

  const apply = (pattern: RegExp): void => {
    text = text.replace(pattern, () => {
      count += 1;
      return REDACTION;
    });
  };

  // Most specific key patterns first so they are not partially consumed.
  apply(JWT_PATTERN);
  apply(OPENROUTER_KEY_PATTERN);
  apply(GROQ_KEY_PATTERN);
  apply(GENERIC_SK_KEY_PATTERN);
  apply(SSN_PATTERN);

  text = text.replace(CARD_PATTERN, (match) => {
    const digits = match.replace(/[ -]/g, "");
    const formatted = /[ -]/.test(match);
    if (
      digits.length >= 13 &&
      digits.length <= 19 &&
      (luhnValid(digits) || formatted)
    ) {
      count += 1;
      return REDACTION;
    }
    return match;
  });

  apply(PASSWORD_JSON_PATTERN);
  apply(PASSWORD_ASSIGNMENT_PATTERN);

  if (hadSecret) {
    apply(EMAIL_PATTERN);
    apply(PHONE_PATTERN);
  }

  return { text, count };
}

/* ------------------------------------------------------------------ */
/* Structured redaction                                                 */
/* ------------------------------------------------------------------ */

/**
 * Deep-redact every string leaf of a structured value. The input is cloned
 * first, so it is never mutated. Non-string leaves keep their exact values.
 */
export function redactObject<T>(value: T): { value: T; count: number } {
  let count = 0;
  // Wrapping keeps the root a string *leaf* of the clone, so a top-level
  // string is redacted too, while `clone.value` stays typed as T.
  const clone = structuredClone({ value });
  const seen = new WeakSet<object>();

  const walk = (container: object): void => {
    if (seen.has(container)) return;
    seen.add(container);

    for (const key of Reflect.ownKeys(container)) {
      const descriptor = Object.getOwnPropertyDescriptor(container, key);
      if (descriptor === undefined || !("value" in descriptor)) continue;
      const current: unknown = descriptor.value;

      if (typeof current === "string") {
        const redacted = redactText(current);
        count += redacted.count;
        Object.defineProperty(container, key, {
          ...descriptor,
          value: redacted.text,
        });
      } else if (current !== null && typeof current === "object") {
        walk(current);
      }
    }
  };

  walk(clone);
  return { value: clone.value, count };
}

/* ------------------------------------------------------------------ */
/* Screenshot masking                                                   */
/* ------------------------------------------------------------------ */

const SENSITIVE_SELECTOR = [
  'input[type="password"]',
  'input[type="email"]',
  'input[type="tel"]',
  'input[autocomplete*="cc-"]',
  'input[autocomplete="current-password"]',
  'input[autocomplete="one-time-code"]',
  'input[autocomplete*="cvv"]',
  'input[autocomplete*="cvc"]',
  'input[autocomplete*="otp"]',
  'input[name*="card" i]',
  'input[name*="cvv" i]',
  'input[name*="cvc" i]',
  'input[placeholder*="card number" i]',
].join(",");

const OVERLAY_CLASS = "__offscript_pii_mask__";

/**
 * Hide sensitive form controls before a screenshot. Returns an async cleanup
 * function that removes both the injected stylesheet and the overlay nodes.
 */
export async function maskSensitiveInputs(
  page: Page,
): Promise<() => Promise<void>> {
  const styleHandle = await page.addStyleTag({
    content: `${SENSITIVE_SELECTOR}{color:transparent!important;-webkit-text-fill-color:transparent!important;background-color:#9ca3af!important;text-shadow:none!important;}`,
  });

  await page.evaluate(
    ({ selector, overlayClass }) => {
      document.querySelectorAll(selector).forEach((element) => {
        const rect = element.getBoundingClientRect();
        const overlay = document.createElement("div");
        overlay.className = overlayClass;
        overlay.style.position = "absolute";
        overlay.style.left = `${rect.left + window.scrollX}px`;
        overlay.style.top = `${rect.top + window.scrollY}px`;
        overlay.style.width = `${rect.width}px`;
        overlay.style.height = `${rect.height}px`;
        overlay.style.background = "#9ca3af";
        overlay.style.pointerEvents = "none";
        overlay.style.zIndex = "2147483647";
        document.body?.appendChild(overlay);
      });
    },
    { selector: SENSITIVE_SELECTOR, overlayClass: OVERLAY_CLASS },
  );

  return async () => {
    await styleHandle
      .evaluate((element) => element.parentNode?.removeChild(element))
      .catch(() => {});
    await page
      .evaluate((overlayClass) => {
        document.querySelectorAll(`.${overlayClass}`).forEach((element) => {
          element.remove();
        });
      }, OVERLAY_CLASS)
      .catch(() => {});
  };
}
