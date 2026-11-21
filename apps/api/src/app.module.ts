import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { validateEnvironment } from './config/environment';
import { HealthController } from './health/health.controller';
import { HealthService } from './health/health.service';
import { InfrastructureModule } from './infrastructure.module';
import { IntelligenceModule } from './intelligence/intelligence.module';
import { LocationsModule } from './locations/locations.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { RealtimeModule } from './realtime/realtime.module';
import { Stage5Module } from './stage5/stage5.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env', '.env'],
      validate: validateEnvironment,
    }),
    InfrastructureModule,
    AuthModule,
    OrganizationsModule,
    LocationsModule,
    Stage5Module,
    IntelligenceModule,
    RealtimeModule,
  ],
  controllers: [HealthController],
  providers: [HealthService],
})
export class AppModule {}
