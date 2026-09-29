import { parse as csvToJson } from 'papaparse';

import {
  DEFAULT_INDIAN_CURRENCY,
  DEFAULT_INDIAN_EXCHANGE,
  normalizeIndianSymbol,
  parseIndianNumber,
  parseIndianTradeDate,
  parseIndianTradeType
} from './india-market.helper';
import type {
  ParseTradebookCsvParams,
  ParsedTrade,
  TradebookParseError,
  TradebookParseResult
} from './tradebook.interfaces';

/**
 * Columns of the weekly upload template. Every other column name below is
 * an alias of one of these, so a file from most Indian brokers imports
 * without editing it.
 */
export const TRADEBOOK_TEMPLATE_HEADERS = [
  'date',
  'symbol',
  'exchange',
  'type',
  'quantity',
  'price',
  'charges',
  'account',
  'orderId'
];

/**
 * Canonical field -> accepted CSV column names (normalized, see
 * `normalizeHeader`). Keeps broker specific spellings out of the app.
 */
const COLUMN_ALIASES: Record<string, string[]> = {
  account: ['account', 'accountname', 'accountid', 'broker', 'platform'],
  currency: ['currency', 'ccy', 'currencycode'],
  date: [
    'date',
    'tradedate',
    'transactiondate',
    'orderdate',
    'orderexecutiontime',
    'exchangeordertime',
    'tradetime',
    'executiontime',
    'exchangeexecutiontime',
    'ordertime',
    'filldate'
  ],
  exchange: ['exchange', 'exch', 'segment', 'exchsegment', 'market'],
  gst: ['gst', 'gsttotal', 'cgst', 'sgst', 'igst', 'gstcharges'],
  isin: ['isin', 'isincode'],
  orderId: [
    'orderid',
    'orderno',
    'ordernumber',
    'orderref',
    'orderreference',
    'tradeid',
    'tradeno',
    'transactionid',
    'dealid',
    'fillid'
  ],
  otherCharges: [
    'othercharges',
    'dpcharges',
    'clearingcharges',
    'platformfee',
    'autosquareoffcharges',
    'misccharges',
    'additionalcharges'
  ],
  price: [
    'price',
    'tradeprice',
    'tradedprice',
    'averageprice',
    'avgprice',
    'avgtradedprice',
    'averageexecutedprice',
    'executionprice',
    'fillprice',
    'unitprice',
    'rate'
  ],
  quantity: [
    'quantity',
    'qty',
    'tradedquantity',
    'tradedqty',
    'quantitytraded',
    'filledqty',
    'filledquantity',
    'executedquantity',
    'shares',
    'units',
    'noofshares'
  ],
  sebiCharges: ['sebicharges', 'sebiturnovercharges'],
  stampDuty: ['stampduty', 'stampdutycharges', 'stampcharges'],
  stt: ['stt', 'stttotal', 'securitiestransactiontax'],
  symbol: [
    'symbol',
    'tradingsymbol',
    'symbolname',
    'scrip',
    'scripname',
    'script',
    'stock',
    'ticker',
    'instrument',
    'security'
  ],
  totalCharges: [
    'charges',
    'totalcharges',
    'totalchargestaxes',
    'totalbrokeragecharges',
    'totalfee',
    'totalfees',
    'fee',
    'fees'
  ],
  transactionCharges: [
    'transactioncharges',
    'exchangetransactioncharges',
    'exchangetransactioncharge',
    'exchangetxncharges',
    'brokeragecharges',
    'brokerage'
  ],
  type: [
    'type',
    'transactiontype',
    'buysell',
    'buyorsell',
    'buyorsellflag',
    'tradetype',
    'action',
    'side'
  ],
  value: [
    'value',
    'tradedvalue',
    'turnover',
    'netamount',
    'netvalue',
    'totalvalue'
  ]
};

/** Charge columns that are summed up when the file has no total column */
const CHARGE_COMPONENT_FIELDS = [
  'transactionCharges',
  'stt',
  'gst',
  'stampDuty',
  'sebiCharges',
  'otherCharges'
];

