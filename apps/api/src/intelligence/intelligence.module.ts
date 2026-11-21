import { Module } from '@nestjs/common';
import { InfrastructureModule } from '../infrastructure.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { IntelligenceController } from './intelligence.controller';
import { SustainabilityService } from './sustainability.service';

@Module({
  imports: [InfrastructureModule, OrganizationsModule],
  controllers: [IntelligenceController],
  providers: [SustainabilityService],
})
export class IntelligenceModule {}
