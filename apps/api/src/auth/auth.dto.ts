import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, Length, Matches, NotContains } from 'class-validator';
import { tokenPattern } from './credentials';

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export class EmailDto {
  @ApiProperty({ format: 'email', maxLength: 254 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizeEmail(value) : value,
  )
  @IsEmail({ allow_utf8_local_part: false })
  @Length(3, 254)
  @Matches(/^[!-~]+$/)
  email!: string;
}

export class LoginDto extends EmailDto {
  @ApiProperty({ format: 'password', minLength: 1, maxLength: 128 })
  @IsString()
  @Length(1, 128)
  password!: string;
}

export class TokenDto {
  @ApiProperty({ minLength: 43, maxLength: 43 })
  @IsString()
  @Matches(tokenPattern)
  token!: string;
}

export class ResetPasswordDto extends TokenDto {
  @ApiProperty({ format: 'password', minLength: 15, maxLength: 128 })
  @IsString()
  @Length(15, 128)
  password!: string;
}

export class VerifyEmailDto extends ResetPasswordDto {
  @ApiProperty({ minLength: 1, maxLength: 100 })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 100)
  @NotContains(String.fromCharCode(0))
  displayName!: string;
}
