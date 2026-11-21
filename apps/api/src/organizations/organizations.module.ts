import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InfrastructureModule } from '../infrastructure.module';
import { OrganizationAccessService } from './organization-access.service';
import { OrganizationMembershipGuard } from './organization-membership.guard';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';

@Module({
  imports: [InfrastructureModule, AuthModule],
  controllers: [OrganizationsController],
  providers: [OrganizationsService, OrganizationAccessService, OrganizationMembershipGuard],
  exports: [OrganizationAccessService, OrganizationMembershipGuard],
})
export class OrganizationsModule {}
