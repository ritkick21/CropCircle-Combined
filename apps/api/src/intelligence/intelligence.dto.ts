import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';

export class DashboardQuery {
  @IsOptional()
  @IsIn(['farmer', 'organization', 'admin'])
  scope: 'farmer' | 'organization' | 'admin' = 'farmer';

  @IsOptional() @IsUUID() organizationId?: string;
}

export class ForecastDto {
  @IsIn(['SURPLUS', 'DEMAND']) kind!: 'SURPLUS' | 'DEMAND';
  @IsString() @Length(1, 120) crop!: string;
  @IsOptional() @IsUUID() organizationId?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0.01) @Max(1_000_000) acreage?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0.01) @Max(1_000_000) priorAcreage?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(1_000_000_000) priorHarvestKg?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(1_000_000_000) priorSurplusKg?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(-40) @Max(140) spring_temp_f?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(-40) @Max(140) summer_temp_f?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(150) spring_rain_in?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(150) summer_rain_in?: number;
}

export class ClassificationDto {
  @IsString() @Length(1, 120) crop!: string;
  @IsString() @Length(10, 2000) symptoms!: string;
}
