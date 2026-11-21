import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { CookieOptions, Request, Response } from 'express';
import { AuthRateLimitService } from './auth-rate-limit.service';
import {
  accessTokenSeconds,
  AuthSessionService,
  type Identity,
  type SessionTokens,
} from './auth-session.service';
import { AuthService } from './auth.service';
import { EmailDto, LoginDto, ResetPasswordDto, VerifyEmailDto } from './auth.dto';
import { CurrentIdentity, Public } from './auth.guards';
import { tokenPattern } from './credentials';

const cookieName = 'cropcircle_refresh';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  private readonly browserOrigin: string;
  private readonly refreshCookie: CookieOptions;

  constructor(
    private readonly auth: AuthService,
    private readonly sessions: AuthSessionService,
    private readonly rateLimit: AuthRateLimitService,
    config: ConfigService,
  ) {
    this.browserOrigin = config.getOrThrow<string>('WEB_ORIGIN');
    this.refreshCookie = {
      httpOnly: true,
      secure: config.get('NODE_ENV') === 'production',
      sameSite: 'strict',
      path: '/api/v1/auth',
    };
  }

  @Public()
  @Post('registrations')
  @HttpCode(HttpStatus.ACCEPTED)
  async register(@Body() dto: EmailDto, @Req() request: Request): Promise<void> {
    await this.limitEmail(request, dto.email, 'verification');
    await this.auth.register(dto.email);
  }

  @Public()
  @Post('email-verification/resend')
  @HttpCode(HttpStatus.ACCEPTED)
  async resend(@Body() dto: EmailDto, @Req() request: Request): Promise<void> {
    await this.limitEmail(request, dto.email, 'verification');
    await this.auth.resendVerification(dto.email);
  }

  @Public()
  @Post('email-verification')
  @HttpCode(HttpStatus.NO_CONTENT)
  async verify(@Body() dto: VerifyEmailDto, @Req() request: Request): Promise<void> {
    await this.limitIp(request, 'verify', 30);
    await this.auth.verifyEmail(dto);
  }

  @Public()
  @Post('password-recovery')
  @HttpCode(HttpStatus.ACCEPTED)
  async recover(@Body() dto: EmailDto, @Req() request: Request): Promise<void> {
    await this.limitEmail(request, dto.email, 'recovery');
    await this.auth.requestPasswordReset(dto.email);
  }

  @Public()
  @Post('password-reset')
  @HttpCode(HttpStatus.NO_CONTENT)
  async reset(@Body() dto: ResetPasswordDto, @Req() request: Request): Promise<void> {
    await this.limitIp(request, 'reset', 30);
    await this.auth.resetPassword(dto);
  }

  @Public()
  @Post('login')
  @Header('Cache-Control', 'no-store')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.assertBrowserOrigin(request);
    await this.limitIp(request, 'login', 30);
    await this.rateLimit.consume('login:email', dto.email, 10, 15 * 60);
    return this.sessionResponse(response, await this.auth.login(dto));
  }

  @Public()
  @Post('refresh')
  @Header('Cache-Control', 'no-store')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    this.assertBrowserOrigin(request);
    await this.limitIp(request, 'refresh', 120);
    const token = this.cookieFrom(request);
    if (!token) throw new UnauthorizedException('Invalid session');
    return this.sessionResponse(response, await this.sessions.refresh(token));
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    this.assertBrowserOrigin(request);
    await this.limitIp(request, 'logout', 120);
    const token = this.cookieFrom(request);
    if (token) await this.sessions.revoke(token);
    response.clearCookie(cookieName, this.refreshCookie);
  }

  @ApiBearerAuth()
  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logoutAll(
    @CurrentIdentity() identity: Identity,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.sessions.revokeAll(identity.user.id);
    response.clearCookie(cookieName, this.refreshCookie);
  }

  @ApiBearerAuth()
  @Get('me')
  @Header('Cache-Control', 'no-store')
  me(@CurrentIdentity() identity: Identity) {
    return identity.user;
  }

  private assertBrowserOrigin(request: Request): void {
    const origin = request.headers.origin;
    if (origin !== undefined && origin !== this.browserOrigin) throw new ForbiddenException();
  }

  private cookieFrom(request: Request): string | undefined {
    const entry = request.headers.cookie
      ?.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${cookieName}=`));
    const token = entry?.slice(cookieName.length + 1);
    return token && tokenPattern.test(token) ? token : undefined;
  }

  private async limitEmail(request: Request, email: string, scope: string): Promise<void> {
    await this.limitIp(request, scope, 20);
    await this.rateLimit.consume(`${scope}:email`, email, 4, 60 * 60);
  }

  private limitIp(request: Request, scope: string, limit: number): Promise<void> {
    return this.rateLimit.consume(
      `${scope}:ip`,
      request.ip ?? request.socket.remoteAddress ?? 'unknown',
      limit,
      15 * 60,
    );
  }

  private sessionResponse(response: Response, session: SessionTokens) {
    response.cookie(cookieName, session.refreshToken, {
      ...this.refreshCookie,
      expires: session.expiresAt,
    });
    return { accessToken: session.accessToken, tokenType: 'Bearer', expiresIn: accessTokenSeconds };
  }
}
