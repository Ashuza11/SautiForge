import type { Project, ProjectDraft } from '../../../src/features/projects/domain/project';
import type { Source, SourceMetadataDraft, SourceRightsDraft, SourceRightsRevision } from '../../../server/src/sources/source';

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

export type ApiProject = { id: string; title: string; languageCode: string; targetLanguage: string };
export type ApiSource = { id: string; title: string; status: string };
export type ApiSourceDetail = { source: Source; latestRights: SourceRightsRevision | null };
export type ApiBatch = {
  batch: { id: string; title: string; status: 'open' | 'closed'; createdAt: string; closedAt: string | null };
  clipIds: string[];
  /** The code at the end of the shared link. */
  token: string;
};
export type { SourceResults } from '../domain/results-view';
export type ClipStatus = 'draft' | 'published' | 'withdrawn';
export type ClipVariant = 'master' | 'listening';
export type ApiClip = {
  clip: {
    id: string;
    clipKey: string;
    startMs: number;
    endMs: number;
    durationMs: number;
    speakerRole: 'narrator' | 'character' | 'multiple' | 'unknown';
    speakerName: string | null;
    hasMusic: boolean;
    tier: 'asr' | 'asr_tts';
    status: ClipStatus;
  };
  files: { variant: ClipVariant; derivedFrom: 'original' | 'cleaned'; status: string; sizeBytes: number }[];
};

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Talks to the SautiForge service with the admin session cookie. */
export class ApiClient {
  constructor(
    private readonly baseUrl = '',
    private readonly fetcher: FetchLike = (input, init) => fetch(input, init),
  ) {}

  async isSignedIn(): Promise<boolean> {
    try {
      await this.request('GET', '/v1/admin/session');
      return true;
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) return false;
      throw cause;
    }
  }

  async login(password: string): Promise<void> {
    await this.request('POST', '/v1/auth/login', { password });
  }

  async logout(): Promise<void> {
    await this.request('POST', '/v1/auth/logout');
  }

  async projects(): Promise<ApiProject[]> {
    return (await this.request<{ projects: ApiProject[] }>('GET', '/v1/admin/projects')).projects;
  }

  async projectList(): Promise<Project[]> {
    return (await this.request<{ projects: Project[] }>('GET', '/v1/admin/projects')).projects;
  }

  async createProject(draft: ProjectDraft): Promise<Project> {
    return (await this.request<{ project: Project }>('POST', '/v1/admin/projects', draft)).project;
  }

  async updateProject(id: string, draft: ProjectDraft): Promise<Project> {
    return (await this.request<{ project: Project }>('PUT', `/v1/admin/projects/${id}`, draft)).project;
  }

  async archiveProject(id: string): Promise<Project> {
    return (await this.request<{ project: Project }>('POST', `/v1/admin/projects/${id}/archive`)).project;
  }

  async sources(projectId: string): Promise<ApiSource[]> {
    return (await this.request<{ sources: ApiSource[] }>('GET', `/v1/admin/projects/${projectId}/sources`)).sources;
  }

  async sourceList(projectId: string): Promise<Source[]> {
    return (await this.request<{ sources: Source[] }>('GET', `/v1/admin/projects/${projectId}/sources?includeInactive=true`)).sources;
  }

  async sourceDetail(sourceId: string): Promise<ApiSourceDetail> {
    return this.request<ApiSourceDetail>('GET', `/v1/admin/sources/${sourceId}`);
  }

  async createSource(projectId: string, draft: SourceMetadataDraft): Promise<Source> {
    return (await this.request<{ source: Source }>('POST', `/v1/admin/projects/${projectId}/sources`, draft)).source;
  }

  async addRights(sourceId: string, draft: SourceRightsDraft): Promise<void> {
    await this.request('POST', `/v1/admin/sources/${sourceId}/rights`, draft);
  }

  async clips(sourceId: string): Promise<ApiClip[]> {
    return (await this.request<{ clips: ApiClip[] }>('GET', `/v1/admin/sources/${sourceId}/clips`)).clips;
  }

  async audioUrl(clipId: string, variant: ClipVariant): Promise<string> {
    const url = (await this.request<{ url: string }>('GET', `/v1/admin/clips/${clipId}/audio/${variant}`)).url;
    return url.startsWith('/') ? `${this.baseUrl}${url}` : url;
  }

  async results(sourceId: string): Promise<import('../domain/results-view').SourceResults> {
    return this.request('GET', `/v1/admin/sources/${sourceId}/results`);
  }

  async batches(sourceId: string): Promise<ApiBatch[]> {
    return (await this.request<{ batches: ApiBatch[] }>('GET', `/v1/admin/sources/${sourceId}/batches`)).batches;
  }

  async createBatch(sourceId: string, clipIds: string[], title?: string): Promise<ApiBatch> {
    return this.request<ApiBatch>('POST', `/v1/admin/sources/${sourceId}/batches`, title ? { clipIds, title } : { clipIds });
  }

  async closeBatch(batchId: string): Promise<ApiBatch> {
    return this.request<ApiBatch>('POST', `/v1/admin/batches/${batchId}/close`);
  }

  /** Sends one FLAC file; the clip is named after the file. Resolves once the clip is published. */
  async uploadClip(sourceId: string, clipKey: string, file: Blob): Promise<ApiClip> {
    return this.request<ApiClip>('POST', `/v1/admin/sources/${sourceId}/clips/upload?clipKey=${encodeURIComponent(clipKey)}`, undefined, { body: file, contentType: 'audio/flac' });
  }

  async withdraw(clipId: string): Promise<void> {
    await this.request('POST', `/v1/admin/clips/${clipId}/withdraw`);
  }

  private async request<T = unknown>(method: string, path: string, body?: unknown, raw?: { body: Blob; contentType: string }): Promise<T> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}${path}`, {
        method,
        credentials: 'include',
        headers: raw ? { 'Content-Type': raw.contentType } : body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: raw ? raw.body : body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError(0, 'network', 'The service could not be reached. Check the connection and try again.');
    }
    const payload = await response.json().catch(() => ({})) as { error?: string; message?: string };
    if (!response.ok) {
      throw new ApiError(response.status, payload.error ?? 'error', friendlyMessage(response.status, payload));
    }
    return payload as T;
  }
}

function friendlyMessage(status: number, payload: { error?: string; message?: string }): string {
  if (payload.error === 'invalid_credentials') return 'Wrong password.';
  if (payload.error === 'too_many_attempts') return 'Too many attempts. Wait a minute and try again.';
  if (payload.error === 'login_not_configured') return 'Login is not set up on the service yet.';
  if (payload.error === 'server_not_configured') return 'The service is not configured yet.';
  if (payload.error === 'file_too_large') return 'The file is larger than 4 MB.';
  if (payload.error === 'unsupported_audio') return payload.message ?? 'This audio file cannot be used.';
  if (payload.error === 'clip_conflict') return payload.message ?? 'A different file with this name was already uploaded.';
  if (payload.error === 'clips_unavailable') return payload.message ?? 'Some clips are no longer available.';
  if (payload.error === 'use_not_authorized') return 'Permission for this recording has not been confirmed yet.';
  if (status === 401) return 'Please sign in.';
  return payload.message ?? `The service answered with an error (${status}).`;
}
