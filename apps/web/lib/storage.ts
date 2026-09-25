import "server-only";
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { serverEnv } from "@/lib/env";

/**
 * Object storage S3-compatível (Cloudflare R2 em produção, MinIO no dev).
 * Todo acesso é por URL assinada de curta duração — nada é público.
 */
let client: S3Client | null = null;

function s3() {
  if (!client) {
    const env = serverEnv();
    client = new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      forcePathStyle: true,
      credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
    });
  }
  return client;
}

export function presignUpload(key: string, contentType: string, contentLength: number, expiresIn = 900) {
  const cmd = new PutObjectCommand({
    Bucket: serverEnv().S3_BUCKET,
    Key: key,
    ContentType: contentType,
    ContentLength: contentLength,
  });
  return getSignedUrl(s3(), cmd, { expiresIn, signableHeaders: new Set(["content-type", "content-length"]) });
}

export function presignDownload(key: string, opts: { fileName?: string; expiresIn?: number } = {}) {
  const cmd = new GetObjectCommand({
    Bucket: serverEnv().S3_BUCKET,
    Key: key,
    ResponseContentDisposition: opts.fileName
      ? `attachment; filename*=UTF-8''${encodeURIComponent(opts.fileName)}`
      : undefined,
  });
  return getSignedUrl(s3(), cmd, { expiresIn: opts.expiresIn ?? 600 });
}

export async function objectSize(key: string): Promise<number | null> {
  try {
    const head = await s3().send(new HeadObjectCommand({ Bucket: serverEnv().S3_BUCKET, Key: key }));
    return head.ContentLength ?? null;
  } catch {
    return null;
  }
}
