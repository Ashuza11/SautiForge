import type { InterfaceLanguage, StorageRecoveryReport } from '../domain/settings';

export interface SettingsRepository {
  getLastStorageRecovery(): Promise<StorageRecoveryReport | null>;
  getInterfaceLanguage(): Promise<InterfaceLanguage>;
  setInterfaceLanguage(language: InterfaceLanguage): Promise<InterfaceLanguage>;
}
