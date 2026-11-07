import { createHmac, timingSafeEqual } from 'node:crypto';

export const adminSessionCookieName = 'sf_admin';

export type AdminSessionOptions = {
  password: string;
  secret: string;
  ttlSeconds?: number;
  now?: () => Date;
  maxFailedAttempts?: number;
  lockoutSeconds?: number;
};

const defaultTtlSeconds = 8 * 60 * 60;

/**
 * Stateless admin session: a signed expiry timestamp in an HttpOnly cookie.
 * The password and the signing secret never reach the browser.
 */
export class AdminSessionService {
  private readonly ttlSeconds: number;
  private readonly now: () => Date;
  private readonly maxFailedAttempts: number;
  private readonly lockoutMs: number;
  private failures = 0;
  private lockedUntil = 0;

  constructor(private readonly options: AdminSessionOptions) {
    this.ttlSeconds = options.ttlSeconds ?? defaultTtlSeconds;
    this.now = options.now ?? (() => new Date());
    this.maxFailedAttempts = options.maxFailedAttempts ?? 5;
    this.lockoutMs = (options.lockoutSeconds ?? 60) * 1000;
  }

  get maxAgeSeconds(): number {
    return this.ttlSeconds;
  }

  /** Returns a session token, or null when the password is wrong or logins are locked. */
  login(password: string): { token: string } | { locked: true } | null {
    const nowMs = this.now().getTime();
    if (nowMs < this.lockedUntil) return { locked: true };
    if (!safeEqual(password, this.options.password)) {
      this.failures += 1;
      if (this.failures >= this.maxFailedAttempts) {
        this.failures = 0;
        this.lockedUntil = nowMs + this.lockoutMs;
      }
      return null;
    }
    this.failures = 0;
    return { token: this.sign(Math.floor(nowMs / 1000) + this.ttlSeconds) };
  }

  verify(token: string | undefined): boolean {
    if (!token) return false;
    const [expiry, signature] = token.split('.');
    if (!expiry || !signature || !/^\d+$/.test(expiry)) return false;
    if (!safeEqual(signature, this.signature(expiry))) return false;
    return Number(expiry) > Math.floor(this.now().getTime() / 1000);
  }

  private sign(expirySeconds: number): string {
    const expiry = String(expirySeconds);
    return `${expiry}.${this.signature(expiry)}`;
  }

  private signature(expiry: string): string {
    return createHmac('sha256', this.options.secret).update(`admin:${expiry}`).digest('base64url');
  }
}

function safeEqual(candidate: string, expected: string): boolean {
  const a = createHmac('sha256', 'cmp').update(candidate).digest();
  const b = createHmac('sha256', 'cmp').update(expected).digest();
  return timingSafeEqual(a, b);
}
