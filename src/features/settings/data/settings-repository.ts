import type { StorageRecoveryReport } from '../domain/settings';

export interface SettingsRepository {
  getLastStorageRecovery(): Promise<StorageRecoveryReport | null>;
}
