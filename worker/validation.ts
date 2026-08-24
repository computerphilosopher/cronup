import type { CreateMonitorRequest } from "../shared/domain";

export class InvalidMonitorRequest extends Error {
  readonly code = "invalid_request" as const;

  constructor(message: string) {
    super(message);
    this.name = "InvalidMonitorRequest";
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.username === "" &&
      url.password === ""
    );
  } catch {
    return false;
  }
}

export function parseCreateMonitorRequest(
  input: unknown,
): CreateMonitorRequest {
  if (!isPlainRecord(input)) {
    throw new InvalidMonitorRequest("Request body must be an object");
  }

  const keys = Object.keys(input).sort();
  if (keys.length !== 2 || keys[0] !== "name" || keys[1] !== "url") {
    throw new InvalidMonitorRequest("Request must contain only name and url");
  }

  if (typeof input.name !== "string" || typeof input.url !== "string") {
    throw new InvalidMonitorRequest("Name and URL must be strings");
  }

  const name = input.name.trim();
  const url = input.url.trim();

  if (name.length < 1 || name.length > 100) {
    throw new InvalidMonitorRequest("Name must be between 1 and 100 characters");
  }

  if (!isHttpUrl(url)) {
    throw new InvalidMonitorRequest(
      "URL must be a credential-free HTTP(S) URL",
    );
  }

  return { name, url };
}
