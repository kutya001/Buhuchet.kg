import { serve } from '@hono/node-server';
import { createApp } from './app';
import { createRuntime } from './runtime';

// API отдельной программой (вариант для VPS, когда сайт и сервер разделены).
const runtime = createRuntime('web');
const app = createApp(runtime.deps);
const server = serve({ fetch: app.fetch, port: runtime.config.API_PORT }, (info) => {
  runtime.deps.logger.info({ port: info.port }, 'API запущен отдельно');
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => void runtime.close().then(() => process.exit(0)));
  });
}
