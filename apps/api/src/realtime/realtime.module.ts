import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InfrastructureModule } from '../infrastructure.module';
import { FarmerMessagesService } from './farmer-messages.service';
import { NotificationsService } from './notifications.service';
import { OutboxWorker } from './outbox.worker';
import { RealtimeAccessService } from './realtime-access.service';
import { RealtimeController } from './realtime.controller';
import { RealtimeGateway } from './realtime.gateway';

@Module({
  imports: [AuthModule, InfrastructureModule],
  controllers: [RealtimeController],
  providers: [
    RealtimeGateway,
    RealtimeAccessService,
    OutboxWorker,
    NotificationsService,
    FarmerMessagesService,
  ],
})
export class RealtimeModule {}
