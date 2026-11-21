import { INestApplication } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { Server, ServerOptions } from 'socket.io';

export class RedisIoAdapter extends IoAdapter {
  private pubClient: Redis | undefined;
  private subClient: Redis | undefined;
  private key = '';

  constructor(app: INestApplication) {
    super(app);
  }

  async connectToRedis(redisUrl: string, prefix: string): Promise<void> {
    const pub = new Redis(redisUrl, { lazyConnect: true });
    const sub = pub.duplicate();

    try {
      await Promise.all([pub.connect(), sub.connect()]);
      this.pubClient = pub;
      this.subClient = sub;
      this.key = prefix + ':socket.io';
    } catch (error) {
      pub.disconnect();
      sub.disconnect();
      throw error;
    }
  }

  override createIOServer(port: number | undefined, options?: ServerOptions): Server {
    if (!this.pubClient || !this.subClient) {
      throw new Error('Redis Socket.IO adapter was not initialized');
    }

    const server = super.createIOServer(port, options) as Server;
    server.adapter(createAdapter(this.pubClient, this.subClient, {
      key: this.key, requestsTimeout: 3_500, publishOnSpecificResponseChannel: true,
    }));
    return server;
  }

  override async close(server: Server): Promise<void> {
    await super.close(server);
    await Promise.all(
      [this.pubClient, this.subClient].map(async (client) => {
        if (client?.status === 'ready') {
          await client.quit();
        } else {
          client?.disconnect();
        }
      }),
    );
  }
}
