export type CheckStatus = "new" | "up" | "late" | "down" | "paused";

export type Schedule =
  | { kind: "period"; periodSeconds: number }
  | { kind: "cron"; expression: string; timezone: string };

export type CreateCheckRequest = {
  name: string;
  schedule: Schedule;
  graceSeconds: number;
};

export type CheckDto = {
  id: string;
  name: string;
  pingToken: string;
  schedule: Schedule;
  graceSeconds: number;
  status: CheckStatus;
  lastPingAt: number | null;
  createdAt: number;
  updatedAt: number;
};
