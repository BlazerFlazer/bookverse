import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { DEMO_CODE_PATTERN } from '@bookverse/shared';
import { SESSION_COOKIE, userFromToken } from './auth/session.ts';
import { prisma } from './db.ts';
import { demoRoom, stateOf } from './demo/service.ts';

let io: Server | null = null;

function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of header?.split(';') ?? []) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return undefined;
}

export function attachRealtime(server: HttpServer, isAllowedOrigin: (origin: string | undefined) => boolean): Server {
  io = new Server(server, {
    path: '/socket.io',
    cors: { origin: (origin, callback) => callback(null, isAllowedOrigin(origin)), credentials: true },
  });
  io.on('connection', async (socket) => {
    // Комната пользователя определяется только по cookie сессии, а не по данным клиента.
    const session = await userFromToken(readCookie(socket.handshake.headers.cookie, SESSION_COOKIE));
    if (session) await socket.join(`user:${session.user.id}`);

    // Состояние показа публично: в нём нет ни имён, ни верных ответов до закрытия вопроса.
    socket.on('demo:watch', async (code: unknown) => {
      if (typeof code !== 'string' || !DEMO_CODE_PATTERN.test(code)) return;
      const demo = await prisma.demoSession.findUnique({ where: { code } });
      if (!demo) return;
      await socket.join(demoRoom(code));
      socket.emit('demo:state', await stateOf(demo));
    });
  });
  return io;
}

export function broadcast(room: string, event: string, payload: unknown): void {
  io?.to(room).emit(event, payload);
}

export function pushToUser(userId: string, event: string, payload: unknown): void {
  io?.to(`user:${userId}`).emit(event, payload);
}
