import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RealtimeEventData } from '@cropcircle/shared-types';
import { Queue, Worker } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import type { EventScope } from './outbox';
import { RealtimeGateway } from './realtime.gateway';

type JobData = { outboxId: string };
const queueName = 'cropcircle-realtime-outbox';

@Injectable()
export class OutboxWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OutboxWorker.name);
  private queue?: Queue<JobData>;
  private worker?: Worker<JobData>;
  private timer?: NodeJS.Timeout;
  private scan?: Promise<void>;
  private workerConnection?: ReturnType<RedisService['client']['duplicate']>;

  constructor(
    private readonly db: PrismaService,
    private readonly redis: RedisService,
    private readonly gateway: RealtimeGateway,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap() {
    const connection = this.redis.client.duplicate({
      maxRetriesPerRequest: null,
      lazyConnect: false,
    });
    const prefix = this.config.getOrThrow<string>('REALTIME_PREFIX') + ':bull';
    this.worker = new Worker<JobData>(queueName, (job) => this.process(job.data.outboxId), {
      connection,
      prefix,
      concurrency: 2,
    });
    this.workerConnection = connection;
    this.worker.on('error', (error) => this.logger.warn(error.message));
    this.worker.on('failed', (job, error) =>
      this.logger.warn(`Outbox job ${job?.id ?? 'unknown'} will be retried: ${error.message}`),
    );
    this.queue = new Queue<JobData>(queueName, { connection: this.redis.client, prefix });
    this.queue.on('error', (error) => this.logger.warn(error.message));
    this.timer = setInterval(() => {
      if (this.scan || this.redis.client.status !== 'ready') return;
      this.scan = this.enqueue()
        .catch((error) => this.logger.warn(String(error)))
        .finally(() => {
          this.scan = undefined;
        });
    }, 750);
    this.timer.unref();
  }

  async onModuleDestroy() {
    clearInterval(this.timer);
    await this.scan;
    await this.worker?.close();
    this.workerConnection?.disconnect();
    await this.queue?.close();
  }

  private async enqueue() {
    const rows = await this.db.realtimeOutbox.findMany({
      where: { publishedAt: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 100,
      select: { id: true },
    });
    if (!rows.length) return;
    await this.queue?.addBulk(
      rows.map(({ id }) => ({
        name: 'publish',
        data: { outboxId: id },
        opts: {
          jobId: id,
          attempts: 5,
          backoff: { type: 'exponential', delay: 1_000 },
          removeOnComplete: true,
          removeOnFail: true,
        },
      })),
    );
  }

  private async process(id: string) {
    await this.db.$transaction(
      async (tx) => {
        const locked = await tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM realtime_outbox WHERE id = ${id}::uuid AND published_at IS NULL FOR UPDATE`;
        if (!locked.length) return;
        const row = await tx.realtimeOutbox.findUniqueOrThrow({ where: { id } });
        // These values are written by the typed outbox helpers within the domain transactions.
        const event = row.event as unknown as RealtimeEventData;
        const scopes = row.scopes as unknown as EventScope[];
        await this.gateway.publish(
          { ...event, eventId: row.id, occurredAt: row.createdAt.toISOString(), version: 1 },
          scopes,
        );
        await tx.realtimeOutbox.update({ where: { id }, data: { publishedAt: new Date() } });
      },
      { timeout: 15_000 },
    );
  }
}
