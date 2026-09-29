import { ImportService } from '@ghostfolio/api/app/import/import.service';
import { ConfigurationService } from '@ghostfolio/api/services/configuration/configuration.service';
import { PrismaService } from '@ghostfolio/api/services/prisma/prisma.service';
import { SupabaseService } from '@ghostfolio/api/services/supabase/supabase.service';
import { DEFAULT_INDIAN_CURRENCY } from '@ghostfolio/common/tradebook';
import {
  getPositionAdjustments,
  getTradeSignature,
  parseHoldingsCsv,
  parseTradebookCsv
} from '@ghostfolio/common/tradebook';
import type {
  HoldingsSyncResponse,
  ParsedTrade,
  TradebookImportResponse
} from '@ghostfolio/common/tradebook';

import { UserWithSettings } from '@ghostfolio/common/types';

import { HttpException, Injectable, Logger } from '@nestjs/common';
import { DataSource, Type as ActivityType } from '@prisma/client';
import { StatusCodes, getReasonPhrase } from 'http-status-codes';

import { ImportHoldingsDto } from './import-holdings.dto';
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
    user: UserWithSettings;
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
        user
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
   * Reconciles the portfolio with a holdings summary of the broker
   * (`PortFolioEqtSummary.csv`).
   *
   * For every position in the file the quantity is compared with the
   * quantity Ghostfolio holds. The difference is imported as one
   * adjustment activity, so the portfolio ends up matching the statement:
   *
   * - the broker has more shares -> a BUY adjustment
   * - the broker has fewer shares -> a SELL adjustment (at the last price)
   * - the quantities match -> nothing happens
   *
   * Running the sync twice with the same file creates nothing the second
   * time, which makes it safe for a weekly job.
   */
  public async syncHoldings({
    account,
    accountId,
    closeMissingPositions = false,
    csvContent,
    defaultExchange,
    fileName,
    isDryRun = false,
    user
  }: ImportHoldingsDto & {
    isDryRun?: boolean;
    user: UserWithSettings;
  }): Promise<HoldingsSyncResponse> {
    const { date, errors, holdings, isHoldings, warnings } = parseHoldingsCsv({
      csvContent,
      defaultExchange
    });

    if (!isHoldings) {
      throw new HttpException(
        {
          error: getReasonPhrase(StatusCodes.BAD_REQUEST),
          message: [
            errors[0]?.message ??
              'The file does not look like a holdings summary (a symbol or ISIN column and a quantity column are required)'
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

    const statementDate = date ? new Date(date) : new Date();
    const positionsOfUser = await this.getPositions({ userId: user.id });

    const { adjustments, buyCount, missing, sellCount, unchangedCount } =
      getPositionAdjustments({
        fileName,
        holdings,
        positions: Object.fromEntries(positionsOfUser.quantities),
        statementDate: statementDate.toISOString()
      });

    const activitiesDto = adjustments.map((adjustment) => {
      return {
        ...adjustment,
        type: adjustment.type as ActivityType,
        accountId: accountIdToUse,
        updateAccountBalance: false
      };
    });

    if (missing.length > 0) {
      warnings.push(
        `${missing.length} ${
          missing.length === 1 ? 'position is' : 'positions are'
        } held in Ghostfolio but not part of the statement: ${missing.join(', ')}`
      );
    }

    if (closeMissingPositions && missing.length > 0) {
      for (const symbol of missing) {
        const quantity = positionsOfUser.quantities.get(symbol) ?? 0;
        const marketPrice = await this.getLastMarketPrice({
          dataSource: positionsOfUser.dataSources.get(symbol),
          symbol
        });

        if (!marketPrice) {
          warnings.push(
            `Could not close ${symbol}: no market price available`
          );

          continue;
        }

        activitiesDto.push({
          currency: DEFAULT_INDIAN_CURRENCY,
          date: statementDate.toISOString(),
          fee: 0,
          quantity,
          symbol,
          type: ActivityType.SELL,
          unitPrice: marketPrice,
          accountId: accountIdToUse,
          comment: fileName ? `Adjustment from ${fileName}` : undefined,
          updateAccountBalance: false
        });
      }
    }

    let activities: HoldingsSyncResponse['activities'] = [];

    if (activitiesDto.length > 0) {
      activities = await this.importService.import({
        activitiesDto,
        accountsWithBalancesDto: [],
        assetProfilesWithMarketDataDto: [],
        isDryRun,
        platformsDto: [],
        tagsDto: [],
        user
      });
    }

    const archiveUrl = isDryRun
      ? undefined
      : await this.supabaseService.archiveTradebook({
          content: csvContent,
          fileName,
          userId: user.id
        });

    return {
      activities,
      archiveUrl,
      buyCount,
      errors,
      isDryRun,
      missing,
      sellCount,
      statementDate: statementDate.toISOString(),
      unchangedCount,
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

  /** Quantity and data source of every position of the user */
  private async getPositions({
    userId
  }: {
    userId: string;
  }): Promise<{
    dataSources: Map<string, DataSource>;
    quantities: Map<string, number>;
  }> {
    const orders = await this.prismaService.order.findMany({
      select: {
        quantity: true,
        SymbolProfile: {
          select: { dataSource: true, symbol: true }
        },
        type: true
      },
      where: { userId }
    });

    const quantities = new Map<string, number>();
    const dataSources = new Map<string, DataSource>();

    for (const { quantity, SymbolProfile, type } of orders) {
      const symbol = SymbolProfile.symbol;
      const currentQuantity = quantities.get(symbol) ?? 0;

      quantities.set(
        symbol,
        type === 'BUY' ? currentQuantity + quantity : currentQuantity - quantity
      );
      dataSources.set(symbol, SymbolProfile.dataSource);
    }

    return { dataSources, quantities };
  }

  /** Last known market price of a symbol, used to close a position */
  private async getLastMarketPrice({
    dataSource,
    symbol
  }: {
    dataSource?: DataSource;
    symbol: string;
  }): Promise<number | undefined> {
    if (!dataSource) {
      return undefined;
    }

    const marketData = await this.prismaService.marketData.findFirst({
      orderBy: { date: 'desc' },
      select: { marketPrice: true },
      where: { dataSource, symbol }
    });

    return marketData?.marketPrice;
  }
}

function roundToSix(aValue: number): number {
  return Math.round(aValue * 1e6) / 1e6;
}
