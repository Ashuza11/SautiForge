import { randomUUID } from 'expo-crypto';

export type EntityStatus = 'active' | 'archived';

export const newId = (): string => randomUUID();
export const nowIso = (): string => new Date().toISOString();

export function nullableText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
