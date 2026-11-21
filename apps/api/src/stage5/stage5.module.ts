import { Module } from '@nestjs/common';
import { InfrastructureModule } from '../infrastructure.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { CollaborationService } from './collaboration.service';
import { MarketplaceService } from './marketplace.service';
import { MediaService } from './media.service';
import { CollaborationController, MarketplaceController, MediaController } from './stage5.controller';

@Module({ imports: [InfrastructureModule, OrganizationsModule], controllers: [MarketplaceController, CollaborationController, MediaController], providers: [MarketplaceService, CollaborationService, MediaService] })
export class Stage5Module {}
