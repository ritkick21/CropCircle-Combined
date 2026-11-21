import { BadRequestException } from '@nestjs/common';

export function assertMediaKeys(userId: string, keys: string[] = [], existing: string[] = []): void {
  if (keys.length > 10 || keys.some(key => !new RegExp(`^${userId}/[0-9a-f-]{36}\\.(jpg|png|webp|pdf)$`).test(key) && !existing.includes(key))) {
    throw new BadRequestException('Use your uploaded files (maximum 10)');
  }
}
