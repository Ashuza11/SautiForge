import { randomUUID } from 'node:crypto';

import type { ClipRepository } from '../clips/clip-repository';
import type { PrivateObjectStore } from '../storage/private-object-store';
import type { ProjectService } from '../projects/project-service';
import type { SourceService } from '../sources/source-service';
import type { VolunteerRepository } from '../volunteer/volunteer-repository';
import { finalDraftSchema, type FinalDraft, type FinalTranscript } from './final';
import type { FinalRepository } from './final-repository';

export class FinalError extends Error {
  constructor(readonly code: 'clip_not_found' | 'clip_not_eligible' | 'source_not_found', message: string) {
    super(message);
  }
}

export type ExportClip = {
  clipId: string;
  clipKey: string;
  transcript: string;
  finalVersion: number;
  note: string;
  durationMs: number;
  /** How many different volunteers wrote this clip (nicknames are not exported). */
  transcribers: number;
  sampleRate: number;
  derivedFrom: 'original' | 'cleaned';
  flac: { url: string; sha256: string; sizeBytes: number; pcmSha256: string | null };
};

export type ExportManifest = {
  generatedAt: string;
  project: { id: string; title: string; languageCode: string; targetLanguage: string; languageVariety: string };
  source: { id: string; title: string; originalUrl: string | null; creator: string | null };
  rights: {
    decision: string;
    rightsHolder: string | null;
    license: string | null;
    permissionEvidence: string | null;
    attributionRequirements: string | null;
    authorizedUses: Record<string, boolean>;
  } | null;
  totals: { approved: number; excluded: number; notExported: number; durationMs: number };
  clips: ExportClip[];
};

export type FinalServiceOptions = { idFactory?: () => string; now?: () => Date; downloadSeconds?: number };

/** Final transcripts (versioned, never edited) and the list of approved clips for the dataset export. */
export class FinalService {
  private readonly idFactory: () => string;
  private readonly now: () => Date;
  private readonly downloadSeconds: number;

  constructor(
    private readonly finals: FinalRepository,
    private readonly clips: ClipRepository,
    private readonly volunteer: VolunteerRepository,
    private readonly sources: SourceService,
    private readonly projects: ProjectService,
    private readonly objectStore: PrivateObjectStore,
    options: FinalServiceOptions = {},
  ) {
    this.idFactory = options.idFactory ?? randomUUID;
    this.now = options.now ?? (() => new Date());
    this.downloadSeconds = options.downloadSeconds ?? 900;
  }

  async record(clipId: string, input: FinalDraft, createdBy: string): Promise<FinalTranscript> {
    const draft = finalDraftSchema.parse(input);
    if (!await this.clips.getById(clipId)) throw new FinalError('clip_not_found', 'The clip does not exist.');
    const attempt = () => this.finals.append({
      id: this.idFactory(),
      clipId,
      decision: draft.decision,
      text: draft.text,
      chosenSubmissionId: draft.chosenSubmissionId,
      note: draft.note,
      createdBy,
      createdAt: this.now().toISOString(),
    });
    let saved: FinalTranscript | null;
    try {
      saved = await attempt();
    } catch (error) {
      // Two admins saving the same clip at once: the loser takes the next version number.
      if ((error as { code?: string })?.code !== '23505') throw error;
      saved = await attempt();
    }
    if (!saved) throw new FinalError('clip_not_eligible', 'This clip is not part of a batch, or the chosen answer is not from this clip.');
    return saved;
  }

  async history(clipId: string): Promise<FinalTranscript[]> {
    if (!await this.clips.getById(clipId)) throw new FinalError('clip_not_found', 'The clip does not exist.');
    return this.finals.historyForClip(clipId);
  }

  async manifest(sourceId: string): Promise<ExportManifest> {
    const detail = await this.sources.getDetail(sourceId);
    if (!detail) throw new FinalError('source_not_found', 'The source does not exist.');
    const project = await this.projects.getById(detail.source.projectId);
    const [latest, clips, submissions] = await Promise.all([
      this.finals.latestForSource(sourceId),
      this.clips.listForSource(sourceId),
      this.volunteer.listSubmissionsForSource(sourceId),
    ]);
    const byId = new Map(clips.map((item) => [item.clip.id, item]));

    const approved = latest.filter((item) => item.decision === 'approved' && item.text);
    const exported: ExportClip[] = [];
    let notExported = 0;
    for (const record of approved) {
      const entry = byId.get(record.clipId);
      const master = entry?.files.find((file) => file.variant === 'master' && file.status === 'verified');
      if (!entry || entry.clip.status !== 'published' || !master) { notExported += 1; continue; }
      const people = new Set(submissions.filter((item) => item.clipId === record.clipId && item.kind === 'transcript').map((item) => item.contributorId));
      exported.push({
        clipId: record.clipId,
        clipKey: entry.clip.clipKey,
        transcript: record.text ?? '',
        finalVersion: record.version,
        note: record.note,
        durationMs: entry.clip.durationMs,
        transcribers: people.size,
        sampleRate: master.sampleRate,
        derivedFrom: master.derivedFrom,
        flac: {
          url: await this.objectStore.createDownloadUrl(master.objectKey, this.downloadSeconds),
          sha256: master.sha256,
          sizeBytes: master.sizeBytes,
          pcmSha256: master.pcmSha256,
        },
      });
    }
    exported.sort((a, b) => a.clipKey.localeCompare(b.clipKey, undefined, { numeric: true }));

    const rights = detail.latestRights;
    return {
      generatedAt: this.now().toISOString(),
      project: {
        id: detail.source.projectId,
        title: project?.title ?? '',
        languageCode: project?.languageCode ?? '',
        targetLanguage: project?.targetLanguage ?? '',
        languageVariety: project?.languageVariety ?? '',
      },
      source: { id: detail.source.id, title: detail.source.title, originalUrl: detail.source.originalUrl, creator: detail.source.creator },
      rights: rights ? {
        decision: rights.decision,
        rightsHolder: rights.rightsHolder,
        license: rights.license,
        permissionEvidence: rights.permissionEvidence,
        attributionRequirements: rights.attributionRequirements,
        authorizedUses: { ...rights.authorizedUses },
      } : null,
      // Hours count each clip once, whatever copies of its audio exist.
      totals: {
        approved: exported.length,
        excluded: latest.filter((item) => item.decision === 'excluded').length,
        notExported,
        durationMs: exported.reduce((sum, item) => sum + item.durationMs, 0),
      },
      clips: exported,
    };
  }
}
