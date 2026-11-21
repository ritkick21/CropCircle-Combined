import { Module } from '@nestjs/common';
import { InfrastructureModule } from '../infrastructure.module';
import { FarmlineController } from './farmline.controller';
import { FarmlineService } from './farmline.service';

@Module({
  imports: [InfrastructureModule],
  controllers: [FarmlineController],
  providers: [FarmlineService],
})
export class FarmlineModule {}
