import type { Type as ActivityType } from '@prisma/client';

/**
 * Helpers for the Indian equity market (NSE / BSE).
 *
 * Indian brokers export trade books in many different shapes (day-first
 * dates, `-EQ` scrip suffixes, charges split into half a dozen columns,
 * `₹` and lakh/crore style grouping). These helpers normalize that mess
 * into the values Ghostfolio expects.
 */

export const DEFAULT_INDIAN_CURRENCY = 'INR';
export const DEFAULT_INDIAN_EXCHANGE = 'NSE';

export const INDIAN_EXCHANGE_SUFFIXES = {
  BSE: '.BO',
  NSE: '.NS'
} as const;

const MONTHS = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec'
];

/**
 * Turns a raw Indian scrip symbol into a symbol that Yahoo Finance (and
 * therefore Ghostfolio) can resolve:
 *
 * - `reliance`      -> `RELIANCE.NS`
 * - `RELIANCE-EQ`   -> `RELIANCE.NS`
 * - `TCS` (BSE)     -> `TCS.BO`
 * - `INFY.NS`       -> `INFY.NS` (untouched)
 */
export function normalizeIndianSymbol({
  defaultExchange = DEFAULT_INDIAN_EXCHANGE,
  exchange,
  symbol
}: {
  defaultExchange?: string;
  exchange?: string;
  symbol: string;
}): string {
  if (!symbol) {
    return '';
  }

  let normalizedSymbol = String(symbol).trim().toUpperCase();

  // Drop whitespace (e.g. "RELIANCE INDUSTRIES")
  normalizedSymbol = normalizedSymbol.replace(/\s+/g, '');

  // Drop the trading series suffixes used by NSE / BSE exports
  normalizedSymbol = normalizedSymbol.replace(
    /[_-](EQ|BE|SM|GB|BL|SG|ST|MF)$/,
    ''
  );

  // Normalize broker specific exchange suffixes
  normalizedSymbol = normalizedSymbol.replace(
    /\.NSE$/,
    INDIAN_EXCHANGE_SUFFIXES.NSE
  );
  normalizedSymbol = normalizedSymbol.replace(
    /\.BSE$/,
    INDIAN_EXCHANGE_SUFFIXES.BSE
  );

  // Already qualified? Keep it as is.
  if (/\.(NS|BO)$/.test(normalizedSymbol)) {
    return normalizedSymbol;
  }

  const resolvedExchange = normalizeIndianExchange(exchange ?? defaultExchange);

  return `${normalizedSymbol}${INDIAN_EXCHANGE_SUFFIXES[resolvedExchange]}`;
}

export function normalizeIndianExchange(aExchange?: string): 'BSE' | 'NSE' {
  const exchange = String(aExchange ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, '');

  if (['BSE', 'BSEEQ', 'BSECM', 'BOMBAY', 'BO', 'B'].includes(exchange)) {
    return 'BSE';
  }

  return 'NSE';
}

/**
 * Parses the date formats found in Indian broker exports. Day comes first
 * (`22-09-2026`, `22/Sep/2026`), next to ISO timestamps, `dd-MMM-yyyy`
 * order execution times and Excel serial numbers.
 *
 * Returns `null` when the value cannot be interpreted as a date.
 */
