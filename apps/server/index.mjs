// Точка входа на Vercel: сборщик находит её по импорту fastify, а сам сервер уже собран в dist.
import 'fastify';

// Это не секреты, поэтому они записаны здесь. Значения из настроек проекта важнее.
process.env.PUBLIC_WEB_URL ??= 'https://blazverse.vercel.app';
process.env.TRUST_PROXY_HOPS ??= '1';

// Словари морфологии открываются по вычисляемому пути, эта ссылка включает их в функцию.
new URL('../../node_modules/az/dicts/', import.meta.url);

const { default: handler } = await import('./dist/vercel.mjs');
export default handler;
