import type { IncomingMessage, ServerResponse } from 'node:http';
import { buildApp } from './app.ts';
import { initMorphology } from './dictionary/morphology.ts';

const app = await buildApp({ logger: false });
await initMorphology();
await app.ready();

/** На Vercel сервер не слушает порт: запросы передаёт сама платформа. */
export default function handler(request: IncomingMessage, response: ServerResponse): void {
  app.server.emit('request', request, response);
}
