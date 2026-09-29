import { Injectable } from '@angular/core';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface SupabaseConfiguration {
  anonKey: string;
  url: string;
}

/**
 * Thin wrapper around Supabase Auth. The client library is loaded lazily,
 * so it only ends up in the bundle of users who actually sign in with
 * Supabase.
 */
@Injectable({ providedIn: 'root' })
export class SupabaseAuthService {
  private client: SupabaseClient | null = null;

  public async signInWithPassword({
    configuration,
    email,
    password
  }: {
    configuration: SupabaseConfiguration;
    email: string;
    password: string;
  }): Promise<string> {
    const supabaseClient = await this.getClient(configuration);

    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email,
      password
    });

    if (error || !data?.session?.access_token) {
      throw new Error(
        error?.message ?? 'Could not sign in with Supabase. Please try again.'
      );
    }

    return data.session.access_token;
  }

  public async signUp({
    configuration,
    email,
    password
  }: {
    configuration: SupabaseConfiguration;
    email: string;
    password: string;
  }): Promise<string> {
    const supabaseClient = await this.getClient(configuration);

    const { data, error } = await supabaseClient.auth.signUp({
      email,
      password
    });

    if (error) {
      throw new Error(error.message);
    }

    if (!data?.session?.access_token) {
      throw new Error(
        'Please confirm your email address and sign in afterwards.'
      );
    }

    return data.session.access_token;
  }

  /**
   * Starts the Google OAuth flow of Supabase. The browser is redirected to
   * Supabase and back, the session is picked up by `getAccessToken()`.
   */
  public async signInWithGoogle({
    configuration
  }: {
    configuration: SupabaseConfiguration;
  }): Promise<void> {
    const supabaseClient = await this.getClient(configuration);

    const { error } = await supabaseClient.auth.signInWithOAuth({
      options: { redirectTo: window.location.origin },
      provider: 'google'
    });

    if (error) {
      throw new Error(error.message);
    }
  }

  /** Access token of the current Supabase session, if there is one */
  public async getAccessToken({
    configuration
  }: {
    configuration: SupabaseConfiguration;
  }): Promise<string | null> {
    const supabaseClient = await this.getClient(configuration);

    const { data } = await supabaseClient.auth.getSession();

    return data?.session?.access_token ?? null;
  }

  private async getClient({
    anonKey,
    url
  }: SupabaseConfiguration): Promise<SupabaseClient> {
    if (!url || !anonKey) {
      throw new Error('Supabase is not configured');
    }

    if (!this.client) {
      const { createClient } = await import('@supabase/supabase-js');

      this.client = createClient(url, anonKey, {
        auth: {
          detectSessionInUrl: true,
          persistSession: true
        }
      });
    }

    return this.client;
  }
}
