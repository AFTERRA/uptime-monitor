import { describe, expect, it } from 'vitest';
import { MonitorStore } from '../src/store.js';

describe('MonitorStore', () => {
  it('keeps bounded history and removes monitors', () => {
    const store = new MonitorStore(2, 2);
    const monitor = store.add({ name: 'Site', url: 'https://example.com', intervalMs: 30_000 });
    const result = (latencyMs: number) => ({ checkedAt: new Date().toISOString(), status: 'up' as const, latencyMs });
    store.record(monitor.id, result(10));
    store.record(monitor.id, result(20));
    store.record(monitor.id, result(30));

    expect(store.get(monitor.id)?.history.map((item) => item.latencyMs)).toEqual([20, 30]);
    expect(store.remove(monitor.id)).toBe(true);
    expect(store.get(monitor.id)).toBeUndefined();
  });

  it('enforces the configured monitor limit', () => {
    const store = new MonitorStore(1, 2);
    store.add({ name: 'One', url: 'https://one.test', intervalMs: 30_000 });
    expect(() => store.add({ name: 'Two', url: 'https://two.test', intervalMs: 30_000 })).toThrow('Monitor limit reached');
  });
});
