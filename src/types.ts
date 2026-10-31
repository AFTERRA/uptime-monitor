export type MonitorStatus = 'pending' | 'checking' | 'up' | 'down';

export interface CheckResult {
  checkedAt: string;
  status: 'up' | 'down';
  latencyMs: number;
  statusCode?: number;
  error?: string;
  timedOut?: boolean;
}

export interface Monitor {
  id: string;
  name: string;
  url: string;
  intervalMs: number;
  createdAt: string;
  status: MonitorStatus;
  totalErrors: number;
  lastCheckedAt?: string;
  lastLatencyMs?: number;
  lastStatusCode?: number;
  lastError?: string;
  history: CheckResult[];
}

export interface CreateMonitorInput {
  name: string;
  url: string;
  intervalMs: number;
}

export interface AppConfig {
  requestTimeoutMs: number;
  maxHistory: number;
  maxMonitors: number;
}
