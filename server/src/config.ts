import { z } from 'zod';

const optionalNonEmptyString = z.preprocess(
  (value) => value === '' ? undefined : value,
  z.string().trim().min(1).optional(),
);

const serverEnvironmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(8787),
  WEB_ORIGIN: z.string().url().refine((value) => !value.endsWith('/'), {
    message: 'WEB_ORIGIN must not have a trailing slash.',
  }),
  DATABASE_URL: z.string().url().refine((value) => value.startsWith('postgresql://') || value.startsWith('postgres://'), {
    message: 'DATABASE_URL must be a PostgreSQL connection URL.',
  }),
  AWS_REGION: z.string().trim().min(1),
  S3_BUCKET: z.string().trim().min(3).max(63),
  S3_ENDPOINT: optionalNonEmptyString.pipe(z.string().url().optional()),
  S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  AWS_ACCESS_KEY_ID: optionalNonEmptyString,
  AWS_SECRET_ACCESS_KEY: optionalNonEmptyString,
  ADMIN_API_TOKEN: z.string().min(32, 'ADMIN_API_TOKEN must contain at least 32 characters.'),
}).superRefine((environment, context) => {
  const hasAccessKey = environment.AWS_ACCESS_KEY_ID !== undefined;
  const hasSecretKey = environment.AWS_SECRET_ACCESS_KEY !== undefined;
  if (hasAccessKey !== hasSecretKey) {
    context.addIssue({
      code: 'custom',
      path: hasAccessKey ? ['AWS_SECRET_ACCESS_KEY'] : ['AWS_ACCESS_KEY_ID'],
      message: 'AWS access key ID and secret access key must be provided together.',
    });
  }
});

export type ServerConfig = {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  webOrigin: string;
  databaseUrl: string;
  awsRegion: string;
  s3Bucket: string;
  s3Endpoint?: string;
  s3ForcePathStyle: boolean;
  awsCredentials?: {
    accessKeyId: string;
    secretAccessKey: string;
  };
  adminApiToken: string;
};

export function parseServerConfig(environment: NodeJS.ProcessEnv): ServerConfig {
  const parsed = serverEnvironmentSchema.parse(environment);
  return {
    nodeEnv: parsed.NODE_ENV,
    port: parsed.PORT,
    webOrigin: parsed.WEB_ORIGIN,
    databaseUrl: parsed.DATABASE_URL,
    awsRegion: parsed.AWS_REGION,
    s3Bucket: parsed.S3_BUCKET,
    s3Endpoint: parsed.S3_ENDPOINT,
    s3ForcePathStyle: parsed.S3_FORCE_PATH_STYLE,
    awsCredentials: parsed.AWS_ACCESS_KEY_ID && parsed.AWS_SECRET_ACCESS_KEY ? {
      accessKeyId: parsed.AWS_ACCESS_KEY_ID,
      secretAccessKey: parsed.AWS_SECRET_ACCESS_KEY,
    } : undefined,
    adminApiToken: parsed.ADMIN_API_TOKEN,
  };
}
