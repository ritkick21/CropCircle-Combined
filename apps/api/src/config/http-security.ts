import { HttpException } from '@nestjs/common';
import type { RequestHandler } from 'express';
import type { AuthRateLimitService } from '../auth/auth-rate-limit.service';

export function secureHttp(limits: AuthRateLimitService, production: boolean): RequestHandler {
  return (request, response, next) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'no-referrer');
    if (production)
      response.setHeader('Strict-Transport-Security', 'max-age=31536000');
    const path = request.path.toLowerCase().replace(/\/$/, '');
    if (!path.startsWith('/api/v1/') || /^\/api\/v1\/health\/(live|ready)$/.test(path) ||
        request.method === 'OPTIONS') return next();

    response.setHeader('Cache-Control', 'no-store');
    const upload = path === '/api/v1/media/upload';
    const inference = request.method === 'POST' && path.startsWith('/api/v1/intelligence/');
    const scope = upload ? 'upload' : inference ? 'inference' : 'rest';
    const limit = upload || inference ? 20 : 240;
    void limits.consume(scope, request.ip ?? request.socket.remoteAddress ?? 'unknown', limit, 60)
      .then(() => next(), (error: unknown) => {
        const status = error instanceof HttpException ? error.getStatus() : 503;
        if (status === 429) response.setHeader('Retry-After', '60');
        response.status(status).json({
          statusCode: status,
          message: status === 429 ? 'Too many requests' : 'Service temporarily unavailable',
        });
      });
  };
}
