import { randomUUID } from 'node:crypto';
import type { CheckResult, CreateMonitorInput, Monitor } from './types.js';

export class MonitorLimitError extends Error {}

export class MonitorStore {
  private readonly monitors = new Map<string, Monitor>();

  constructor(private readonly maxMonitors: number, private readonly maxHistory: number) {}

  add(input: CreateMonitorInput): Monitor {
    if (this.monitors.size >= this.maxMonitors) throw new MonitorLimitError('Monitor limit reached');
    const monitor: Monitor = {
      id: randomUUID(),
      ...input,
      createdAt: new Date().toISOString(),
      status: 'pending',
      totalErrors: 0,
      history: []
    };
    this.monitors.set(monitor.id, monitor);
    return monitor;
  }

  get(id: string): Monitor | undefined {
    return this.monitors.get(id);
  }

  list(): Monitor[] {
    return [...this.monitors.values()];
  }

  remove(id: string): boolean {
    return this.monitors.delete(id);
  }

  record(id: string, result: CheckResult): void {
    const monitor = this.monitors.get(id);
    if (!monitor) return;
    monitor.status = result.status;
    monitor.lastCheckedAt = result.checkedAt;
    monitor.lastLatencyMs = result.latencyMs;
    monitor.lastStatusCode = result.statusCode;
    monitor.lastError = result.error;
    if (result.status === 'down') monitor.totalErrors += 1;
    monitor.history.push(result);
    if (monitor.history.length > this.maxHistory) monitor.history.shift();
  }
}
