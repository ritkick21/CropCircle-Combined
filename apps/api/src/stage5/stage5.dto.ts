import { IssueCategory, ListingMode, QuantityUnit } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsDateString, IsEnum, IsInt, IsLatitude, IsLongitude, IsNumber, IsObject, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';

export class PageDto {
  @IsOptional() @IsString() @Length(0, 120) q?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 30;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset = 0;
}
export class ListingSearchDto extends PageDto {
  @IsOptional() @IsEnum(ListingMode) mode?: ListingMode;
  @IsOptional() @Type(() => Number) @IsLongitude() lng?: number;
  @IsOptional() @Type(() => Number) @IsLatitude() lat?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(1) @Max(500) radiusKm?: number;
}
export class ProfileDto {
  @IsOptional() @IsUUID() locationId?: string;
  @IsArray() @IsString({ each: true }) acceptedCrops!: string[];
  @IsOptional() @IsString() @Length(0, 1000) demand?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0.01) quantityLimit?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) storageCapacity?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) serviceRadiusKm?: number;
  @IsBoolean() pickup!: boolean;
  @IsBoolean() delivery!: boolean;
  @IsOptional() @IsBoolean() coldStorage?: boolean;
  @IsOptional() @IsBoolean() acceptsSales?: boolean;
  @IsOptional() @IsObject() hours?: Record<string, string>;
}
export class ListingDto {
  @IsUUID() organizationId!: string;
  @IsUUID() locationId!: string;
  @IsString() @Length(1, 120) cropName!: string;
  @IsOptional() @IsString() @Length(1, 120) variety?: string;
  @Type(() => Number) @IsNumber() @Min(0.01) quantity!: number;
  @IsEnum(QuantityUnit) unit!: QuantityUnit;
  @IsDateString() harvestDate!: string;
  @IsString() @Length(1, 500) quality!: string;
  @IsString() @Length(1, 500) storageConditions!: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(365) shelfLifeDays!: number;
  @IsOptional() @IsArray() @IsString({ each: true }) imageKeys?: string[];
  @IsString() @Length(1, 500) pickupAvailability!: string;
  @IsOptional() @IsDateString() pickupFrom?: string | null;
  @IsOptional() @IsDateString() pickupUntil?: string | null;
  @IsOptional() @IsBoolean() requiresColdStorage?: boolean;
  @IsEnum(ListingMode) mode!: ListingMode;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0.01) price?: number;
  @IsDateString() expiresAt!: string;
}
export class RequestDto {
  @IsUUID() organizationId!: string;
  @IsOptional() @IsUUID() clientId?: string;
  @Type(() => Number) @IsNumber() @Min(0.01) quantity!: number;
}
export class PickupDto { @IsDateString() pickupAt!: string; }
export class IssueDto {
  @IsString() @Length(1, 120) cropType!: string;
  @IsEnum(IssueCategory) category!: IssueCategory;
  @IsString() @Length(1, 160) title!: string;
  @IsString() @Length(10, 2000) symptoms!: string;
  @IsString() @Length(1, 160) region!: string;
  @IsOptional() @Type(() => Number) @IsLatitude() publicLat?: number;
  @IsOptional() @Type(() => Number) @IsLongitude() publicLng?: number;
  @IsDateString() observedAt!: string;
  @IsOptional() @IsString() @Length(0, 2000) treatmentHistory?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) imageKeys?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) interests?: string[];
}
export class IssueSearchDto extends PageDto {
  @IsOptional() @IsString() @Length(1, 120) cropType?: string;
  @IsOptional() @IsEnum(IssueCategory) category?: IssueCategory;
}
export class GroupDto {
  @IsString() @Length(1, 160) name!: string;
  @IsString() @Length(1, 1000) description!: string;
  @IsArray() @IsString({ each: true }) cropTypes!: string[];
  @IsArray() @IsString({ each: true }) interests!: string[];
}
export class InvitationDto { @IsUUID() userId!: string; }
export class PostDto {
  @IsOptional() @IsUUID() clientId?: string;
  @IsString() @Length(1, 3000) body!: string;
  @IsOptional() @IsArray() @IsString({ each: true }) attachmentKeys?: string[];
}
export class ObservationDto {
  @IsString() @Length(1, 160) title!: string;
  @IsString() @Length(1, 2000) method!: string;
  @IsString() @Length(1, 3000) observation!: string;
  @IsDateString() observedAt!: string;
  @IsOptional() @IsArray() @IsString({ each: true }) attachmentKeys?: string[];
}
