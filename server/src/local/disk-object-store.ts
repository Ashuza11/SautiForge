import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { Hono } from 'hono';

import {
  validatePrivateObjectKey,
  type PrivateObjectMetadata,
  type PutObjectRequest,
  type PrivateObjectStore,
  type SignedUpload,
  type UploadUrlRequest,
} from '../storage/private-object-store';

type StoredMeta = { contentType: string; checksumSha256: string; sizeBytes: number };

/**
 * Local stand-in for private S3. Upload and download links are signed and expire, the
 * declared SHA-256 and size must match the bytes, and verification reads real metadata.
 */
export class DiskObjectStore implements PrivateObjectStore {
  readonly reportsEncryption = true;

  constructor(
    private readonly directory: string,
    private readonly publicBaseUrl: string,
    private readonly secret: string,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async assertReady(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
  }

  async createUploadUrl(request: UploadUrlRequest): Promise<SignedUpload> {
    const key = validatePrivateObjectKey(request.key);
    const expires = this.now() + (request.expiresInSeconds ?? 300) * 1000;
    const url = this.signedUrl('PUT', key, expires, {
      type: request.contentType,
      sum: request.checksumSha256,
      len: String(request.contentLengthBytes),
    });
    return {
      url,
      headers: {
        'content-type': request.contentType,
        'x-amz-checksum-sha256': request.checksumSha256,
        'x-amz-server-side-encryption': 'AES256',
      },
    };
  }

  async putObject(request: PutObjectRequest): Promise<void> {
    const key = validatePrivateObjectKey(request.key);
    const actual = createHash('sha256').update(request.body).digest('base64');
    if (actual !== request.checksumSha256) throw new Error('The bytes do not match the declared SHA-256.');
    await mkdir(path.dirname(this.objectPath(key)), { recursive: true });
    await writeFile(this.objectPath(key), request.body);
    await writeFile(this.metaPath(key), JSON.stringify({ contentType: request.contentType, checksumSha256: actual, sizeBytes: request.body.length } satisfies StoredMeta));
  }

  async createDownloadUrl(keyInput: string, expiresInSeconds = 300): Promise<string> {
    const key = validatePrivateObjectKey(keyInput);
    return this.signedUrl('GET', key, this.now() + expiresInSeconds * 1000, {});
  }

  async inspectObject(keyInput: string): Promise<PrivateObjectMetadata> {
    const key = validatePrivateObjectKey(keyInput);
    const meta = JSON.parse(await readFile(this.metaPath(key), 'utf8')) as StoredMeta;
    return {
      contentLengthBytes: meta.sizeBytes,
      contentType: meta.contentType,
      checksumSha256: meta.checksumSha256,
      serverSideEncryption: 'AES256',
    };
  }

  /** Routes that accept signed uploads and serve signed downloads. Mount at /local-storage. */
  routes(): Hono {
    const app = new Hono();
    app.all('/*', async (context) => {
      const method = context.req.method;
      if (method !== 'PUT' && method !== 'GET') return context.json({ error: 'method_not_allowed' }, 405);
      const url = new URL(context.req.url);
      const key = decodeURIComponent(url.pathname.replace(/^.*?\/local-storage\//, ''));
      try { validatePrivateObjectKey(key); } catch { return context.json({ error: 'invalid_key' }, 400); }
      const params = Object.fromEntries(url.searchParams);
      const fields = { type: params.type, sum: params.sum, len: params.len };
      const expires = Number(params.expires);
      if (!Number.isFinite(expires) || expires < this.now()) return context.json({ error: 'link_expired' }, 403);
      const signed: Record<string, string> = method === 'PUT'
        ? { type: fields.type ?? '', sum: fields.sum ?? '', len: fields.len ?? '' }
        : {};
      if (!safeEqual(params.sig ?? '', this.signature(method, key, expires, signed))) {
        return context.json({ error: 'invalid_signature' }, 403);
      }

      if (method === 'GET') {
        try {
          const [bytes, meta] = await Promise.all([
            readFile(this.objectPath(key)),
            readFile(this.metaPath(key), 'utf8').then((text) => JSON.parse(text) as StoredMeta),
          ]);
          return new Response(new Uint8Array(bytes), { headers: { 'content-type': meta.contentType, 'cache-control': 'private, no-store' } });
        } catch {
          return context.json({ error: 'not_found' }, 404);
        }
      }

      const body = Buffer.from(await context.req.arrayBuffer());
      const declaredChecksum = context.req.header('x-amz-checksum-sha256');
      if (context.req.header('content-type') !== fields.type) return context.json({ error: 'content_type_mismatch' }, 400);
      if (declaredChecksum !== fields.sum) return context.json({ error: 'checksum_header_mismatch' }, 400);
      if (body.length !== Number(fields.len)) return context.json({ error: 'size_mismatch' }, 400);
      if (context.req.header('x-amz-server-side-encryption') !== 'AES256') return context.json({ error: 'encryption_header_missing' }, 400);
      const actual = createHash('sha256').update(body).digest('base64');
      if (actual !== fields.sum) return context.json({ error: 'checksum_mismatch' }, 400);
      await mkdir(path.dirname(this.objectPath(key)), { recursive: true });
      await writeFile(this.objectPath(key), body);
      await writeFile(this.metaPath(key), JSON.stringify({ contentType: fields.type, checksumSha256: actual, sizeBytes: body.length } satisfies StoredMeta));
      return context.body(null, 200);
    });
    return app;
  }

  async exists(key: string): Promise<boolean> {
    return stat(this.objectPath(key)).then(() => true, () => false);
  }

  private signedUrl(method: string, key: string, expires: number, fields: Record<string, string>): string {
    const query = new URLSearchParams({ ...fields, expires: String(expires), sig: this.signature(method, key, expires, fields) });
    return `${this.publicBaseUrl}/local-storage/${key.split('/').map(encodeURIComponent).join('/')}?${query}`;
  }

  private signature(method: string, key: string, expires: number, fields: Record<string, string>): string {
    const canonical = [method, key, expires, fields.type ?? '', fields.sum ?? '', fields.len ?? ''].join('\n');
    return createHmac('sha256', this.secret).update(canonical).digest('base64url');
  }

  private objectPath(key: string): string {
    const resolved = path.resolve(this.directory, ...key.split('/'));
    if (!resolved.startsWith(path.resolve(this.directory) + path.sep)) throw new Error('Unsafe object key.');
    return resolved;
  }

  private metaPath(key: string): string {
    return `${this.objectPath(key)}.meta.json`;
  }
}

function safeEqual(a: string, b: string): boolean {
  const left = createHash('sha256').update(a).digest();
  const right = createHash('sha256').update(b).digest();
  return timingSafeEqual(left, right);
}
