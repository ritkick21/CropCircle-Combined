import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { InfrastructureModule } from '../infrastructure.module';
import { AuthMailService } from './auth-mail.service';
import { AuthRateLimitService } from './auth-rate-limit.service';
import {
  accessTokenSeconds,
  AuthSessionService,
  jwtAudience,
  jwtIssuer,
} from './auth-session.service';
import { AuthController } from './auth.controller';
import { JwtAuthGuard, PlatformRolesGuard } from './auth.guards';
import { AuthService } from './auth.service';

@Module({
  imports: [
    InfrastructureModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('AUTH_JWT_SECRET'),
        signOptions: {
          algorithm: 'HS256',
          expiresIn: accessTokenSeconds,
          issuer: jwtIssuer,
          audience: jwtAudience,
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthSessionService,
    AuthMailService,
    AuthRateLimitService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PlatformRolesGuard },
  ],
  exports: [AuthMailService, AuthRateLimitService, AuthSessionService],
})
export class AuthModule {}
