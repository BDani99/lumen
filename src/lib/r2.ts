import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";

export {
  R2_DELETED_MARKER,
  isPlayableVideoUrl,
  isPlayableImageUrl,
  isR2DeletedUrl,
} from "./video-mode";

export function isR2Configured(): boolean {
  return Boolean(
    process.env.R2_ACCOUNT_ID?.trim() &&
      process.env.R2_ACCESS_KEY_ID?.trim() &&
      process.env.R2_SECRET_ACCESS_KEY?.trim() &&
      process.env.R2_BUCKET?.trim() &&
      process.env.R2_PUBLIC_BASE_URL?.trim()
  );
}

function getR2Client(): S3Client {
  const accountId = process.env.R2_ACCOUNT_ID!.trim();
  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!.trim(),
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!.trim(),
    },
  });
}

function bucket(): string {
  return process.env.R2_BUCKET!.trim();
}

function publicBaseUrl(): string {
  return process.env.R2_PUBLIC_BASE_URL!.replace(/\/$/, "");
}

export function sceneVideoKey(
  projectId: string,
  sceneOrder: number,
  clipIndex?: number
): string {
  if (clipIndex != null && clipIndex > 0) {
    return `projects/${projectId}/scene_${sceneOrder + 1}_c${clipIndex + 1}.mp4`;
  }
  return `projects/${projectId}/scene_${sceneOrder + 1}.mp4`;
}

export function sceneImageKey(projectId: string, sceneOrder: number): string {
  return `projects/${projectId}/scene_${sceneOrder + 1}_${Date.now()}.png`;
}

export function thumbnailImageKey(projectId: string): string {
  return `projects/${projectId}/thumbnail_${Date.now()}.png`;
}

export function publicUrlForKey(key: string): string {
  return `${publicBaseUrl()}/${key}`;
}

/** Upload bytes to R2; returns public URL. */
export async function uploadBytesToR2(params: {
  key: string;
  body: Buffer | Uint8Array;
  contentType: string;
}): Promise<string> {
  if (!isR2Configured()) {
    throw new Error("R2 is not configured (missing env vars)");
  }
  const client = getR2Client();
  await client.send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: params.key,
      Body: params.body,
      ContentType: params.contentType,
    })
  );
  return publicUrlForKey(params.key);
}

/** Upload mp4 bytes to R2; returns public URL. */
export async function uploadMp4ToR2(params: {
  key: string;
  body: Buffer | Uint8Array;
  contentType?: string;
}): Promise<string> {
  return uploadBytesToR2({
    key: params.key,
    body: params.body,
    contentType: params.contentType || "video/mp4",
  });
}

/** Upload PNG (or other image) bytes to R2; returns public URL. */
export async function uploadImageToR2(params: {
  key: string;
  body: Buffer | Uint8Array;
  contentType?: string;
}): Promise<string> {
  return uploadBytesToR2({
    key: params.key,
    body: params.body,
    contentType: params.contentType || "image/png",
  });
}

export async function downloadUrlToBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download video (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

/** Download remote mp4 and store on R2. */
export async function mirrorMp4ToR2(params: {
  sourceUrl: string;
  key: string;
}): Promise<string> {
  const body = await downloadUrlToBuffer(params.sourceUrl);
  return uploadMp4ToR2({ key: params.key, body });
}

export async function deleteR2Object(key: string): Promise<void> {
  if (!isR2Configured()) return;
  const client = getR2Client();
  await client.send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
}

export async function deleteR2Prefix(prefix: string): Promise<string[]> {
  if (!isR2Configured()) return [];
  const client = getR2Client();
  const deleted: string[] = [];
  let token: string | undefined;
  do {
    const listed = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket(),
        Prefix: prefix,
        ContinuationToken: token,
      })
    );
    const keys = (listed.Contents || [])
      .map((o) => o.Key)
      .filter((k): k is string => Boolean(k));
    if (keys.length) {
      await client.send(
        new DeleteObjectsCommand({
          Bucket: bucket(),
          Delete: { Objects: keys.map((Key) => ({ Key })) },
        })
      );
      deleted.push(...keys);
    }
    token = listed.IsTruncated ? listed.NextContinuationToken : undefined;
  } while (token);
  return deleted;
}

export type R2ListedObject = { key: string; lastModified: Date };

/** List objects under prefix (paginated). */
export async function listR2Objects(prefix = ""): Promise<R2ListedObject[]> {
  if (!isR2Configured()) return [];
  const client = getR2Client();
  const out: R2ListedObject[] = [];
  let token: string | undefined;
  do {
    const listed = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket(),
        Prefix: prefix,
        ContinuationToken: token,
      })
    );
    for (const o of listed.Contents || []) {
      if (o.Key && o.LastModified) {
        out.push({ key: o.Key, lastModified: o.LastModified });
      }
    }
    token = listed.IsTruncated ? listed.NextContinuationToken : undefined;
  } while (token);
  return out;
}
