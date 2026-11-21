import { ApiProperty } from '@nestjs/swagger';
import { OrganizationRole } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsIn, IsString, Length, NotContains } from 'class-validator';
import { EmailDto } from '../auth/auth.dto';

export enum OrganizationType {
  Farm = 'farm',
  FoodBank = 'food_bank',
  CommunityOrganization = 'community_organization',
  FarmersMarket = 'farmers_market',
  ProduceBuyer = 'produce_buyer',
}

export const inviteRoles = [OrganizationRole.MEMBER, OrganizationRole.MANAGER] as const;
export type InviteRole = (typeof inviteRoles)[number];

export class CreateOrganizationDto {
  @ApiProperty({ minLength: 1, maxLength: 160 })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 160)
  @NotContains(String.fromCharCode(0))
  name!: string;

  @ApiProperty({ enum: OrganizationType })
  @IsEnum(OrganizationType)
  type!: OrganizationType;
}

export class InviteOrganizationMemberDto extends EmailDto {
  @ApiProperty({ enum: inviteRoles })
  @IsIn(inviteRoles)
  role!: InviteRole;
}
