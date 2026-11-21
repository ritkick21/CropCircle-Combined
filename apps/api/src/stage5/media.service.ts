import { BadRequestException, ForbiddenException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { CreateBucketCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import { fileMatchesType } from '../config/file-content';
import { PrismaService } from '../prisma/prisma.service';

const extensions: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

function storage(endpoint?: string) {
  const { S3_REGION, S3_ACCESS_KEY, S3_SECRET_KEY } = process.env;
  return new S3Client({
    region: S3_REGION ?? 'us-east-1',
    endpoint,
    forcePathStyle: Boolean(endpoint),
    requestChecksumCalculation: 'WHEN_REQUIRED',
    ...(S3_ACCESS_KEY && S3_SECRET_KEY
      ? { credentials: { accessKeyId: S3_ACCESS_KEY, secretAccessKey: S3_SECRET_KEY } }
      : {}),
  });
}

@Injectable()
export class MediaService {
  private readonly bucket = process.env.S3_BUCKET;
  private readonly internal = storage(process.env.S3_ENDPOINT);
  private readonly downloads = process.env.S3_PUBLIC_ENDPOINT
    ? storage(process.env.S3_PUBLIC_ENDPOINT)
    : this.internal;
  private bucketReady?: Promise<void>;

  constructor(private readonly db: PrismaService) {}

  private async ensureBucket(bucket: string) {
    if (process.env.S3_AUTO_CREATE_BUCKET !== 'true') return;
    this.bucketReady ??= (async () => {
      try {
        await this.internal.send(new HeadBucketCommand({ Bucket: bucket }));
      } catch (error) {
        if (!(error instanceof Error) || error.name !== 'NotFound') throw error;
        await this.internal.send(new CreateBucketCommand({ Bucket: bucket }));
      }
    })().catch((error: unknown) => {
      this.bucketReady = undefined;
      throw error;
    });
    await this.bucketReady;
  }

  async upload(userId: string, file?: { buffer: Buffer; mimetype: string }) {
    if (!file || file.buffer.length > 5_000_000 || !fileMatchesType(file.buffer, file.mimetype))
      throw new BadRequestException('Upload a JPEG, PNG, WebP or PDF file under 5 MB');
    if (!this.bucket) throw new ServiceUnavailableException('Object storage is not configured');
    const key = `${userId}/${randomUUID()}.${extensions[file.mimetype]}`;
    await this.ensureBucket(this.bucket);
    await this.internal.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
      ContentDisposition: file.mimetype === 'application/pdf' ? 'attachment' : 'inline',
      CacheControl: 'private, no-store',
    }));
    return { key };
  }

  async view(userId: string, key: string) {
    if (!this.bucket) throw new ServiceUnavailableException('Object storage is not configured');
    if (typeof key !== 'string' || !/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$/.test(key))
      throw new BadRequestException('Invalid key');
    const [listing, issue, post, observation] = await Promise.all([
      this.db.cropListing.findFirst({
        where: {
          imageKeys: { has: key }, deletedAt: null, expiresAt: { gt: new Date() },
          organization: { verifiedAt: { not: null }, suspendedAt: null, deletedAt: null },
        },
        select: { id: true },
      }),
      this.db.issueReport.findFirst({ where: { imageKeys: { has: key } }, select: { id: true } }),
      this.db.groupPost.findFirst({ where: { attachmentKeys: { has: key }, group: { members: { some: { userId } } } }, select: { id: true } }),
      this.db.groupObservation.findFirst({ where: { attachmentKeys: { has: key }, group: { members: { some: { userId } } } }, select: { id: true } }),
    ]);
    if (!listing && !issue && !post && !observation) throw new ForbiddenException('Media unavailable');
    return {
      url: await getSignedUrl(this.downloads, new GetObjectCommand({
        Bucket: this.bucket, Key: key,
        ResponseContentDisposition: key.endsWith('.pdf') ? 'attachment' : 'inline',
        ResponseCacheControl: 'private, no-store',
      }), { expiresIn: 120 }),
    };
  }
}
