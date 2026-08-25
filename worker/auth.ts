import { jsonError } from "./errors";

const ADMIN_USERNAME = "admin";
const BASIC_REALM = 'Basic realm="CronUp"';
const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function isAuthorized(
  request: Request,
  configuredSecret: string | undefined,
): boolean {
  if (!configuredSecret) {
    return false;
  }

  const header = request.headers.get("Authorization");
  if (!header) {
    return false;
  }

  const match = /^Basic\s+(.+)$/i.exec(header);
  if (!match) {
    return false;
  }

  try {
    const decoded = atob(match[1]);
    const separator = decoded.indexOf(":");
    if (separator < 0) {
      return false;
    }

    return (
      decoded.slice(0, separator) === ADMIN_USERNAME &&
      decoded.slice(separator + 1) === configuredSecret
    );
  } catch {
    return false;
  }
}

export function unauthorizedResponse(): Response {
  const response = jsonError("unauthorized", "Authentication required", 401);
  response.headers.set("WWW-Authenticate", BASIC_REALM);
  return response;
}

export function isJsonMutation(request: Request): boolean {
  if (!MUTATION_METHODS.has(request.method.toUpperCase())) {
    return true;
  }

  const contentType = request.headers.get("Content-Type");
  const mediaType = contentType?.split(";", 1)[0].trim().toLowerCase();
  if (mediaType !== "application/json") {
    return false;
  }

  const origin = request.headers.get("Origin");
  return origin !== null && origin === new URL(request.url).origin;
}
