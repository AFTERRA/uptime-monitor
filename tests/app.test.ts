import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { AppConfig } from '../src/types.js';

const config: AppConfig = { requestTimeoutMs: 100, maxHistory: 5, maxMonitors: 10 };

describe('uptime monitor API', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp(config);
  });

  afterEach(async () => {
    await app.close();
    vi.unstubAllGlobals();
  });

  it('checks multiple websites concurrently', async () => {
    const resolvers: Array<(response: Response) => void> = [];
    const fetchMock = vi.fn().mockImplementation(() => new Promise<Response>((resolve) => resolvers.push(resolve)));
    vi.stubGlobal('fetch', fetchMock);

    await app.inject({ method: 'POST', url: '/api/monitors', payload: { name: 'One', url: 'https://one.test', intervalSeconds: 30 } });
    await app.inject({ method: 'POST', url: '/api/monitors', payload: { name: 'Two', url: 'https://two.test', intervalSeconds: 30 } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(resolvers).toHaveLength(2);
    resolvers.forEach((resolve) => resolve(new Response('{}', { status: 200 })));

    await vi.waitFor(async () => {
      const response = await app.inject({ method: 'GET', url: '/api/monitors' });
      expect(response.json().monitors.map((monitor: { status: string }) => monitor.status)).toEqual(['up', 'up']);
    });
  });

  it('records HTTP failures and supports a manual check', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 })));
    const created = await app.inject({ method: 'POST', url: '/api/monitors', payload: { name: 'API', url: 'https://api.test/health', intervalSeconds: 30 } });
    const { id } = created.json();

    await vi.waitFor(async () => {
      const response = await app.inject({ method: 'GET', url: '/api/monitors' });
      expect(response.json().monitors[0].status).toBe('down');
    });
    let response = await app.inject({ method: 'GET', url: '/api/monitors' });
    expect(response.json().monitors[0].lastError).toBe('HTTP 503');
    expect(response.json().monitors[0].totalErrors).toBe(1);

    const checked = await app.inject({ method: 'POST', url: `/api/monitors/${id}/check` });
    expect(checked.statusCode).toBe(200);
    expect(checked.json().status).toBe('up');
    expect(checked.json().history).toHaveLength(2);
    expect(checked.json().totalErrors).toBe(1);
  });

  it('counts request timeouts as errors for each monitor', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('Timed out', 'TimeoutError')));
    const created = await app.inject({ method: 'POST', url: '/api/monitors', payload: { name: 'Slow', url: 'https://slow.test', intervalSeconds: 30 } });
    expect(created.json().totalErrors).toBe(0);

    await vi.waitFor(async () => {
      const response = await app.inject({ method: 'GET', url: '/api/monitors' });
      expect(response.json().monitors[0].totalErrors).toBe(1);
    });
    const response = await app.inject({ method: 'GET', url: '/api/monitors' });
    expect(response.json().monitors[0].lastError).toBe('Request timed out after 100 ms');
    expect(response.json().monitors[0].history[0].timedOut).toBe(true);
  });

  it('accepts a website without a protocol and normalizes it to HTTPS', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
    const created = await app.inject({ method: 'POST', url: '/api/monitors', payload: { name: 'Example', url: 'example.com', intervalSeconds: 30 } });
    expect(created.statusCode).toBe(201);
    expect(created.json().url).toBe('https://example.com/');
  });

  it('validates monitor input', async () => {
    const invalidUrl = await app.inject({ method: 'POST', url: '/api/monitors', payload: { name: 'Bad', url: 'file:///tmp/test', intervalSeconds: 30 } });
    expect(invalidUrl.statusCode).toBe(400);
    const invalidInterval = await app.inject({ method: 'POST', url: '/api/monitors', payload: { name: 'Bad', url: 'https://example.com', intervalSeconds: 1 } });
    expect(invalidInterval.statusCode).toBe(400);
  });

  it('removes a monitor and reports unknown IDs', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
    const created = await app.inject({ method: 'POST', url: '/api/monitors', payload: { name: 'Site', url: 'https://example.com', intervalSeconds: 30 } });
    const { id } = created.json();
    const removed = await app.inject({ method: 'DELETE', url: `/api/monitors/${id}` });
    expect(removed.statusCode).toBe(204);
    const missing = await app.inject({ method: 'DELETE', url: `/api/monitors/${id}` });
    expect(missing.statusCode).toBe(404);
  });

  it('serves the dashboard and health endpoint', async () => {
    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.json()).toEqual({ status: 'ok' });
    const dashboard = await app.inject({ method: 'GET', url: '/' });
    expect(dashboard.statusCode).toBe(200);
    expect(dashboard.body).toContain('PULSE');
  });
});
