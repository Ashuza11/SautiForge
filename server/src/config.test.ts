import { describe, expect, it } from 'vitest';

import { parseServerConfig } from './config';

const validEnvironment: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  PORT: '9000',
  WEB_ORIGIN: 'https://annotation.example.org',
  DATABASE_URL: 'postgresql://user:password@example.neon.tech/sautiforge?sslmode=require',
  AWS_REGION: 'af-south-1',
  S3_BUCKET: 'sautiforge-test-private',
  ADMIN_API_TOKEN: 'a-secure-test-token-with-32-characters',
};

describe('server configuration', () => {
  it('parses deployment settings without requiring static AWS keys', () => {
    expect(parseServerConfig(validEnvironment)).toMatchObject({
      nodeEnv: 'test',
      port: 9000,
      webOrigin: 'https://annotation.example.org',
      awsRegion: 'af-south-1',
      s3Bucket: 'sautiforge-test-private',
      awsCredentials: undefined,
    });
  });

  it('accepts credentials only as a complete pair', () => {
    expect(() => parseServerConfig({
      ...validEnvironment,
      AWS_ACCESS_KEY_ID: 'test-key',
    })).toThrow(/provided together/i);

    expect(parseServerConfig({
      ...validEnvironment,
      AWS_ACCESS_KEY_ID: 'test-key',
      AWS_SECRET_ACCESS_KEY: 'test-secret',
    }).awsCredentials).toEqual({
      accessKeyId: 'test-key',
      secretAccessKey: 'test-secret',
    });
  });

  it('rejects weak admin tokens and non-PostgreSQL database URLs', () => {
    expect(() => parseServerConfig({ ...validEnvironment, ADMIN_API_TOKEN: 'too-short' })).toThrow();
    expect(() => parseServerConfig({ ...validEnvironment, DATABASE_URL: 'https://example.org' })).toThrow(/PostgreSQL/i);
  });

  it('rejects an origin with a trailing slash so CORS matching is unambiguous', () => {
    expect(() => parseServerConfig({
      ...validEnvironment,
      WEB_ORIGIN: 'https://annotation.example.org/',
    })).toThrow(/trailing slash/i);
  });
});
