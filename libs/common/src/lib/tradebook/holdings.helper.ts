import { parse as csvToJson } from 'papaparse';

import {
  DEFAULT_INDIAN_CURRENCY,
  DEFAULT_INDIAN_EXCHANGE,
  normalizeIndianSymbol,
  parseIndianNumber,
  parseIndianTradeDate
} from './india-market.helper';
import type {
  ParseHoldingsCsvParams,
  HoldingsParseResult,
  ParsedHolding
} from './tradebook.interfaces';

/**
 * Columns of a holdings template (equity summary as of a date).
 */
export const HOLDINGS_TEMPLATE_HEADERS = [
  'symbol',
  'isin',
  'name',
  'quantity',
  'averageUnitPrice',
  'lastPrice'
];

/** Canonical field -> accepted CSV column names (normalized) */
const HOLDINGS_COLUMN_ALIASES: Record<string, string[]> = {
  averageUnitPrice: [
    'averageunitprice',
    'avgunitprice',
    'avgprice',
    'averageprice',
    'avgbuyprice',
    'averagebuyprice',
    'avgcost',
    'averagecost',
    'averagecostprice',
    'costprice',
    'buyaverage',
    'purchaseprice',
    'avgrate',
    'averagerate',
    'acquisitioncost',
    'avg',
    'buyprice',
    'averagebuycost'
  ],
  date: [
    'date',
    'asondate',
    'ason',
    'statementdate',
    'holdingdate',
    'reportingdate',
    'valuedate'
  ],
  investedAmount: [
    'investedamount',
    'investmentamount',
    'costvalue',
    'totalcost',
    'investmentvalue',
    'bookcost',
    'totalinvestment'
  ],
  isin: ['isin', 'isincode', 'isinno', 'isinnumber'],
  lastPrice: [
    'ltp',
    'lasttradedprice',
    'lasttrprice',
    'lastprice',
    'currentprice',
    'currentmktprice',
    'closeprice',
    'closingprice',
    'cmp',
    'marketprice',
    'prevclose',
    'lastclose'
  ],
  marketValue: [
    'marketvalue',
    'currentvalue',
    'presentvalue',
    'mktvalue',
    'valuation',
    'marketval'
  ],
  name: [
    'companyname',
    'securityname',
    'scripname',
    'stockname',
    'nameofsecurity',
    'name',
    'instrumentname',
    'description'
  ],
  quantity: [
    'quantity',
    'qty',
    'shares',
    'units',
    'holdingqty',
    'holdingquantity',
    'netqty',
    'netquantity',
    'balance',
    'balanceqty',
    'closingbalance',
    'closingqty',
    'totalqty',
    'freebalance',
    'quantityheld'
  ],
  symbol: [
    'symbol',
    'tradingsymbol',
    'scrip',
    'script',
    'stock',
    'ticker',
    'instrument',
    'security',
    'scripcode',
    'symbolname',
    'nseticker'
  ]
};

/** The CSV template offered as a download */
export function getHoldingsCsvTemplate(): string {
  return [
    HOLDINGS_TEMPLATE_HEADERS.join(','),
    'RELIANCE,INE002A01018,Reliance Industries Ltd,10,1420.50,1466.30',
    'TCS,INE467B01029,Tata Consultancy Services Ltd,5,3890.10,3942.15'
  ].join('\n');
}

/**
 * Parses a holdings summary (the equity summary many brokers send) into
 * positions.
 *
 * A holdings file describes what is in the portfolio today — symbol,
 * quantity and average buy price — instead of the individual buys and
 * sells. Uploading it replaces the positions of the portfolio with the
 * ones in the file, which is the fastest way to bring the tracker in sync
 * with the broker statement.
 */
