import { describe, expect, it } from "vitest";
import {
  InvalidMonitorRequest,
  isHttpUrl,
  parseCreateMonitorRequest,
} from "../worker/validation";

function expectInvalid(input: unknown) {
  expect(() => parseCreateMonitorRequest(input)).toThrowError(
    InvalidMonitorRequest,
  );

  try {
    parseCreateMonitorRequest(input);
  } catch (error) {
    expect(error).toMatchObject({ code: "invalid_request" });
    return;
  }

  throw new Error("Expected monitor request to be rejected");
}

describe("parseCreateMonitorRequest", () => {
  it("trims and accepts a credential-free HTTP(S) request", () => {
    expect(
      parseCreateMonitorRequest({
        name: "  Public website  ",
        url: "  https://example.com/health  ",
      }),
    ).toEqual({
      name: "Public website",
      url: "https://example.com/health",
    });
  });

  it.each([undefined, null, [], "request", 1])(
    "rejects a non-object body: %j",
    expectInvalid,
  );

  it.each([
    {},
    { name: "Website" },
    { url: "https://example.com" },
    { name: "Website", url: "https://example.com", status: "healthy" },
    { name: "Website", url: "https://example.com", token: "secret" },
  ])("rejects missing or unknown fields: %j", expectInvalid);

  it.each([
    { name: 1, url: "https://example.com" },
    { name: "Website", url: 1 },
    { name: "   ", url: "https://example.com" },
    { name: "x".repeat(101), url: "https://example.com" },
  ])("rejects invalid field values: %j", expectInvalid);

  it.each([
    "",
    "not a URL",
    "ftp://example.com",
    "https://user@example.com",
    "https://user:password@example.com",
  ])("rejects an unsupported URL: %s", (url) => {
    expectInvalid({ name: "Website", url });
  });
});

describe("isHttpUrl", () => {
  it.each([
    "http://example.com",
    "https://example.com/health?full=true",
  ])("accepts %s", (url) => {
    expect(isHttpUrl(url)).toBe(true);
  });

  it.each([
    "not a URL",
    "ftp://example.com",
    "https://user@example.com",
    "https://user:password@example.com",
  ])("rejects %s", (url) => {
    expect(isHttpUrl(url)).toBe(false);
  });
});
