export class VolunteerApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

export type BatchInfo = { title: string; clipCount: number; language: string };
export type ClipOffer = { clipId: string; position: number; durationMs: number; audioUrl: string };
export type ListenResult = { position: number; clipCount: number; audioUrl: string };
export type NextResult = { clip: ClipOffer | null; progress: { total: number; answered: number } };

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const MESSAGES: Record<string, string> = {
  link_invalid: 'Ce lien n’est pas valide, ou le lot est fermé. Demandez un nouveau lien.',
  contributor_invalid: 'Veuillez saisir de nouveau votre pseudo.',
  clip_unavailable: 'Cet extrait n’est plus disponible. Nous allons vous en trouver un autre.',
  validation_error: 'Vérifiez votre texte et réessayez.',
  request_too_large: 'C’est trop long. Écrivez un peu moins.',
  use_not_authorized: 'Ce lot n’est pas ouvert aux volontaires pour le moment.',
  server_not_configured: 'Le service n’est pas encore prêt. Réessayez plus tard.',
  too_many_joins: 'Beaucoup de personnes se connectent en ce moment. Réessayez dans quelques minutes.',
  rate_limited: 'Doucement, réessayez dans un instant.',
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

  listen(clipId: string): Promise<ListenResult> {
    return this.post('listen', { link: this.link, clipId });
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
      throw new VolunteerApiError(0, 'network', 'Pas de connexion. Votre texte est gardé. Vérifiez le réseau et réessayez.');
    }
    const payload = await response.json().catch(() => ({})) as { error?: string; message?: string };
    if (!response.ok) {
      const code = payload.error ?? 'error';
      throw new VolunteerApiError(response.status, code, MESSAGES[code] ?? 'Une erreur est survenue. Réessayez.');
    }
    return payload as T;
  }
}
