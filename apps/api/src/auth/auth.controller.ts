import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, Length, Matches, MaxLength } from 'class-validator';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { AuthRateLimit } from './rate-limit.service';
import { Public, type AuthRequest } from './security';
class CredentialsDto {
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email!: string;
  @IsString() @Length(12, 128) password!: string;
}
class RegisterDto extends CredentialsDto {
  @IsString() @Length(1, 80) @Matches(/\S/) name!: string;
}
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly rate: AuthRateLimit,
  ) {}
  @Public()
  @Get('csrf')
  async csrf(
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.rate.consume('csrf', request.ip ?? 'unknown', 60);
    return this.auth.csrf(request.authSession, response);
  }
  @Public()
  @Post('register')
  async register(
    @Body() input: RegisterDto,
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.rate.consume('register', request.ip ?? 'unknown', 10);
    return this.auth.register(
      input,
      request.authSession!,
      response,
      response.locals.requestId,
    );
  }
  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() input: CredentialsDto,
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.rate.consume('login-ip', request.ip ?? 'unknown', 30);
    await this.rate.consume('login-account', input.email, 10);
    return this.auth.login(input, request.authSession!, response);
  }
  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.auth.logout(request.authSession!, response);
  }
  @Get('me')
  me(@Req() request: AuthRequest) {
    return this.auth.current(request.authSession!);
  }
}
