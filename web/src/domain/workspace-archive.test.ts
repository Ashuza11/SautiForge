import { describe, expect, it } from 'vitest';

import { WorkspaceArchiveRepository, type StoredWorkspaceArchive, type WorkspaceArchiveStorage } from './workspace-archive';

const archive: StoredWorkspaceArchive = {
  fileName: 'pilot.zip',
  bytes: new Uint8Array([1, 2, 3]).buffer,
  savedAt: '2026-10-15T10:00:00.000Z',
};

describe('saved browser workspace', () => {
  it('writes, verifies, reloads and clears the research ZIP', async () => {
    const repository = new WorkspaceArchiveRepository(new MemoryArchiveStorage());
    await expect(repository.save(archive)).resolves.toMatchObject({ fileName: 'pilot.zip' });
    await expect(repository.load()).resolves.toMatchObject({ fileName: 'pilot.zip' });
    await repository.clear();
    await expect(repository.load()).resolves.toBeNull();
  });

  it('does not claim persistence when the browser silently drops the ZIP', async () => {
    const repository = new WorkspaceArchiveRepository(new SilentArchiveStorage());
    await expect(repository.save(archive)).rejects.toThrow(/not readable after saving/);
  });

  it('rejects malformed persisted workspaces', async () => {
    const storage = new MemoryArchiveStorage();
    await storage.write({ ...archive, fileName: 'audio.opus' });
    await expect(new WorkspaceArchiveRepository(storage).load()).rejects.toThrow(/invalid/);
  });
});

class MemoryArchiveStorage implements WorkspaceArchiveStorage {
  private archive: StoredWorkspaceArchive | null = null;
  async read() { return this.archive; }
  async write(archiveValue: StoredWorkspaceArchive) { this.archive = archiveValue; }
  async remove() { this.archive = null; }
}

class SilentArchiveStorage implements WorkspaceArchiveStorage {
  async read() { return null; }
  async write() {}
  async remove() {}
}