export function parseHoldingsCsv({
  csvContent,
  defaultCurrency = DEFAULT_INDIAN_CURRENCY,
  defaultExchange = DEFAULT_INDIAN_EXCHANGE
}: ParseHoldingsCsvParams): HoldingsParseResult {
  const result: HoldingsParseResult = {
    currency: defaultCurrency,
    errors: [],
    holdings: [],
    isHoldings: false,
    skippedRows: 0,
    warnings: []
  };

  if (!csvContent?.trim()) {
    result.errors.push({ message: 'The file is empty', rowNumber: 0 });

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
  result.isHoldings = Boolean(
    (detectedColumns.symbol || detectedColumns.isin || detectedColumns.name) &&
    detectedColumns.quantity
  );

  if (!result.isHoldings) {
    result.errors.push({
      message: `The file does not look like a holdings summary. Expected a column for the symbol, ISIN or company name and one for the quantity, found: ${headers.join(', ')}`,
      rowNumber: 0
    });

    return result;
  }

  const statementDate = detectedColumns.date
    ? parseIndianTradeDate(
        rows.map((row) => {
          return row[detectedColumns.date];
        })[0]
      )
    : undefined;

  if (statementDate) {
    result.date = statementDate.toISOString();
  }

  for (const [index, row] of rows.entries()) {
    const rowNumber = index + 1;
    const valueOf = (field: string) => {
      const column = detectedColumns[field];

      return column ? row[column] : undefined;
    };

    const rawSymbol = (valueOf('symbol') ?? '').trim();
    const rawName = (valueOf('name') ?? '').trim();
    const isin = valueOf('isin')?.trim();
    const identifier = rawSymbol || rawName || isin || '';
    const quantity = parseIndianNumber(valueOf('quantity'));

    // Skip subtotal / summary rows
    if (!identifier || isSubtotalRow(identifier)) {
      result.skippedRows++;

      continue;
    }

    if (quantity === null) {
      result.errors.push({
        message: `Invalid quantity "${valueOf('quantity') ?? ''}"`,
        rowNumber
      });

      continue;
    }

    if (quantity === 0) {
      result.skippedRows++;

      continue;
    }

    let averageUnitPrice = parseIndianNumber(valueOf('averageUnitPrice'));

    if (averageUnitPrice === null) {
      const investedAmount = parseIndianNumber(valueOf('investedAmount'));

      if (investedAmount !== null && quantity !== 0) {
        averageUnitPrice = Math.abs(investedAmount / quantity);
      }
    }

    const lastPrice = parseIndianNumber(valueOf('lastPrice'));

    if (averageUnitPrice === null) {
      if (lastPrice === null) {
        result.errors.push({
          message: `Neither an average buy price nor a last price for "${rawSymbol || isin}"`,
          rowNumber
        });

        continue;
      }

      // Without a buy price the position is valued at the market price,
      // which means it starts with a profit of zero
      averageUnitPrice = lastPrice;
      result.warnings.push(
        `Row ${rowNumber}: no average buy price for ${rawSymbol || isin}, using the last price`
      );
    }

    // A broker summary either has a ticker column or a company name. Short
    // values without spaces are tickers, longer ones are company names.
    const tickerCandidate =
      rawSymbol || (looksLikeTicker(rawName) ? rawName : '');
    const symbol = tickerCandidate
      ? normalizeIndianSymbol({
          defaultExchange,
          symbol: tickerCandidate
        })
      : isin || normalizeIndianSymbol({ defaultExchange, symbol: rawName });

    if (!tickerCandidate && rawName) {
      result.warnings.push(
        `Row ${rowNumber}: no ticker column found, the symbol of "${rawName}" was derived from the company name — please check it`
      );
    }

    result.holdings.push({
      averageUnitPrice: Math.abs(averageUnitPrice),
      currency: defaultCurrency,
      isin: isin || undefined,
      lastPrice: lastPrice === null ? undefined : Math.abs(lastPrice),
      name: rawName || undefined,
      quantity: Math.abs(quantity),
      symbol
    });
  }

  return result;
}

/**
 * `true` when the CSV headers describe holdings (a position per row)
 * instead of individual trades.
 */
export function isHoldingsCsv(aCsvContent: string): boolean {
  const firstLine = aCsvContent?.split('\n').find((line) => {
    return line.trim().length > 0;
  });

  if (!firstLine) {
    return false;
  }

  const headers = firstLine.split(',').map((header) => {
    return normalizeHeader(header);
  });

  const hasQuantity = headers.some((header) => {
    return (HOLDINGS_COLUMN_ALIASES.quantity ?? []).includes(header);
  });
  const hasSymbol = headers.some((header) => {
    return [
      ...(HOLDINGS_COLUMN_ALIASES.symbol ?? []),
      ...(HOLDINGS_COLUMN_ALIASES.isin ?? []),
      ...(HOLDINGS_COLUMN_ALIASES.name ?? [])
    ].includes(header);
  });
  const hasTradeType = headers.some((header) => {
    return [
      'type',
      'transactiontype',
      'buysell',
      'tradetype',
      'action',
      'side'
    ].includes(header);
  });

  return hasQuantity && hasSymbol && !hasTradeType;
}

/** Tickers have no spaces, company names have */
function looksLikeTicker(aValue: string): boolean {
  return /^[A-Za-z0-9&.\-]{1,20}$/.test(aValue.trim());
}

/** Subtotals such as "Total", "Grand Total" or "Net" are not positions */
function isSubtotalRow(aIdentifier: string): boolean {
  return /^(grand\s*)?(total|subtotal|net|summary|sum)(\s|$)/i.test(
    aIdentifier.trim()
  );
}

function mapColumns(aHeaders: string[]): Record<string, string> {
  const normalizedHeaders = aHeaders.map((header) => {
    return { normalized: normalizeHeader(header), original: header.trim() };
  });
  const mapping: Record<string, string> = {};

  for (const [field, aliases] of Object.entries(HOLDINGS_COLUMN_ALIASES)) {
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

function normalizeHeader(aHeader: string): string {
  return String(aHeader ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}
