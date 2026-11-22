import { describe, expect, it } from "vitest";
import { redactObject, redactText } from "./pii-redactor.js";

describe("redactText", () => {
  it("redacts JWTs", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const result = redactText(`Authorization: Bearer ${jwt}`);
    expect(result.count).toBeGreaterThan(0);
    expect(result.text).not.toContain(jwt);
    expect(result.text).toContain("[REDACTED]");
  });

  it("redacts gsk_ API keys", () => {
    const key = "gsk_1Ab2Cd3Ef4Gh5Ij6Kl7Mn8Op9Qr0St";
    const result = redactText(`api_key: ${key}`);
    expect(result.count).toBeGreaterThan(0);
    expect(result.text).not.toContain(key);
  });

  it("redacts sk-or-v1 API keys", () => {
    const key = "sk-or-v1-a1b2c3d4e5f60718293a4b5c6d7e8f90";
    const result = redactText(` OPENROUTER_API_KEY=${key} `);
    expect(result.count).toBeGreaterThan(0);
    expect(result.text).not.toContain(key);
  });

  it("redacts card numbers with separators", () => {
    const card = "4111 1111 1111 1111";
    const result = redactText(`card: ${card}`);
    expect(result.count).toBeGreaterThan(0);
    expect(result.text).not.toContain("4111");
  });

  it("redacts SSNs", () => {
    const result = redactText("SSN 123-45-6789 on file");
    expect(result.count).toBeGreaterThan(0);
    expect(result.text).not.toContain("123-45-6789");
  });

  it("redacts password assignments", () => {
    const fromQuery = redactText("?user=alice&password=hunter2&next=/home");
    expect(fromQuery.count).toBeGreaterThan(0);
    expect(fromQuery.text).not.toContain("hunter2");

    const fromJson = redactText('{"password":"s3cr3t","theme":"dark"}');
    expect(fromJson.count).toBeGreaterThan(0);
    expect(fromJson.text).not.toContain("s3cr3t");
    expect(fromJson.text).toContain("dark");
  });

  it("only redacts emails when a secret is present", () => {
    const plain = redactText("Contact support@example.com for details");
    expect(plain.text).toBe("Contact support@example.com for details");
    expect(plain.count).toBe(0);

    const withSecret = redactText(
      "support@example.com used gsk_1Ab2Cd3Ef4Gh5Ij6Kl7Mn8Op9Qr0St",
    );
    expect(withSecret.count).toBeGreaterThan(1);
    expect(withSecret.text).not.toContain("support@example.com");
  });
});

describe("redactObject", () => {
  it("redacts nested string leaves without mutating the input", () => {
    const input = {
      note: "token gsk_1Ab2Cd3Ef4Gh5Ij6Kl7Mn8Op9Qr0St",
      nested: { title: "Fine", values: ["ok", "SSN 123-45-6789"] },
      keep: 42,
    };
    const result = redactObject(input);
    expect(result.count).toBeGreaterThan(0);
    expect(result.value.note).not.toContain("gsk_");
    expect(result.value.nested.values[1]).not.toContain("123-45-6789");
    expect(result.value.nested.title).toBe("Fine");
    expect(result.value.keep).toBe(42);
    expect(input.note).toContain("gsk_");
    expect(input.nested.values[1]).toContain("123-45-6789");
  });

  it("handles a top-level string", () => {
    const result = redactObject("password=letmein");
    expect(result.value).toBe("[REDACTED]");
    expect(result.count).toBe(1);
  });
});
