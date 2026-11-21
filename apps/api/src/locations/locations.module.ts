import { Module } from '@nestjs/common';
import { InfrastructureModule } from '../infrastructure.module';
import { LocationsController, MapController } from './locations.controller';
import { LocationsService } from './locations.service';

@Module({
  imports: [InfrastructureModule],
  controllers: [LocationsController, MapController],
  providers: [LocationsService],
})
export class LocationsModule {}
