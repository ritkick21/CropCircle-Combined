import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { AccountStatus, AuthTokenPurpose, type Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthMailService } from './auth-mail.service';
import { activeAccount, AuthSessionService } from './auth-session.service';
import {
  day,
  hashPassword,
  hashToken,
  lockUser,
  minute,
  randomToken,
  verifyPassword,
} from './credentials';
import type { LoginDto, ResetPasswordDto, VerifyEmailDto } from './auth.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly db: PrismaService,
    private readonly mail: AuthMailService,
    private readonly sessions: AuthSessionService,
  ) {}

  async register(email: string): Promise<void> {
    // Skip duplicates atomically when two requests submit the same normalized address.
    await this.db.user.createMany({ data: [{ email }], skipDuplicates: true });
    await this.issueToken(email, AuthTokenPurpose.EMAIL_VERIFICATION);
  }

  resendVerification(email: string): Promise<void> {
    return this.issueToken(email, AuthTokenPurpose.EMAIL_VERIFICATION);
  }

  requestPasswordReset(email: string): Promise<void> {
    return this.issueToken(email, AuthTokenPurpose.PASSWORD_RESET);
  }

  verifyEmail(input: VerifyEmailDto): Promise<void> {
    return this.consumeToken(input, AuthTokenPurpose.EMAIL_VERIFICATION, {
      displayName: input.displayName,
      emailVerifiedAt: new Date(),
      status: AccountStatus.ACTIVE,
    });
  }

  resetPassword(input: ResetPasswordDto): Promise<void> {
    return this.consumeToken(input, AuthTokenPurpose.PASSWORD_RESET, {});
  }

  async login(input: LoginDto) {
    const account = await this.db.user.findFirst({
      where: { email: input.email, ...activeAccount },
      select: { id: true, passwordHash: true },
    });
    const valid = await verifyPassword(input.password, account?.passwordHash);
    if (!valid || !account?.passwordHash)
      throw new UnauthorizedException('Invalid email or password');
    return this.sessions.create(account.id, account.passwordHash);
  }

  private accountFor(purpose: AuthTokenPurpose): Prisma.UserWhereInput {
    return purpose === AuthTokenPurpose.EMAIL_VERIFICATION
      ? { status: AccountStatus.PENDING_VERIFICATION, deletedAt: null }
      : activeAccount;
  }

  private async issueToken(email: string, purpose: AuthTokenPurpose): Promise<void> {
    const user = await this.db.user.findUnique({ where: { email }, select: { id: true } });
    if (!user) return;

    const token = randomToken();
    const verifying = purpose === AuthTokenPurpose.EMAIL_VERIFICATION;
    const issued = await this.db.$transaction(async (tx) => {
      await lockUser(tx, user.id);
      const eligible = await tx.user.count({ where: { id: user.id, ...this.accountFor(purpose) } });
      if (!eligible) return false;
      await tx.authToken.deleteMany({
        where: { userId: user.id, purpose, expiresAt: { lte: new Date() } },
      });
      await tx.authToken.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(token),
          purpose,
          expiresAt: new Date(Date.now() + (verifying ? day : 30 * minute)),
        },
      });
      return true;
    });
    if (issued) {
      const subject = verifying ? 'Verify your CropCircle email' : 'Reset your CropCircle password';
      const lifetime = verifying ? '24 hours' : '30 minutes';
      this.mail.send(
        email,
        subject,
        `${subject} using this code:\n\n${token}\n\nIt expires in ${lifetime}. If you did not request this, you can ignore this email.`,
      );
    }
  }

  private async consumeToken(
    input: ResetPasswordDto,
    purpose: AuthTokenPurpose,
    changes: Prisma.UserUpdateInput,
  ): Promise<void> {
    const findToken = {
      tokenHash: hashToken(input.token),
      purpose,
      expiresAt: { gt: new Date() },
      user: this.accountFor(purpose),
    } satisfies Prisma.AuthTokenWhereInput;
    const token = await this.db.authToken.findFirst({
      where: findToken,
      select: { id: true, userId: true },
    });
    if (!token) throw new BadRequestException('Invalid or expired code');

    const passwordHash = await hashPassword(input.password);
    const email = await this.db.$transaction(async (tx) => {
      await lockUser(tx, token.userId);
      const current = await tx.authToken.findFirst({
        where: { ...findToken, id: token.id, expiresAt: { gt: new Date() } },
        select: { id: true },
      });
      if (!current) throw new BadRequestException('Invalid or expired code');

      const account = await tx.user.update({
        where: { id: token.userId },
        data: { ...changes, passwordHash },
        select: { email: true },
      });
      await tx.authToken.deleteMany({ where: { userId: token.userId, purpose } });
      if (purpose === AuthTokenPurpose.PASSWORD_RESET) {
        await tx.authSession.updateMany({
          where: { userId: token.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      return account.email;
    });
    if (purpose === AuthTokenPurpose.PASSWORD_RESET) {
      this.mail.send(
        email,
        'Your CropCircle password changed',
        'Your password was reset and your sessions were signed out.',
      );
    }
  }
}
