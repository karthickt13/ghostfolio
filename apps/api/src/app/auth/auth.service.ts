import { UserService } from '@ghostfolio/api/app/user/user.service';
import { ConfigurationService } from '@ghostfolio/api/services/configuration/configuration.service';
import { PropertyService } from '@ghostfolio/api/services/property/property.service';
import { SupabaseService } from '@ghostfolio/api/services/supabase/supabase.service';

import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { ValidateOAuthLoginParams } from './interfaces/interfaces';

@Injectable()
export class AuthService {
  public constructor(
    private readonly configurationService: ConfigurationService,
    private readonly jwtService: JwtService,
    private readonly propertyService: PropertyService,
    private readonly supabaseService: SupabaseService,
    private readonly userService: UserService
  ) {}

  public async validateAnonymousLogin(accessToken: string): Promise<string> {
    const hashedAccessToken = this.userService.createAccessToken({
      password: accessToken,
      salt: this.configurationService.get('ACCESS_TOKEN_SALT')
    });

    const [user] = await this.userService.users({
      where: { accessToken: hashedAccessToken }
    });

    if (user) {
      return this.jwtService.sign({
        id: user.id
      });
    }

    throw new Error();
  }

  /**
   * Exchanges a Supabase access token for a Ghostfolio JWT. The Ghostfolio
   * user is created on the first login, keyed by the Supabase user id.
   */
  public async validateSupabaseLogin(aAccessToken: string): Promise<string> {
    const supabaseUser =
      await this.supabaseService.verifyAccessToken(aAccessToken);

    if (!supabaseUser) {
      throw new Error('Invalid Supabase access token');
    }

    return this.validateOAuthLogin({
      provider: 'SUPABASE',
      thirdPartyId: supabaseUser.id
    });
  }

  public async validateOAuthLogin({
    provider,
    thirdPartyId
  }: ValidateOAuthLoginParams): Promise<string> {
    try {
      let [user] = await this.userService.users({
        where: { provider, thirdPartyId }
      });

      if (!user) {
        const isUserSignupEnabled =
          await this.propertyService.isUserSignupEnabled();

        if (!isUserSignupEnabled) {
          throw new Error('Sign up forbidden');
        }

        // Create new user if not found
        user = await this.userService.createUser({
          data: {
            provider,
            thirdPartyId
          }
        });
      }

      return this.jwtService.sign({
        id: user.id
      });
    } catch (error) {
      throw new InternalServerErrorException(
        'validateOAuthLogin',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }
}
