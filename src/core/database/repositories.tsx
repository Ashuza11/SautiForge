import { createContext, type PropsWithChildren, useContext, useMemo } from 'react';
import { useSQLiteContext } from 'expo-sqlite';

import type { ProjectRepository } from '@/features/projects/data/project-repository';
import { SQLiteProjectRepository } from '@/features/projects/data/sqlite-project-repository';
import type { ScenarioRepository } from '@/features/scenarios/data/scenario-repository';
import { SQLiteScenarioRepository } from '@/features/scenarios/data/sqlite-scenario-repository';
import type { ParticipantRepository } from '@/features/participants/data/participant-repository';
import { SQLiteParticipantRepository } from '@/features/participants/data/sqlite-participant-repository';
import type { ConsentRepository } from '@/features/consent/data/consent-repository';
import { SQLiteConsentRepository } from '@/features/consent/data/sqlite-consent-repository';
import type { SessionRepository } from '@/features/sessions/data/session-repository';
import { SQLiteSessionRepository } from '@/features/sessions/data/sqlite-session-repository';
import type { RecordingRepository } from '@/features/recordings/data/recording-repository';
import { SQLiteRecordingRepository } from '@/features/recordings/data/sqlite-recording-repository';
import type { TranscriptionRepository } from '@/features/transcriptions/data/transcription-repository';
import { SQLiteTranscriptionRepository } from '@/features/transcriptions/data/sqlite-transcription-repository';
import type { AnnotationRepository } from '@/features/annotations/data/annotation-repository';
import { SQLiteAnnotationRepository } from '@/features/annotations/data/sqlite-annotation-repository';
import type { DashboardRepository } from '@/features/dashboard/data/dashboard-repository';
import { SQLiteDashboardRepository } from '@/features/dashboard/data/sqlite-dashboard-repository';
import { ExportService } from '@/features/exports/data/export-service';
import type { SettingsRepository } from '@/features/settings/data/settings-repository';
import { SQLiteSettingsRepository } from '@/features/settings/data/sqlite-settings-repository';

type Repositories = {
  projects: ProjectRepository;
  scenarios: ScenarioRepository;
  participants: ParticipantRepository;
  consent: ConsentRepository;
  sessions: SessionRepository;
  recordings: RecordingRepository;
  transcriptions: TranscriptionRepository;
  annotations: AnnotationRepository;
  dashboard: DashboardRepository;
  exports: ExportService;
  settings: SettingsRepository;
};

const RepositoryContext = createContext<Repositories | null>(null);

export function RepositoryProvider({ children }: PropsWithChildren) {
  const db = useSQLiteContext();
  const repositories = useMemo<Repositories>(() => {
    const consent = new SQLiteConsentRepository(db);
    return {
      projects: new SQLiteProjectRepository(db),
      scenarios: new SQLiteScenarioRepository(db),
      participants: new SQLiteParticipantRepository(db),
      consent,
      sessions: new SQLiteSessionRepository(db, consent),
      recordings: new SQLiteRecordingRepository(db, consent),
      transcriptions: new SQLiteTranscriptionRepository(db),
      annotations: new SQLiteAnnotationRepository(db),
      dashboard: new SQLiteDashboardRepository(db),
      exports: new ExportService(db, consent),
      settings: new SQLiteSettingsRepository(db),
    };
  }, [db]);

  return <RepositoryContext.Provider value={repositories}>{children}</RepositoryContext.Provider>;
}

export function useRepositories(): Repositories {
  const repositories = useContext(RepositoryContext);
  if (!repositories) throw new Error('RepositoryProvider is missing.');
  return repositories;
}
