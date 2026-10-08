import type { SQLiteDatabase } from 'expo-sqlite';

import { nowIso } from '@/domain/common';
import { interfaceLanguageSchema, storageRecoveryReportSchema, type InterfaceLanguage, type StorageRecoveryReport } from '../domain/settings';
import type { SettingsRepository } from './settings-repository';

export class SQLiteSettingsRepository implements SettingsRepository {
  constructor(private readonly db: SQLiteDatabase) {}

  async getLastStorageRecovery(): Promise<StorageRecoveryReport | null> {
    const row = await this.db.getFirstAsync<{ value: string }>("SELECT value FROM app_settings WHERE key = 'last_storage_recovery'");
    return row ? storageRecoveryReportSchema.parse(JSON.parse(row.value)) : null;
  }

  async getInterfaceLanguage(): Promise<InterfaceLanguage> {
    const row = await this.db.getFirstAsync<{ value: string }>("SELECT value FROM app_settings WHERE key = 'interface_language'");
    return row ? interfaceLanguageSchema.parse(JSON.parse(row.value)) : 'en';
  }

  async setInterfaceLanguage(input: InterfaceLanguage): Promise<InterfaceLanguage> {
    const language = interfaceLanguageSchema.parse(input);
    await this.db.runAsync(
      `INSERT INTO app_settings (key, value, updated_at) VALUES ('interface_language', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      JSON.stringify(language),
      nowIso(),
    );
    const verified = await this.getInterfaceLanguage();
    if (verified !== language) throw new Error('The interface language was not readable after saving.');
    return verified;
  }
}
