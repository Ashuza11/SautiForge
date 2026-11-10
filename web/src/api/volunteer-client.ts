export class VolunteerApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

export type BatchInfo = { title: string; clipCount: number; language: string };
export type ClipOffer = { clipId: string; position: number; durationMs: number; audioUrl: string };
export type NextResult = { clip: ClipOffer | null; progress: { total: number; answered: number } };

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const MESSAGES: Record<string, string> = {
  link_invalid: 'This link is not valid, or the batch has closed. Ask for a new link.',
  contributor_invalid: 'Please enter your nickname again.',
  clip_unavailable: 'This clip is no longer available. We will find you another one.',
  validation_error: 'Please check what you typed and try again.',
  request_too_large: 'That is too long. Please write a little less.',
  use_not_authorized: 'This batch is not open for volunteers right now.',
  server_not_configured: 'The service is not ready yet. Please try again later.',
  too_many_joins: 'Many people are joining right now. Please try again in a few minutes.',
  rate_limited: 'Please slow down a little and try again in a moment.',
};

/** Talks to the public volunteer API. No cookies: every call carries the batch link and the personal token. */
export class VolunteerClient {
  constructor(
    private readonly link: string,
    private readonly baseUrl = '',
    private readonly fetcher: FetchLike = (input, init) => fetch(input, init),
  ) {}

  info(): Promise<BatchInfo> {
    return this.post('info', { link: this.link });
  }

  join(pseudonym: string): Promise<{ contributor: { id: string; pseudonym: string }; token: string }> {
    return this.post('join', { link: this.link, pseudonym });
  }

  next(contributor: string): Promise<NextResult> {
    return this.post('next', { link: this.link, contributor });
  }

  async submit(contributor: string, clipId: string, text: string): Promise<void> {
    await this.post('submit', { link: this.link, contributor, clipId, text });
  }

  async skip(contributor: string, clipId: string): Promise<void> {
    await this.post('skip', { link: this.link, contributor, clipId });
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}/v1/volunteer/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      throw new VolunteerApiError(0, 'network', 'No connection. Your text is saved. Check the network and try again.');
    }
    const payload = await response.json().catch(() => ({})) as { error?: string; message?: string };
    if (!response.ok) {
      const code = payload.error ?? 'error';
      throw new VolunteerApiError(response.status, code, MESSAGES[code] ?? 'Something went wrong. Please try again.');
    }
    return payload as T;
  }
}
