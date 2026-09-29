import type { Activity } from '@ghostfolio/common/interfaces';

import type { Type as ActivityType } from '@prisma/client';

export interface TradebookCsvRow {
  [key: string]: string;
}

export interface ParsedTrade {
  account?: string;
  /** Total charges of the trade (brokerage + STT + GST + stamp duty + ...) */
  charges: number;
  currency: string;
  /** ISO 8601 date of the trade */
  date: string;
  /** Broker order / trade id, used to avoid importing a trade twice */
  orderId?: string;
  /** 1-based row number of the source file (header excluded) */
  rowNumber: number;
  /** Symbol as written in the source file */
  rawSymbol: string;
  /** Symbol as Ghostfolio resolves it (e.g. `RELIANCE.NS`) */
  symbol: string;
  type: ActivityType;
  unitPrice: number;
  quantity: number;
}

export interface TradebookParseError {
  message: string;
  rowNumber: number;
}

export interface TradebookParseResult {
  /** Sum of all charges in the file */
  chargesTotal: number;
  /** Exchange used when the file does not specify one */
  defaultExchange: string;
  /** Maps a canonical field (e.g. `unitPrice`) to the detected CSV column */
  detectedColumns: Record<string, string>;
  errors: TradebookParseError[];
  /** `true` when the file looks like a trade book (buy/sell rows) */
  isTradebook: boolean;
  /** Rows that were recognized as trades but are invalid */
  skippedRows: number;
  trades: ParsedTrade[];
  warnings: string[];
}

export interface ParsedHolding {
  /** Average buy price per share */
  averageUnitPrice: number;
  currency: string;
  isin?: string;
  /** Last traded price of the file, if it has one */
  lastPrice?: number;
  name?: string;
  quantity: number;
  /** Symbol as Ghostfolio resolves it (e.g. `RELIANCE.NS`) */
  symbol: string;
}

export interface HoldingsParseResult {
  currency: string;
  /** Statement date of the file, if it has one */
  date?: string;
  detectedColumns?: Record<string, string>;
  errors: TradebookParseError[];
  holdings: ParsedHolding[];
  /** `true` when the file looks like a holdings summary */
  isHoldings: boolean;
  /** Rows without a scrip (subtotals) or without a position */
  skippedRows: number;
  warnings: string[];
}

export interface ParseHoldingsCsvParams {
  csvContent: string;
  /** Currency used for the positions (default `INR`) */
  defaultCurrency?: string;
  /** Exchange used when the file has no exchange column (default `NSE`) */
  defaultExchange?: string;
}

export interface ParseTradebookCsvParams {
  /** Default account name to assign to the imported activities */
  account?: string;
  csvContent: string;
  /** Currency used when the file has no currency column (default `INR`) */
  defaultCurrency?: string;
  /** Exchange used when the file has no exchange column (default `NSE`) */
  defaultExchange?: string;
}

/** Result of a weekly trade book upload (`POST /api/v1/import/tradebook`) */
export interface TradebookImportResponse {
  /** Activities as they were created (or as they would be created) */
  activities: Activity[];
  /** Supabase Storage URL of the archived file, when configured */
  archiveUrl?: string;
  /** Charges of the imported trades */
  chargesTotal: number;
  /** Trades that were skipped because they were imported before */
  duplicateCount: number;
  errors: TradebookParseError[];
  /** Number of activities written to the database */
  importedCount: number;
  isDryRun: boolean;
  /** Trades that were (or would be) imported */
  trades: ParsedTrade[];
  warnings: string[];
}
