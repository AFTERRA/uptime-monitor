import { buildApp } from './app.js';

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const port = Number(argument('--port') ?? process.env.PORT ?? 3000);
const host = argument('--host') ?? process.env.HOST ?? '0.0.0.0';
const app = await buildApp(undefined, true);

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
