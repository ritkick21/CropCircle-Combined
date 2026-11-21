import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AuthRateLimitService } from './auth/auth-rate-limit.service';
import { secureHttp } from './config/http-security';
import { requestValidation } from './config/validation';
import { RedisIoAdapter } from './realtime/redis-io.adapter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);
  const production = config.get('NODE_ENV') === 'production';
  app.disable('x-powered-by');
  if (config.get('TRUST_PROXY') === '1') app.set('trust proxy', 1);
  const redisAdapter = new RedisIoAdapter(app);
  await redisAdapter.connectToRedis(config.getOrThrow<string>('REDIS_URL'), config.getOrThrow<string>('REALTIME_PREFIX'));
  app.useWebSocketAdapter(redisAdapter);
  app.enableShutdownHooks();
  app.enableCors({
    origin: config.get<string>('WEB_ORIGIN') ?? 'http://localhost:3000',
    credentials: true,
  });
  app.use(secureHttp(app.get(AuthRateLimitService), production));
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(requestValidation());

  if (!production) {
    const openApi = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('CropCircle API')
      .setDescription('Version 1 REST API')
      .setVersion('1.0.0')
      .addBearerAuth()
      .build(),
  );
    SwaggerModule.setup('api/docs', app, openApi, {
      jsonDocumentUrl: 'api/openapi.json',
    });
  }

  await app.listen(config.get<number>('PORT') ?? 3001, '0.0.0.0');
}

void bootstrap().catch((error: unknown) => {
  console.error('API startup failed', error);
  process.exitCode = 1;
});
