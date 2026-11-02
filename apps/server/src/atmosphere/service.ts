import { atmosphereSettingsSchema, DEFAULT_ATMOSPHERE, type AtmosphereSettings } from '@bookverse/shared';
import { prisma } from '../db.ts';

export interface StoredAtmosphere {
  settings: AtmosphereSettings;
  utcOffsetMinutes: number;
}

export async function loadAtmosphere(userId: string): Promise<StoredAtmosphere | null> {
  const row = await prisma.atmospherePreference.findUnique({ where: { userId } });
  if (!row) return null;
  // Значение, которого уже нет в списке, не должно ломать сайт: его заменит настройка по умолчанию.
  const { userId: _owner, utcOffsetMinutes, updatedAt: _updated, ...stored } = row;
  const parsed = atmosphereSettingsSchema.safeParse(stored);
  return { settings: parsed.success ? parsed.data : DEFAULT_ATMOSPHERE, utcOffsetMinutes };
}

export async function saveAtmosphere(userId: string, settings: AtmosphereSettings, utcOffsetMinutes?: number): Promise<void> {
  const data = { ...settings, ...(utcOffsetMinutes === undefined ? {} : { utcOffsetMinutes }) };
  await prisma.atmospherePreference.upsert({ where: { userId }, update: data, create: { userId, ...data } });
}