/** The CSV template offered as a download in the import dialog */
export function getTradebookCsvTemplate(): string {
  return [
    TRADEBOOK_TEMPLATE_HEADERS.join(','),
    '22-09-2026,RELIANCE,NSE,BUY,10,1420.50,22.40,Zerodha,2609220000123',
    '23-09-2026,TCS,NSE,SELL,5,3890.10,18.75,Zerodha,2609230000456'
  ].join('\n');
}

/**
 * Parses a weekly trade book (CSV) into Ghostfolio activities.
 *
 * Handles day-first dates, `-EQ` scrip suffixes, split broker charges,
 * Indian number formatting and missing price columns (derived from the
 * trade value). Problems never abort the whole import: each row reports
 * its own error so the user can fix the file and re-upload it.
 */
export function parseTradebookCsv({
  account,
  csvContent,
  defaultCurrency = DEFAULT_INDIAN_CURRENCY,
  defaultExchange = DEFAULT_INDIAN_EXCHANGE
}: ParseTradebookCsvParams): TradebookParseResult {
  const result: TradebookParseResult = {
    chargesTotal: 0,
    defaultExchange,
    detectedColumns: {},
    errors: [],
    isTradebook: false,
    skippedRows: 0,
    trades: [],
    warnings: []
  };

  if (!csvContent?.trim()) {
    result.errors.push({
      message: 'The file is empty',
      rowNumber: 0
    });

    return result;
  }

  const parsedCsv = csvToJson<Record<string, string>>(csvContent.trim(), {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (header: string) => {
      return header.trim();
    }
  });

  const rows = (parsedCsv.data ?? []).filter((row) => {
    return Object.keys(row ?? {}).length > 0;
  });
  const headers = (parsedCsv.meta.fields ?? []).filter((header) => {
    return Boolean(header?.trim());
  });

  if (headers.length === 0 || rows.length === 0) {
    result.errors.push({
      message: 'No rows found in the file',
      rowNumber: 0
    });

    return result;
  }

  const detectedColumns = mapColumns(headers);

  result.detectedColumns = detectedColumns;
  result.isTradebook = Boolean(
    detectedColumns.symbol &&
    detectedColumns.type &&
    detectedColumns.quantity &&
    detectedColumns.date
  );

  if (!result.isTradebook) {
    result.errors.push({
      message: `The file does not look like a trade book. Expected columns for symbol, type, quantity and date, found: ${headers.join(', ')}`,
      rowNumber: 0
    });

    return result;
  }

  if (!detectedColumns.price && detectedColumns.value) {
    result.warnings.push(
      'The file has no price column, prices are derived from the trade value'
    );
  }

  const signaturesOfFile = new Set<string>();

  for (const [index, row] of rows.entries()) {
    const rowNumber = index + 1;
    const valueOf = (field: string) => {
      const column = detectedColumns[field];

      return column ? row[column] : undefined;
    };

    const rawSymbol = valueOf('symbol')?.trim();

    // Skip subtotal / summary rows without a scrip
    if (!rawSymbol) {
      result.skippedRows++;

      continue;
    }

    const type = parseIndianTradeType(valueOf('type'));

    if (type === null) {
      result.errors.push({
        message: `Unsupported transaction type "${valueOf('type') ?? ''}" (expected BUY or SELL)`,
        rowNumber
      });

      continue;
    }

    const date = parseIndianTradeDate(valueOf('date'));

    if (date === null) {
      result.errors.push({
        message: `Invalid date "${valueOf('date') ?? ''}"`,
        rowNumber
      });

      continue;
    }

    const quantity = parseIndianNumber(valueOf('quantity'));

    if (quantity === null || quantity === 0) {
      result.errors.push({
        message: `Invalid quantity "${valueOf('quantity') ?? ''}"`,
        rowNumber
      });

      continue;
    }

    let unitPrice = parseIndianNumber(valueOf('price'));

    if (unitPrice === null) {
      const value = parseIndianNumber(valueOf('value'));

      if (value !== null) {
        unitPrice = value / quantity;
      }
    }

    if (unitPrice === null || unitPrice === 0) {
      result.errors.push({
        message: `Invalid price "${valueOf('price') ?? ''}"`,
        rowNumber
      });

      continue;
    }

    const trade: ParsedTrade = {
      account: valueOf('account')?.trim() || account,
      charges: Math.abs(getCharges({ detectedColumns, row })),
      currency: (valueOf('currency') || defaultCurrency).trim().toUpperCase(),
      date: date.toISOString(),
      orderId: valueOf('orderId')?.trim() || undefined,
      quantity: Math.abs(quantity),
      rawSymbol,
      rowNumber,
      symbol: normalizeIndianSymbol({
        defaultExchange,
        exchange: valueOf('exchange'),
        symbol: rawSymbol
      }),
      type,
      unitPrice: Math.abs(unitPrice)
    };

    const signature = getTradeSignature(trade);

    if (signaturesOfFile.has(signature)) {
      result.warnings.push(
        `Row ${rowNumber} is a duplicate of an earlier row and was skipped`
      );

      continue;
    }

    signaturesOfFile.add(signature);
    result.chargesTotal += trade.charges;
    result.trades.push(trade);
  }

  return result;
}

