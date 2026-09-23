import type { SQLiteDatabase } from 'expo-sqlite';

import { storageRecoveryReportSchema, type StorageRecoveryReport } from '../domain/settings';
import type { SettingsRepository } from './settings-repository';

export class SQLiteSettingsRepository implements SettingsRepository {
  constructor(private readonly db: SQLiteDatabase) {}

  async getLastStorageRecovery(): Promise<StorageRecoveryReport | null> {
    const row = await this.db.getFirstAsync<{ value: string }>("SELECT value FROM app_settings WHERE key = 'last_storage_recovery'");
    return row ? storageRecoveryReportSchema.parse(JSON.parse(row.value)) : null;
  }
}
