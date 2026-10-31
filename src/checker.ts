import { MonitorStore } from './store.js';
import type { AppConfig, CreateMonitorInput, Monitor } from './types.js';

export class CheckInProgressError extends Error {}

export class MonitorChecker {
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly active = new Set<string>();
  private closed = false;

  constructor(private readonly store: MonitorStore, private readonly config: AppConfig) {}

  add(input: CreateMonitorInput): Monitor {
    const monitor = this.store.add(input);
    const timer = setInterval(() => {
      void this.check(monitor.id).catch(() => undefined);
    }, monitor.intervalMs);
    timer.unref();
    this.timers.set(monitor.id, timer);
    void this.check(monitor.id).catch(() => undefined);
    return monitor;
  }

  remove(id: string): boolean {
    const timer = this.timers.get(id);
    if (timer) clearInterval(timer);
    this.timers.delete(id);
    return this.store.remove(id);
  }

  async check(id: string): Promise<void> {
    const monitor = this.store.get(id);
    if (!monitor || this.closed) return;
    if (this.active.has(id)) throw new CheckInProgressError('A check is already running');

    this.active.add(id);
    monitor.status = 'checking';
    const startedAt = performance.now();
    let statusCode: number | undefined;
    let error: string | undefined;
    let timedOut = false;
    let status: 'up' | 'down' = 'up';

    try {
      const response = await fetch(monitor.url, {
        method: 'GET',
        redirect: 'follow',
        headers: { 'user-agent': 'UptimeMonitor/1.0', accept: '*/*' },
        signal: AbortSignal.timeout(this.config.requestTimeoutMs)
      });
      statusCode = response.status;
      await response.body?.cancel();
      if (!response.ok) {
        status = 'down';
        error = `HTTP ${response.status}`;
      }
    } catch (caught) {
      status = 'down';
      timedOut = caught instanceof Error && (caught.name === 'TimeoutError' || caught.name === 'AbortError');
      error = timedOut
        ? `Request timed out after ${this.config.requestTimeoutMs} ms`
        : caught instanceof Error ? caught.message : 'Unknown connection error';
    } finally {
      this.active.delete(id);
    }

    this.store.record(id, {
      checkedAt: new Date().toISOString(),
      status,
      latencyMs: Math.round(performance.now() - startedAt),
      statusCode,
      error,
      timedOut
    });
  }

  close(): void {
    this.closed = true;
    for (const timer of this.timers.values()) clearInterval(timer);
    this.timers.clear();
  }
}