export function parseIndianTradeDate(
  aValue: string | number | Date | null | undefined
): Date | null {
  if (aValue === null || aValue === undefined || aValue === '') {
    return null;
  }

  if (aValue instanceof Date) {
    return Number.isNaN(aValue.getTime()) ? null : aValue;
  }

  const value = String(aValue).trim();

  if (!value || ['-', '--', 'N/A', 'NA', 'NIL'].includes(value.toUpperCase())) {
    return null;
  }

  // Excel serial number (e.g. 46250)
  if (/^\d{5}(\.\d+)?$/.test(value)) {
    const days = Number(value);
    const excelEpoch = Date.UTC(1899, 11, 30);

    return new Date(excelEpoch + days * 24 * 60 * 60 * 1000);
  }

  // ISO: 2026-09-22, 2026-09-22T09:53:12, 2026-09-22 09:53:12
  const isoMatch = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](.*))?$/);

  if (isoMatch) {
    const [, year, month, day, time] = isoMatch;
    const milliseconds = time ? parseTimeToMilliseconds(time) : 0;

    return new Date(
      Date.UTC(Number(year), Number(month) - 1, Number(day)) + milliseconds
    );
  }

  // 22-Sep-2026, 22 Sep 2026, 22-SEP-26
  const monthNameMatch = value.match(
    /^(\d{1,2})[-\/. ]([A-Za-z]{3,9})[-\/. ](\d{2,4})(?:[ T](.*))?$/
  );

  if (monthNameMatch) {
    const [, day, monthName, year, time] = monthNameMatch;
    const monthIndex = MONTHS.indexOf(monthName.slice(0, 3).toLowerCase());

    if (monthIndex > -1) {
      const milliseconds = time ? parseTimeToMilliseconds(time) : 0;

      return new Date(
        Date.UTC(expandYear(Number(year)), monthIndex, Number(day)) +
          milliseconds
      );
    }
  }

  // 22-09-2026, 22/09/2026, 22.09.26 (day first, as used in India)
  const dayFirstMatch = value.match(
    /^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})(?:[ T](.*))?$/
  );

  if (dayFirstMatch) {
    const [, day, month, year, time] = dayFirstMatch;
    const milliseconds = time ? parseTimeToMilliseconds(time) : 0;

    return new Date(
      Date.UTC(expandYear(Number(year)), Number(month) - 1, Number(day)) +
        milliseconds
    );
  }

  // Last resort: let the runtime try (handles "Sep 22, 2026" etc.)
  const fallbackDate = new Date(value);

  return Number.isNaN(fallbackDate.getTime()) ? null : fallbackDate;
}

/**
 * Parses numbers as they appear in Indian broker exports:
 * `1,23,456.78`, `₹ 1,234.00`, `(1,234.00)`, `--`, `1.23 Cr`.
 */
export function parseIndianNumber(
  aValue: string | number | null | undefined
): number | null {
  if (typeof aValue === 'number') {
    return Number.isFinite(aValue) ? aValue : null;
  }

  if (typeof aValue !== 'string') {
    return null;
  }

  let value = aValue.trim();

  if (
    !value ||
    ['-', '--', 'N/A', 'NA', 'NIL', 'NULL'].includes(value.toUpperCase())
  ) {
    return null;
  }

  let isNegative = false;

  if (/^\(.*\)$/.test(value)) {
    isNegative = true;
    value = value.slice(1, -1);
  }

  value = value.replace(/[₹$€£,%\s]/g, '').replace(/^(INR|USD|EUR|GBP)/i, '');

  if (value.startsWith('-')) {
    isNegative = !isNegative;
    value = value.slice(1);
  } else if (value.startsWith('+')) {
    value = value.slice(1);
  }

  const number = Number(value);

  if (!Number.isFinite(number)) {
    return null;
  }

  return isNegative ? -number : number;
}

/**
 * Maps the many spellings of an Indian trade direction to an activity type.
 * Anything that is not a buy or a sell (dividends, bonus, etc.) returns
 * `null` so the caller can surface a useful error.
 */
export function parseIndianTradeType(
  aValue: string | number | null | undefined
): ActivityType | null {
  const value = String(aValue ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, '');

  if (['BUY', 'B', 'PURCHASE', 'BOUGHT', 'BUYBACK'].includes(value)) {
    return 'BUY' as ActivityType;
  }

  if (['SELL', 'S', 'SALE', 'SOLD', 'SQUAREOFF'].includes(value)) {
    return 'SELL' as ActivityType;
  }

  return null;
}

function expandYear(aYear: number): number {
  if (aYear > 99) {
    return aYear;
  }

  // Two digit years belong to the current century
  return aYear < 70 ? 2000 + aYear : 1900 + aYear;
}

function parseTimeToMilliseconds(aTime: string): number {
  const match = aTime.trim().match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);

  if (!match) {
    return 0;
  }

  const [, hours, minutes, seconds] = match;

  return (
    (Number(hours) * 60 * 60 + Number(minutes) * 60 + Number(seconds ?? 0)) *
    1000
  );
}
