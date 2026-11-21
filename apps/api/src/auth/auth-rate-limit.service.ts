import { HttpException, HttpStatus, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import { hashToken } from './credentials';

const incrementWithExpiry = `
local attempts = redis.call('INCR', KEYS[1])
if attempts == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return attempts
`;

@Injectable()
export class AuthRateLimitService {
  constructor(private readonly redis: RedisService) {}

  async consume(scope: string, subject: string, limit: number, seconds: number): Promise<void> {
    let count: unknown;
    try {
      count = await this.redis.client.eval(
        incrementWithExpiry,
        1,
        `auth:limit:${scope}:${hashToken(subject)}`,
        seconds,
      );
    } catch {
      throw new ServiceUnavailableException('Authentication is temporarily unavailable');
    }
    if (typeof count !== 'number') {
      throw new ServiceUnavailableException('Authentication is temporarily unavailable');
    }
    if (count > limit) {
      throw new HttpException('Too many requests', HttpStatus.TOO_MANY_REQUESTS);
    }
  }
}
