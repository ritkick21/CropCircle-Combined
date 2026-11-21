import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Length,
  MaxLength,
} from 'class-validator';
import { FarmReplyKind, FarmResourceKind } from '@prisma/client';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateFarmCaseDto {
  @Transform(trim) @IsString() @Length(2, 80) crop!: string;
  @Transform(trim) @IsOptional() @IsString() @MaxLength(100) region?: string;
  @Transform(trim) @IsString() @Length(12, 2000) description!: string;
  @IsBoolean() openToTrials!: boolean;
}

export class ShareFarmCaseDto {
  @IsOptional() @IsUUID() researcherId?: string;
}

export class ReplyFarmCaseDto {
  @IsEnum(FarmReplyKind) kind!: FarmReplyKind;
  @Transform(trim) @IsString() @Length(5, 1500) body!: string;
}

export class SolveFarmCaseDto {
  @Transform(trim) @IsString() @Length(5, 1200) resolution!: string;
  @IsBoolean() publishFix!: boolean;
}

export class CreateFarmTrialDto {
  @Transform(trim) @IsString() @Length(4, 120) title!: string;
  @Transform(trim) @IsString() @Length(2, 80) crop!: string;
  @Transform(trim) @IsString() @Length(5, 1200) description!: string;
}

export class CreateFarmResourceDto {
  @Transform(trim) @IsString() @Length(4, 150) title!: string;
  @Transform(trim) @IsString() @Length(2, 80) crop!: string;
  @Transform(trim) @IsString() @Length(5, 500) summary!: string;
  @IsEnum(FarmResourceKind) kind!: FarmResourceKind;
  @Transform(trim)
  @MaxLength(600)
  @IsUrl({
    protocols: ['https'],
    require_protocol: true,
    require_valid_protocol: true,
    disallow_auth: true,
  })
  url!: string;
}
