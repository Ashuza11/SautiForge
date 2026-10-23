import {
  GetObjectCommand,
  HeadBucketCommand,
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

export interface PrivateObjectStore {
  assertReady(): Promise<void>;
  createUploadUrl(request: UploadUrlRequest): Promise<string>;
  createDownloadUrl(key: string, expiresInSeconds?: number): Promise<string>;
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
  ) {}

  async assertReady(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }

  createUploadUrl(request: UploadUrlRequest): Promise<string> {
    const key = objectKeySchema.parse(request.key);
    const contentType = mediaTypeSchema.parse(request.contentType);
    const checksumSha256 = checksumSchema.parse(request.checksumSha256);
    const contentLength = contentLengthSchema.parse(request.contentLengthBytes);
    const expiresIn = expirySchema.parse(request.expiresInSeconds ?? 300);
    return getSignedUrl(this.client, new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
      ContentLength: contentLength,
      ChecksumSHA256: checksumSha256,
      ServerSideEncryption: 'AES256',
    }), { expiresIn });
  }

  createDownloadUrl(keyInput: string, expiresInSeconds = 300): Promise<string> {
    const key = objectKeySchema.parse(keyInput);
    const expiresIn = expirySchema.parse(expiresInSeconds);
    return getSignedUrl(this.client, new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    }), { expiresIn });
  }
}

export function createPrivateObjectStore(config: PrivateObjectStoreConfig): PrivateObjectStore {
  const client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    credentials: config.credentials,
  });
  return new S3PrivateObjectStore(client, config.bucket);
}

export function validatePrivateObjectKey(key: string): string {
  return objectKeySchema.parse(key);
}
