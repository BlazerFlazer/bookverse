import type { FastifyInstance, FastifyRequest } from 'fastify';
import { saveAtmosphereSchema } from '@bookverse/shared';
import { requireUser } from '../auth/session.ts';
import { HttpError } from '../http.ts';
import { loadAtmosphere, saveAtmosphere } from './service.ts';

/** Гость хранит настройки в браузере: запись на сервере появляется вместе с аккаунтом. */
function requireAccount(request: FastifyRequest) {
  const user = requireUser(request);
  if (user.isGuest) throw new HttpError(403, 'Настройки гостя хранятся в браузере');
  return user;
}

export async function atmosphereRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/atmosphere', async (request) => {
    const stored = request.user && !request.user.isGuest ? await loadAtmosphere(request.user.id) : null;
    return { settings: stored?.settings ?? null };
  });

  app.put('/api/atmosphere', async (request) => {
    const user = requireAccount(request);
    const { settings, utcOffsetMinutes } = saveAtmosphereSchema.parse(request.body);
    await saveAtmosphere(user.id, settings, utcOffsetMinutes);
    return { ok: true };
  });
}
