import { describe, expect, it } from "vitest";
import { validateCredentials } from "../src/services/authService.js";

const OK_PASSWORD = "correct-horse-battery";

describe("validateCredentials", () => {
  it("accepts a normal username and a long-enough password", () => {
    expect(validateCredentials("plattnericus", OK_PASSWORD)).toBeNull();
  });

  it("accepts dots, hyphens, underscores, and digits in a username", () => {
    expect(validateCredentials("a.b-c_d9", OK_PASSWORD)).toBeNull();
  });

  it("rejects a username shorter than 3 characters", () => {
    expect(validateCredentials("ab", OK_PASSWORD)).not.toBeNull();
  });

  it("rejects a username longer than 32 characters", () => {
    expect(validateCredentials("a".repeat(33), OK_PASSWORD)).not.toBeNull();
  });

  it("rejects a username containing a space", () => {
    expect(validateCredentials("felix plattner", OK_PASSWORD)).not.toBeNull();
  });

  it("rejects a whitespace-only username", () => {
    expect(validateCredentials("   ", OK_PASSWORD)).not.toBeNull();
  });

  it("rejects an empty username", () => {
    expect(validateCredentials("", OK_PASSWORD)).not.toBeNull();
  });

  it("rejects a password under 12 characters, independent of the username", () => {
    expect(validateCredentials("plattnericus", "short")).not.toBeNull();
  });
});
