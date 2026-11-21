import { ResourceCategory } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

export class LocationQueryDto {
  @IsOptional() @IsString() @Length(1, 120) q?: string;
  @IsOptional() @IsEnum(ResourceCategory) category?: ResourceCategory;
  @IsOptional() @IsString() @Length(1, 80) crop?: string;
  @IsOptional() @Type(() => Number) @IsLongitude() lng?: number;
  @IsOptional() @Type(() => Number) @IsLatitude() lat?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0.1) @Max(500) radiusKm?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 30;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10000) offset = 0;
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === 'true' ? true : value === 'false' ? false : value)
  @IsBoolean()
  available?: boolean;
}

export class MarkerQueryDto extends LocationQueryDto {
  @Type(() => Number) @IsLongitude() west!: number;
  @Type(() => Number) @IsLatitude() south!: number;
  @Type(() => Number) @IsLongitude() east!: number;
  @Type(() => Number) @IsLatitude() north!: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(20) zoom = 8;
}

export class CreateLocationDto {
  @IsEnum(ResourceCategory) category!: ResourceCategory;
  @IsString() @Length(1, 160) name!: string;
  @IsOptional() @IsString() @Length(0, 1000) description?: string;
  @IsOptional() @IsString() @Length(0, 240) addressLabel?: string;
  @Type(() => Number) @IsLongitude() lng!: number;
  @Type(() => Number) @IsLatitude() lat!: number;
  @IsOptional() @IsArray() @IsString({ each: true }) acceptedCrops?: string[];
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) capacityKg?: number;
  @IsOptional() @IsBoolean() available?: boolean;
  @IsOptional() @IsObject() hours?: Record<string, string>;
}

export class UpdateLocationDto {
  @IsOptional() @IsString() @Length(1, 160) name?: string;
  @IsOptional() @IsString() @Length(0, 1000) description?: string;
  @IsOptional() @IsString() @Length(0, 240) addressLabel?: string;
  @IsOptional() @Type(() => Number) @IsLongitude() lng?: number;
  @IsOptional() @Type(() => Number) @IsLatitude() lat?: number;
  @IsOptional() @IsArray() @IsString({ each: true }) acceptedCrops?: string[];
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) capacityKg?: number;
  @IsOptional() @IsBoolean() available?: boolean;
  @IsOptional() @IsObject() hours?: Record<string, string>;
}

export class PublishLocationDto {
  @IsString() @Length(10, 1000) reason!: string;
}
