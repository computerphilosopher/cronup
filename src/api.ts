import type { CheckDto, CreateCheckRequest } from "../shared/domain";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...options, headers: { "content-type": "application/json", ...options?.headers } });
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.error?.message ?? "Request failed");
  return response.status === 204 ? (undefined as T) : response.json() as Promise<T>;
}

export const api = {
  list: () => request<CheckDto[]>("/api/checks"),
  create: (input: CreateCheckRequest) => request<CheckDto>("/api/checks", { method: "POST", body: JSON.stringify(input) }),
  remove: (id: string) => request<void>(`/api/checks/${id}`, { method: "DELETE", body: "{}" }),
  pause: (id: string) => request<void>(`/api/checks/${id}/pause`, { method: "POST", body: "{}" }),
  resume: (id: string) => request<void>(`/api/checks/${id}/resume`, { method: "POST", body: "{}" }),
  slackTest: () => request<{ ok: boolean }>("/api/notifications/slack/test", { method: "POST", body: "{}" }),
};
