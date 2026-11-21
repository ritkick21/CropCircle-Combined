import { randomBytes } from 'node:crypto';
import { isEmail } from 'class-validator';

export function validateEnvironment(config: Record<string, unknown>): Record<string, unknown> {
  for (const name of ['DATABASE_URL', 'REDIS_URL']) {
    if (typeof config[name] !== 'string' || config[name].length === 0) {
      throw new Error(`${name} is required`);
    }
  }

  const port = Number(config.PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  const production = config.NODE_ENV === 'production';
  if (production && (typeof config.ML_SERVICE_KEY !== 'string' ||
      !/^[A-Za-z0-9_-]{43,}$/.test(config.ML_SERVICE_KEY))) {
    throw new Error('ML_SERVICE_KEY must contain at least 32 random bytes encoded as base64url');
  }
  const secret =
    config.AUTH_JWT_SECRET || (production ? '' : randomBytes(32).toString('base64url'));
  if (typeof secret !== 'string' || !/^[A-Za-z0-9_-]{43,}$/.test(secret)) {
    throw new Error(
      'AUTH_JWT_SECRET must be a base64url secret generated from at least 32 random bytes',
    );
  }

  const webOrigin = config.WEB_ORIGIN || 'http://localhost:3000';
  if (typeof webOrigin !== 'string') throw new Error('WEB_ORIGIN must be a URL');
  const origin = new URL(webOrigin);
  if (
    !['http:', 'https:'].includes(origin.protocol) ||
    (production && origin.protocol !== 'https:') ||
    origin.href !== `${origin.origin}/`
  ) {
    throw new Error('WEB_ORIGIN must be a single origin and must use HTTPS in production');
  }

  const smtpHost = config.AUTH_SMTP_HOST || (production ? '' : '127.0.0.1');
  const smtpPort = Number(config.AUTH_SMTP_PORT || (production ? 587 : 1025));
  const mailFrom = config.AUTH_MAIL_FROM || (production ? '' : 'no-reply@cropcircle.test');
  if (
    typeof smtpHost !== 'string' ||
    !smtpHost.trim() ||
    !Number.isInteger(smtpPort) ||
    smtpPort < 1 ||
    smtpPort > 65535 ||
    typeof mailFrom !== 'string' ||
    !isEmail(mailFrom)
  ) {
    throw new Error('Configure a valid AUTH_SMTP_HOST, AUTH_SMTP_PORT, and AUTH_MAIL_FROM');
  }
  if (!!config.AUTH_SMTP_USER !== !!config.AUTH_SMTP_PASSWORD) {
    throw new Error('AUTH_SMTP_USER and AUTH_SMTP_PASSWORD must be configured together');
  }
  const realtimePrefix = config.REALTIME_PREFIX || 'cropcircle';
  if (typeof realtimePrefix !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(realtimePrefix)) {
    throw new Error('REALTIME_PREFIX must use letters, numbers, underscores or hyphens');
  }

  return {
    ...config,
    PORT: port,
    WEB_ORIGIN: origin.origin,
    REALTIME_PREFIX: realtimePrefix,
    AUTH_JWT_SECRET: secret,
    AUTH_SMTP_HOST: smtpHost,
    AUTH_SMTP_PORT: smtpPort,
    AUTH_MAIL_FROM: mailFrom,
  };
}
