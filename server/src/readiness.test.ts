import { describe, expect, it, vi } from 'vitest';

import type { ProjectRepository } from './projects/project-repository';
import { ReadinessService } from './readiness';
import type { PrivateObjectStore } from './storage/private-object-store';

function dependencies() {
  const projects = {
    ping: vi.fn().mockResolvedValue(undefined),
  } as unknown as ProjectRepository;
  const objectStore = {
    assertReady: vi.fn().mockResolvedValue(undefined),
  } as unknown as PrivateObjectStore;
  return { projects, objectStore };
}

describe('ReadinessService', () => {
  it('is ready only when database and private media storage respond', async () => {
    const { projects, objectStore } = dependencies();
    await expect(new ReadinessService(projects, objectStore).check()).resolves.toEqual({ ready: true });
    expect(projects.ping).toHaveBeenCalledOnce();
    expect(objectStore.assertReady).toHaveBeenCalledOnce();
  });

  it('fails closed without returning infrastructure error details', async () => {
    const { projects, objectStore } = dependencies();
    vi.mocked(objectStore.assertReady).mockRejectedValue(new Error('secret bucket hostname'));
    await expect(new ReadinessService(projects, objectStore).check()).resolves.toEqual({ ready: false });
  });
});
