import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { CheckInProgressError, MonitorChecker } from './checker.js';
import { MonitorLimitError, MonitorStore } from './store.js';
import type { AppConfig, CreateMonitorInput } from './types.js';

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getConfig(): AppConfig {
  return {
    requestTimeoutMs: positiveNumber(process.env.REQUEST_TIMEOUT_MS, 5000),
    maxHistory: positiveNumber(process.env.MAX_HISTORY, 30),
    maxMonitors: positiveNumber(process.env.MAX_MONITORS, 100)
  };
}

function parseInput(body: unknown): { input?: CreateMonitorInput; error?: string } {
  if (!body || typeof body !== 'object') return { error: 'A JSON request body is required' };
  const value = body as Record<string, unknown>;
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  const url = typeof value.url === 'string' ? value.url.trim() : '';
  const intervalSeconds = Number(value.intervalSeconds ?? 30);

  if (!name || name.length > 80) return { error: 'name must contain between 1 and 80 characters' };
  const normalizedUrl = /^[a-z][a-z\d+.-]*:\/\//i.test(url) ? url : `https://${url}`;
  let parsed: URL;
  try {
    parsed = new URL(normalizedUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error();
  } catch {
    return { error: 'url must be a valid website address' };
  }
  if (!Number.isInteger(intervalSeconds) || intervalSeconds < 5 || intervalSeconds > 3600) {
    return { error: 'intervalSeconds must be an integer between 5 and 3600' };
  }

  return { input: { name, url: parsed.toString(), intervalMs: intervalSeconds * 1000 } };
}

export async function buildApp(config: AppConfig = getConfig(), logger = false): Promise<FastifyInstance> {
  const app = Fastify({ logger });
  const store = new MonitorStore(config.maxMonitors, config.maxHistory);
  const checker = new MonitorChecker(store, config);

  app.get('/health', async () => ({ status: 'ok' }));
  app.get('/api/monitors', async () => ({ monitors: store.list() }));

  app.post('/api/monitors', async (request, reply) => {
    const parsed = parseInput(request.body);
    if (!parsed.input) return reply.code(400).send({ error: parsed.error });
    try {
      const monitor = checker.add(parsed.input);
      return reply.code(201).send(monitor);
    } catch (error) {
      if (error instanceof MonitorLimitError) return reply.code(409).send({ error: error.message });
      throw error;
    }
  });

  app.post('/api/monitors/:id/check', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!store.get(id)) return reply.code(404).send({ error: 'Monitor not found' });
    try {
      await checker.check(id);
      return store.get(id);
    } catch (error) {
      if (error instanceof CheckInProgressError) return reply.code(409).send({ error: error.message });
      throw error;
    }
  });

  app.delete('/api/monitors/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!checker.remove(id)) return reply.code(404).send({ error: 'Monitor not found' });
    return reply.code(204).send();
  });

  app.get('/demo/healthy', async () => ({ status: 'healthy', at: new Date().toISOString() }));
  app.get('/demo/slow', async () => {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    return { status: 'healthy', delayed: true };
  });
  app.get('/demo/failing', async (_request, reply) => reply.code(503).send({ status: 'unavailable' }));

  app.addHook('onClose', async () => checker.close());
  await app.register(fastifyStatic, { root: path.join(process.cwd(), 'public'), prefix: '/' });
  return app;
}
