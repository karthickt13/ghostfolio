import { ConfigurationService } from '@ghostfolio/api/services/configuration/configuration.service';

import { Injectable, Logger } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify } from 'jose';

export interface SupabaseUser {
  email?: string;
  id: string;
}

@Injectable()
export class SupabaseService {
  private jwks: ReturnType<typeof createRemoteJWKSet>;

  public constructor(
    private readonly configurationService: ConfigurationService
  ) {}

  /**
   * Verifies a Supabase access token (JWT) against the JWKS of the project
   * and returns the Supabase user. Returns `null` when the token is invalid.
   */
  public async verifyAccessToken(
    aAccessToken: string
  ): Promise<SupabaseUser | null> {
    const url = this.getUrl();

    if (!url || !aAccessToken) {
      return null;
    }

    try {
      this.jwks ??= createRemoteJWKSet(
        new URL(`${url}/auth/v1/.well-known/jwks.json`)
      );

      const { payload } = await jwtVerify(aAccessToken, this.jwks);

      if (!payload?.sub) {
        return null;
      }

      return {
        email: payload.email ? String(payload.email) : undefined,
        id: payload.sub
      };
    } catch (error) {
      Logger.warn(
        `Could not verify the Supabase access token: ${error instanceof Error ? error.message : 'Unknown error'}`,
        SupabaseService.name
      );

      return null;
    }
  }

  /**
   * Stores an uploaded trade book in Supabase Storage, so every weekly
   * upload can be audited later. Returns the public URL of the file or
   * `undefined` when Supabase Storage is not configured.
   */
  public async archiveTradebook({
    content,
    fileName,
    userId
  }: {
    content: string;
    fileName?: string;
    userId: string;
  }): Promise<string | undefined> {
    const url = this.getUrl();
    const serviceRoleKey = this.getServiceRoleKey();

    if (!url || !serviceRoleKey) {
      return undefined;
    }

    const bucket = this.configurationService.get('SUPABASE_STORAGE_BUCKET');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const path = `${userId}/${timestamp}-${fileName ?? 'tradebook.csv'}`;

    try {
      const response = await fetch(
        `${url}/storage/v1/object/${bucket}/${path}`,
        {
          body: content,
          headers: {
            'Authorization': `Bearer ${serviceRoleKey}`,
            'Content-Type': 'text/csv',
            'apikey': serviceRoleKey,
            'x-upsert': 'true'
          },
          method: 'POST'
        }
      );

      if (!response.ok) {
        throw new Error(
          `${response.status} ${(await response.text()).slice(0, 200)}`
        );
      }

      return `${url}/storage/v1/object/public/${bucket}/${path}`;
    } catch (error) {
      // Archiving is a nice-to-have, it must never break an import
      Logger.warn(
        `Could not archive the trade book in Supabase Storage: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
        SupabaseService.name
      );

      return undefined;
    }
  }

  public isAuthEnabled(): boolean {
    return Boolean(this.configurationService.get('ENABLE_FEATURE_AUTH_SUPABASE'));
  }

  public isStorageEnabled(): boolean {
    return Boolean(this.getUrl() && this.getServiceRoleKey());
  }

  public getAnonKey(): string {
    return this.configurationService.get('SUPABASE_ANON_KEY');
  }

  public getUrl(): string {
    return this.configurationService.get('SUPABASE_URL')?.replace(/\/$/, '');
  }

  private getServiceRoleKey(): string {
    return this.configurationService.get('SUPABASE_SERVICE_ROLE_KEY');
  }
}
