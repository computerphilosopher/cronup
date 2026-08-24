export type MonitorStatus = "pending" | "healthy" | "down";

export type CreateMonitorRequest = {
  name: string;
  url: string;
};

export type MonitorDto = {
  id: string;
  name: string;
  url: string;
  status: MonitorStatus;
  createdAt: number;
  updatedAt: number;
  lastCheckedAt: number | null;
  statusCode: number | null;
  latencyMs: number | null;
};
