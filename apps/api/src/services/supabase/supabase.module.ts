import { ConfigurationModule } from '@ghostfolio/api/services/configuration/configuration.module';

import { Module } from '@nestjs/common';

import { SupabaseService } from './supabase.service';

@Module({
  exports: [SupabaseService],
  imports: [ConfigurationModule],
  providers: [SupabaseService]
})
export class SupabaseModule {}
