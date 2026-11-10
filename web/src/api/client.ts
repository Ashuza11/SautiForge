import type { Project, ProjectDraft } from '../../../src/features/projects/domain/project';

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

export type ApiProject = { id: string; title: string; languageCode: string; targetLanguage: string };
export type ApiSource = { id: string; title: string; status: string };
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

  async clips(sourceId: string): Promise<ApiClip[]> {
    return (await this.request<{ clips: ApiClip[] }>('GET', `/v1/admin/sources/${sourceId}/clips`)).clips;
  }

  async audioUrl(clipId: string, variant: ClipVariant): Promise<string> {
    const url = (await this.request<{ url: string }>('GET', `/v1/admin/clips/${clipId}/audio/${variant}`)).url;
    return url.startsWith('/') ? `${this.baseUrl}${url}` : url;
  }

  async withdraw(clipId: string): Promise<void> {
    await this.request('POST', `/v1/admin/clips/${clipId}/withdraw`);
  }

  private async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}${path}`, {
        method,
        credentials: 'include',
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
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
  if (status === 401) return 'Please sign in.';
  return payload.message ?? `The service answered with an error (${status}).`;
}
