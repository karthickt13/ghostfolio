import { ImportService } from '@ghostfolio/api/app/import/import.service';
import { ConfigurationService } from '@ghostfolio/api/services/configuration/configuration.service';
import { PrismaService } from '@ghostfolio/api/services/prisma/prisma.service';
import { SupabaseService } from '@ghostfolio/api/services/supabase/supabase.service';
import {
  getTradeSignature,
  parseTradebookCsv
} from '@ghostfolio/common/tradebook';
import type {
  ParsedTrade,
  TradebookImportResponse
} from '@ghostfolio/common/tradebook';

import { HttpException, Injectable, Logger } from '@nestjs/common';
import { Prisma, Type as ActivityType } from '@prisma/client';
import { StatusCodes, getReasonPhrase } from 'http-status-codes';

import { ImportTradebookDto } from './import-tradebook.dto';

/**
 * Weekly upload of a trade book: parses the file, skips trades that have
 * been imported before and archives the upload in Supabase Storage.
 */
@Injectable()
export class TradebookService {
  public constructor(
    private readonly configurationService: ConfigurationService,
    private readonly importService: ImportService,
    private readonly prismaService: PrismaService,
    private readonly supabaseService: SupabaseService
  ) {}

  public async importTradebook({
    account,
    accountId,
    csvContent,
    defaultExchange,
    fileName,
    isDryRun = false,
    user
  }: ImportTradebookDto & {
    isDryRun?: boolean;
    user: Prisma.UserGetPayload<{ include: { settings: true } }>;
  }): Promise<TradebookImportResponse> {
    const { errors, isTradebook, trades, warnings } = parseTradebookCsv({
      account,
      csvContent,
      defaultExchange
    });

    if (!isTradebook) {
      throw new HttpException(
        {
          error: getReasonPhrase(StatusCodes.BAD_REQUEST),
          message: [
            errors[0]?.message ??
              'The file does not look like a trade book (columns for date, symbol, type and quantity are required)'
          ]
        },
        StatusCodes.BAD_REQUEST
      );
    }

    const accountIdToUse =
      accountId ??
      (account
        ? (
            await this.prismaService.account.findFirst({
              select: { id: true },
              where: { name: account, userId: user.id }
            })
          )?.id
        : undefined);

    const existingSignatures = await this.getExistingSignatures({
      trades,
      userId: user.id
    });

    const tradesToImport = trades.filter((trade) => {
      return !existingSignatures.has(getTradeSignature(trade));
    });

    const duplicateCount = trades.length - tradesToImport.length;

    if (duplicateCount > 0) {
      warnings.push(
        `${duplicateCount} ${
          duplicateCount === 1 ? 'trade was' : 'trades were'
        } already imported and ${
          duplicateCount === 1 ? 'has' : 'have'
        } been skipped`
      );
    }

    let activities: TradebookImportResponse['activities'] = [];

    if (tradesToImport.length > 0) {
      activities = await this.importService.import({
        activitiesDto: tradesToImport.map((trade) => {
          return {
            currency: trade.currency,
            date: trade.date,
            fee: trade.charges,
            quantity: trade.quantity,
            symbol: trade.symbol,
            type: trade.type as ActivityType,
            unitPrice: trade.unitPrice,
            accountId: accountIdToUse,
            comment: trade.orderId ? `Order ${trade.orderId}` : undefined,
            updateAccountBalance: false
          };
        }),
        accountsWithBalancesDto: [],
        assetProfilesWithMarketDataDto: [],
        isDryRun,
        platformsDto: [],
        tagsDto: [],
        user: user as any
      });
    }

    const archiveUrl = isDryRun
      ? undefined
      : await this.supabaseService.archiveTradebook({
          content: csvContent,
          fileName,
          userId: user.id
        });

    if (archiveUrl) {
      Logger.log(
        `Archived the trade book of user ${user.id} in Supabase Storage`,
        TradebookService.name
      );
    }

    return {
      activities,
      archiveUrl,
      chargesTotal: tradesToImport.reduce((total, { charges }) => {
        return total + charges;
      }, 0),
      duplicateCount,
      errors,
      importedCount: isDryRun ? 0 : tradesToImport.length,
      isDryRun,
      trades: tradesToImport,
      warnings
    };
  }

  /**
   * Fingerprints of the trades of the user that are already stored, so a
   * weekly upload can be replayed without creating duplicates.
   */
  private async getExistingSignatures({
    trades,
    userId
  }: {
    trades: ParsedTrade[];
    userId: string;
  }): Promise<Set<string>> {
    if (trades.length === 0) {
      return new Set<string>();
    }

    const timestamps = trades.map(({ date }) => {
      return new Date(date).getTime();
    });
    const firstDate = new Date(Math.min(...timestamps));
    const lastDate = new Date(Math.max(...timestamps));

    // Compare whole days only, the time of a trade is not part of the
    // fingerprint
    firstDate.setUTCHours(0, 0, 0, 0);
    lastDate.setUTCHours(23, 59, 59, 999);

    const orders = await this.prismaService.order.findMany({
      select: {
        comment: true,
        date: true,
        quantity: true,
        SymbolProfile: { select: { symbol: true } },
        type: true,
        unitPrice: true
      },
      where: {
        date: { gte: firstDate, lte: lastDate },
        userId
      }
    });

    return new Set(
      orders.map(
        ({ comment, date, quantity, SymbolProfile, type, unitPrice }) => {
          return getTradeSignature({
            date: date.toISOString(),
            orderId: comment?.match(/^Order (.+)$/)?.[1],
            quantity,
            symbol: SymbolProfile.symbol,
            type,
            unitPrice
          });
        }
      )
    );
  }
}
