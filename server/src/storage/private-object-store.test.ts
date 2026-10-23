import { GetObjectCommand, HeadBucketCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { S3PrivateObjectStore, validatePrivateObjectKey } from './private-object-store';

vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: vi.fn() }));

describe('private object storage', () => {
  const send = vi.fn();
  const client = { send } as unknown as S3Client;
  const store = new S3PrivateObjectStore(client, 'private-media');

  beforeEach(() => {
    send.mockReset().mockResolvedValue({});
    vi.mocked(getSignedUrl).mockReset().mockResolvedValue('https://signed.example/object');
  });

  it('checks bucket access without listing or exposing objects', async () => {
    await store.assertReady();
    expect(send).toHaveBeenCalledOnce();
    const command = send.mock.calls[0][0];
    expect(command).toBeInstanceOf(HeadBucketCommand);
    expect(command.input).toEqual({ Bucket: 'private-media' });
  });

  it('signs a checksummed, encrypted upload for at most 15 minutes', async () => {
    await expect(store.createUploadUrl({
      key: 'projects/00000000-0000-4000-8000-000000000001/masters/audio.opus',
      contentType: 'audio/ogg',
      checksumSha256: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      contentLengthBytes: 4096,
      expiresInSeconds: 600,
    })).resolves.toBe('https://signed.example/object');

    const [, command, options] = vi.mocked(getSignedUrl).mock.calls[0];
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toMatchObject({
      Bucket: 'private-media',
      ContentType: 'audio/ogg',
      ContentLength: 4096,
      ChecksumSHA256: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      ServerSideEncryption: 'AES256',
    });
    expect(options).toEqual({ expiresIn: 600 });
  });

  it('signs short-lived downloads but rejects unsafe keys and excessive expiry', async () => {
    await store.createDownloadUrl('projects/project-id/clips/clip-id.opus', 300);
    expect(vi.mocked(getSignedUrl).mock.calls[0][1]).toBeInstanceOf(GetObjectCommand);
    expect(() => validatePrivateObjectKey('../private/audio.opus')).toThrow(/unsafe/i);
    expect(() => validatePrivateObjectKey('/private/audio.opus')).toThrow();
    expect(() => store.createDownloadUrl('safe/audio.opus', 901)).toThrow();
  });
});