/**
 * Stable fingerprint of a trade. Used to detect the same trade inside one
 * upload and, on the server, to detect trades that have been imported
 * before (weekly uploads usually contain overlapping rows).
 */
export function getTradeSignature({
  date,
  orderId,
  quantity,
  symbol,
  type,
  unitPrice
}: {
  date: string;
  orderId?: string;
  quantity: number;
  symbol: string;
  type: string;
  unitPrice: number;
}): string {
  const day = date.slice(0, 10);

  if (orderId) {
    return `${day}|${symbol}|${orderId}`;
  }

  return [
    day,
    symbol.toUpperCase(),
    type,
    round(quantity),
    round(unitPrice)
  ].join('|');
}

/**
 * `true` when the CSV headers look like a trade book, so the importer can
 * pick the right parser without asking the user.
 */
export function isTradebookCsv(aCsvContent: string): boolean {
  const firstLine = aCsvContent?.split('\n').find((line) => {
    return line.trim().length > 0;
  });

  if (!firstLine) {
    return false;
  }

  const headers = firstLine.split(',').map((header) => {
    return normalizeHeader(header);
  });

  return Boolean(
    hasAlias(headers, 'symbol') &&
    hasAlias(headers, 'quantity') &&
    hasAlias(headers, 'type')
  );
}

function getCharges({
  detectedColumns,
  row
}: {
  detectedColumns: Record<string, string>;
  row: Record<string, string>;
}): number {
  const totalColumn = detectedColumns.totalCharges;

  if (totalColumn) {
    const total = parseIndianNumber(row[totalColumn]);

    if (total !== null) {
      return Math.abs(total);
    }
  }

  return CHARGE_COMPONENT_FIELDS.reduce((total, field) => {
    const column = detectedColumns[field];

    if (!column) {
      return total;
    }

    const value = parseIndianNumber(row[column]);

    return value === null ? total : total + Math.abs(value);
  }, 0);
}

function hasAlias(aHeaders: string[], aField: string): boolean {
  const aliases = COLUMN_ALIASES[aField] ?? [];

  return aHeaders.some((header) => {
    return aliases.includes(header);
  });
}

/** Maps canonical fields to the columns found in the file */
function mapColumns(aHeaders: string[]): Record<string, string> {
  const normalizedHeaders = aHeaders.map((header) => {
    return { normalized: normalizeHeader(header), original: header.trim() };
  });
  const mapping: Record<string, string> = {};

  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    for (const alias of aliases) {
      const match = normalizedHeaders.find(({ normalized }) => {
        return normalized === alias;
      });

      if (match && !mapping[field]) {
        mapping[field] = match.original;
      }
    }
  }

  return mapping;
}

/** `Trade Date` -> `tradedate`, `Buy/Sell` -> `buysell` */
function normalizeHeader(aHeader: string): string {
  return String(aHeader ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function round(aValue: number): number {
  return Math.round(aValue * 1e4) / 1e4;
}
