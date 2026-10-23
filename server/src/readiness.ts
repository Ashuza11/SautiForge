import type { ProjectRepository } from './projects/project-repository';
import type { PrivateObjectStore } from './storage/private-object-store';

export type Readiness = {
  ready: boolean;
};

export class ReadinessService {
  constructor(
    private readonly projects: ProjectRepository,
    private readonly objectStore: PrivateObjectStore,
  ) {}

  async check(): Promise<Readiness> {
    try {
      await Promise.all([
        this.projects.ping(),
        this.objectStore.assertReady(),
      ]);
      return { ready: true };
    } catch {
      return { ready: false };
    }
  }
}
