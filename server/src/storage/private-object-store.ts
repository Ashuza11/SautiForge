import {
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { z } from 'zod';

const objectKeySchema = z.string()
  .min(1)
  .max(1024)
  .refine((value) => !value.startsWith('/') && !value.endsWith('/'), 'Object keys cannot start or end with a slash.')
  .refine((value) => !value.includes('\\'), 'Object keys must use forward slashes.')
  .refine((value) => value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..'), 'Object keys contain an unsafe path segment.');

const checksumSchema = z.string().regex(/^[A-Za-z0-9+/]{43}=$/, 'Use a base64-encoded SHA-256 checksum.');
const mediaTypeSchema = z.string().trim().min(1).max(120).regex(/^[\w.+-]+\/[\w.+-]+$/);
const expirySchema = z.number().int().min(30).max(900);
const contentLengthSchema = z.number().int().min(1).max(5 * 1024 * 1024 * 1024);

export type UploadUrlRequest = {
  key: string;
  contentType: string;
  checksumSha256: string;
  contentLengthBytes: number;
  expiresInSeconds?: number;
};

export type SignedUpload = {
  url: string;
  headers: {
    'content-type': string;
    'x-amz-checksum-sha256': string;
    'x-amz-server-side-encryption': 'AES256';
  };
};

export type PutObjectRequest = {
  key: string;
  contentType: string;
  /** Base64 SHA-256 of `body`; the store refuses to keep bytes that do not match. */
  checksumSha256: string;
  body: Uint8Array;
};

export type PrivateObjectMetadata = {
  contentLengthBytes: number;
  contentType: string;
  checksumSha256: string;
  serverSideEncryption: string | null;
};

export interface PrivateObjectStore {
  /**
   * Whether inspectObject reports server-side encryption. Neon Object Storage accepts the
   * header but does not report it back, so the encryption check is skipped for Neon only.
   */
  readonly reportsEncryption: boolean;
  assertReady(): Promise<void>;
  createUploadUrl(request: UploadUrlRequest): Promise<SignedUpload>;
  /** Stores bytes the server already holds (browser uploads are checked first, then written here). */
  putObject(request: PutObjectRequest): Promise<void>;
  createDownloadUrl(key: string, expiresInSeconds?: number): Promise<string>;
  inspectObject(key: string): Promise<PrivateObjectMetadata>;
}

export type PrivateObjectStoreConfig = {
  region: string;
  bucket: string;
  endpoint?: string;
  forcePathStyle?: boolean;
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
  };
};

export class S3PrivateObjectStore implements PrivateObjectStore {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
    readonly reportsEncryption = true,
  ) {}

  async assertReady(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }

  async createUploadUrl(request: UploadUrlRequest): Promise<SignedUpload> {
    const key = objectKeySchema.parse(request.key);
    const contentType = mediaTypeSchema.parse(request.contentType);
    const checksumSha256 = checksumSchema.parse(request.checksumSha256);
    const contentLength = contentLengthSchema.parse(request.contentLengthBytes);
    const expiresIn = expirySchema.parse(request.expiresInSeconds ?? 300);
    const url = await getSignedUrl(this.client, new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
      ContentLength: contentLength,
      ChecksumSHA256: checksumSha256,
      ServerSideEncryption: 'AES256',
    }), { expiresIn });
    return {
      url,
      headers: {
        'content-type': contentType,
        'x-amz-checksum-sha256': checksumSha256,
        'x-amz-server-side-encryption': 'AES256',
      },
    };
  }

  async putObject(request: PutObjectRequest): Promise<void> {
    const key = objectKeySchema.parse(request.key);
    const contentType = mediaTypeSchema.parse(request.contentType);
    const checksumSha256 = checksumSchema.parse(request.checksumSha256);
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: request.body,
      ContentType: contentType,
      ContentLength: contentLengthSchema.parse(request.body.length),
      ChecksumSHA256: checksumSha256,
      ServerSideEncryption: 'AES256',
    }));
  }

  createDownloadUrl(keyInput: string, expiresInSeconds = 300): Promise<string> {
    const key = objectKeySchema.parse(keyInput);
    const expiresIn = expirySchema.parse(expiresInSeconds);
    return getSignedUrl(this.client, new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    }), { expiresIn });
  }

  async inspectObject(keyInput: string): Promise<PrivateObjectMetadata> {
    const key = objectKeySchema.parse(keyInput);
    const response = await this.client.send(new HeadObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ChecksumMode: 'ENABLED',
    }));
    if (
      response.ContentLength === undefined ||
      !response.ContentType ||
      !response.ChecksumSHA256
    ) {
      throw new Error('The object does not expose the required size, media type, and SHA-256 checksum.');
    }
    return {
      contentLengthBytes: response.ContentLength,
      contentType: response.ContentType,
      checksumSha256: response.ChecksumSHA256,
      serverSideEncryption: response.ServerSideEncryption ?? null,
    };
  }
}

export function createPrivateObjectStore(config: PrivateObjectStoreConfig): PrivateObjectStore {
  const client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    credentials: config.credentials,
  });
  return new S3PrivateObjectStore(client, config.bucket, !isNeonEndpoint(config.endpoint));
}

export function isNeonEndpoint(endpoint: string | undefined): boolean {
  if (!endpoint) return false;
  try {
    return new URL(endpoint).hostname.endsWith('.neon.tech');
  } catch {
    return false;
  }
}

export function validatePrivateObjectKey(key: string): string {
  return objectKeySchema.parse(key);
}
