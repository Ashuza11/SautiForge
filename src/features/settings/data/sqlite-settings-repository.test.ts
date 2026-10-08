import { describe, expect, it, vi } from 'vitest';

import { SQLiteSettingsRepository } from './sqlite-settings-repository';

vi.mock('@/domain/common', () => ({ nowIso: () => '2026-10-08T12:00:00.000+02:00' }));

describe('interface language persistence', () => {
  it('defaults to English when no preference has been stored', async () => {
    const repository = new SQLiteSettingsRepository({ getFirstAsync: vi.fn().mockResolvedValue(null) } as never);
    await expect(repository.getInterfaceLanguage()).resolves.toBe('en');
  });

  it('writes and verifies the selected language before returning success', async () => {
    const runAsync = vi.fn().mockResolvedValue({ changes: 1 });
    const getFirstAsync = vi.fn().mockResolvedValue({ value: JSON.stringify('fr') });
    const repository = new SQLiteSettingsRepository({ runAsync, getFirstAsync } as never);

    await expect(repository.setInterfaceLanguage('fr')).resolves.toBe('fr');
    expect(runAsync).toHaveBeenCalledWith(
      expect.stringContaining("VALUES ('interface_language', ?, ?)"),
      JSON.stringify('fr'),
      '2026-10-08T12:00:00.000+02:00',
    );
  });

  it('fails when the stored value cannot be verified', async () => {
    const repository = new SQLiteSettingsRepository({
      runAsync: vi.fn().mockResolvedValue({ changes: 1 }),
      getFirstAsync: vi.fn().mockResolvedValue({ value: JSON.stringify('en') }),
    } as never);
    await expect(repository.setInterfaceLanguage('sw')).rejects.toThrow(/not readable after saving/);
  });
});
