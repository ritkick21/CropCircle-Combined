import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';

@Injectable()
export class AuthMailService implements OnModuleDestroy {
  private readonly transport: Transporter;
  private readonly logger = new Logger(AuthMailService.name);
  private readonly from: string;
  private readonly pending = new Set<Promise<void>>();

  constructor(config: ConfigService) {
    this.from = config.getOrThrow<string>('AUTH_MAIL_FROM');
    const port = config.getOrThrow<number>('AUTH_SMTP_PORT');
    const user = config.get<string>('AUTH_SMTP_USER');
    this.transport = createTransport({
      host: config.getOrThrow<string>('AUTH_SMTP_HOST'),
      port,
      secure: port === 465,
      requireTLS: config.get('NODE_ENV') === 'production' && port !== 465,
      auth: user ? { user, pass: config.getOrThrow<string>('AUTH_SMTP_PASSWORD') } : undefined,
      connectionTimeout: 5_000,
      greetingTimeout: 5_000,
      socketTimeout: 10_000,
    });
  }

  // SMTP is kept off the response path so requests do not reveal whether an account exists.
  send(to: string, subject: string, text: string): void {
    const delivery = this.transport
      .sendMail({ from: this.from, to, subject, text })
      .then(() => undefined)
      .catch(() => this.logger.warn('An authentication email could not be delivered.'))
      .finally(() => this.pending.delete(delivery));
    this.pending.add(delivery);
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled(this.pending);
    this.transport.close();
  }
}
