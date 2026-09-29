import {
  DEFAULT_INDIAN_CURRENCY,
  DEFAULT_INDIAN_EXCHANGE,
  normalizeIndianExchange,
  normalizeIndianSymbol,
  parseIndianNumber,
  parseIndianTradeDate,
  parseIndianTradeType
} from './india-market.helper';
import {
  getTradebookCsvTemplate,
  getTradeSignature,
  isTradebookCsv,
  parseTradebookCsv
} from './tradebook.helper';

describe('TradebookHelper', () => {
  describe('normalizeIndianSymbol', () => {
    it('adds the NSE suffix by default', () => {
      expect(normalizeIndianSymbol({ symbol: 'reliance' })).toEqual(
        'RELIANCE.NS'
      );
    });

    it('strips the NSE / BSE series suffix', () => {
      expect(normalizeIndianSymbol({ symbol: 'RELIANCE-EQ' })).toEqual(
        'RELIANCE.NS'
      );
      expect(normalizeIndianSymbol({ symbol: 'TCS_EQ' })).toEqual('TCS.NS');
    });

    it('keeps an already qualified symbol', () => {
      expect(normalizeIndianSymbol({ symbol: 'INFY.NS' })).toEqual('INFY.NS');
      expect(normalizeIndianSymbol({ symbol: 'TCS.BO' })).toEqual('TCS.BO');
    });

    it('uses the exchange column', () => {
      expect(normalizeIndianSymbol({ exchange: 'BSE', symbol: 'TCS' })).toEqual(
        'TCS.BO'
      );

      expect(normalizeIndianSymbol({ exchange: 'NSE', symbol: 'TCS' })).toEqual(
        'TCS.NS'
      );
    });

    it('normalizes broker specific exchange suffixes', () => {
      expect(normalizeIndianSymbol({ symbol: 'TCS.BSE' })).toEqual('TCS.BO');
      expect(normalizeIndianSymbol({ symbol: 'TCS.NSE' })).toEqual('TCS.NS');
    });

    it('returns an empty string for an empty symbol', () => {
      expect(normalizeIndianSymbol({ symbol: '' })).toEqual('');
    });
  });

  describe('normalizeIndianExchange', () => {
    it('detects BSE', () => {
      expect(normalizeIndianExchange('BSE')).toEqual('BSE');
      expect(normalizeIndianExchange('bse_eq')).toEqual('BSE');
      expect(normalizeIndianExchange('Bombay')).toEqual('BSE');
    });

    it('falls back to NSE', () => {
      expect(normalizeIndianExchange('NSE')).toEqual('NSE');
      expect(normalizeIndianExchange(undefined)).toEqual('NSE');
      expect(normalizeIndianExchange('NSE_EQ')).toEqual('NSE');
    });
  });

  describe('parseIndianTradeDate', () => {
    it('parses ISO dates', () => {
      expect(parseIndianTradeDate('2026-09-22')?.toISOString()).toEqual(
        '2026-09-22T00:00:00.000Z'
      );
    });

    it('parses day-first dates as used by Indian brokers', () => {
      expect(parseIndianTradeDate('22-09-2026')?.toISOString()).toEqual(
        '2026-09-22T00:00:00.000Z'
      );
      expect(parseIndianTradeDate('22/09/2026')?.toISOString()).toEqual(
        '2026-09-22T00:00:00.000Z'
      );
      expect(parseIndianTradeDate('22.09.2026')?.toISOString()).toEqual(
        '2026-09-22T00:00:00.000Z'
      );
    });

    it('parses month names', () => {
      expect(parseIndianTradeDate('22-Sep-2026')?.toISOString()).toEqual(
        '2026-09-22T00:00:00.000Z'
      );
      expect(parseIndianTradeDate('22 SEP 2026')?.toISOString()).toEqual(
        '2026-09-22T00:00:00.000Z'
      );
    });

    it('parses order execution timestamps', () => {
      expect(
        parseIndianTradeDate('22-09-2026 09:53:12')?.toISOString()
      ).toEqual('2026-09-22T09:53:12.000Z');
      expect(
        parseIndianTradeDate('2026-09-22T09:53:12')?.toISOString()
      ).toEqual('2026-09-22T09:53:12.000Z');
    });

    it('parses Excel serial numbers', () => {
      // Excel serial 46250 is 2026-08-16
      expect(parseIndianTradeDate('46250')?.toISOString()).toEqual(
        '2026-08-16T00:00:00.000Z'
      );
    });

    it('returns null for invalid values', () => {
      expect(parseIndianTradeDate('--')).toBeNull();
      expect(parseIndianTradeDate('')).toBeNull();
      expect(parseIndianTradeDate(undefined)).toBeNull();
      expect(parseIndianTradeDate('not a date')).toBeNull();
    });

    it('rejects dates that do not exist', () => {
      expect(parseIndianTradeDate('31/02/2026')).toBeNull();
      expect(parseIndianTradeDate('2026-02-31')).toBeNull();
      expect(parseIndianTradeDate('32-13-2026')).toBeNull();
    });
  });

  describe('parseIndianNumber', () => {
    it('parses grouped numbers', () => {
      expect(parseIndianNumber('1,23,456.78')).toEqual(123456.78);
      expect(parseIndianNumber('1,234.00')).toEqual(1234);
    });

    it('parses currency symbols', () => {
      expect(parseIndianNumber('₹ 1,234.00')).toEqual(1234);
      expect(parseIndianNumber('INR 1234')).toEqual(1234);
    });

    it('parses parentheses as a negative number', () => {
      expect(parseIndianNumber('(1,234.00)')).toEqual(-1234);
      expect(parseIndianNumber('-1234')).toEqual(-1234);
    });

    it('returns null for placeholders', () => {
      expect(parseIndianNumber('--')).toBeNull();
      expect(parseIndianNumber('N/A')).toBeNull();
    });
  });

  describe('parseIndianTradeType', () => {
    it('parses buy and sell', () => {
      expect(parseIndianTradeType('BUY')).toEqual('BUY');
      expect(parseIndianTradeType('B')).toEqual('BUY');
      expect(parseIndianTradeType('purchase')).toEqual('BUY');
      expect(parseIndianTradeType('SELL')).toEqual('SELL');
      expect(parseIndianTradeType('s')).toEqual('SELL');
    });

    it('returns null for anything else', () => {
      expect(parseIndianTradeType('DIVIDEND')).toBeNull();
      expect(parseIndianTradeType('')).toBeNull();
    });
  });

  describe('parseTradebookCsv', () => {
    it('parses the template', () => {
      const result = parseTradebookCsv({
        csvContent: getTradebookCsvTemplate()
      });

      expect(result.isTradebook).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.trades).toEqual([
        {
          account: 'Zerodha',
          charges: 22.4,
          currency: 'INR',
          date: '2026-09-22T00:00:00.000Z',
          orderId: '2609220000123',
          quantity: 10,
          rawSymbol: 'RELIANCE',
          rowNumber: 1,
          symbol: 'RELIANCE.NS',
          type: 'BUY',
          unitPrice: 1420.5
        },
        {
          account: 'Zerodha',
          charges: 18.75,
          currency: 'INR',
          date: '2026-09-23T00:00:00.000Z',
          orderId: '2609230000456',
          quantity: 5,
          rawSymbol: 'TCS',
          rowNumber: 2,
          symbol: 'TCS.NS',
          type: 'SELL',
          unitPrice: 3890.1
        }
      ]);
    });

    it('parses a broker export with split charges', () => {
      const csvContent = [
        'Trade Date,Trading Symbol,Exchange,Buy/Sell,Traded Qty,Avg Price,Brokerage,STT,Stamp Duty,GST,Other Charges',
        '22-09-2026,RELIANCE-EQ,NSE,BUY,10,1420.50,0.00,1.42,0.71,0.26,0.00',
        '23-09-2026,TCS,NSE,SELL,5,3890.10,0.00,1.95,0.97,0.35,0.00'
      ].join('\n');

      const result = parseTradebookCsv({ csvContent });

      expect(result.errors).toEqual([]);
      expect(result.trades).toHaveLength(2);
      expect(result.trades[0].symbol).toEqual('RELIANCE.NS');
      // 1.42 + 0.71 + 0.26
      expect(result.trades[0].charges).toBeCloseTo(2.39, 4);
      expect(result.chargesTotal).toBeCloseTo(5.66, 4);
    });

    it('prefers a total charges column over the components', () => {
      const csvContent = [
        'date,symbol,type,quantity,price,charges,brokerage,stt',
        '2026-09-22,INFY,BUY,2,1500.00,25.00,20.00,5.00'
      ].join('\n');

      const result = parseTradebookCsv({ csvContent });

      expect(result.trades[0].charges).toEqual(25);
    });

    it('derives the price from the trade value', () => {
      const csvContent = [
        'date,symbol,buy/sell,qty,value',
        '2026-09-22,HDFCBANK,BUY,10,15000.00'
      ].join('\n');

      const result = parseTradebookCsv({ csvContent });

      expect(result.trades[0].unitPrice).toEqual(1500);
      expect(result.warnings).toContain(
        'The file has no price column, prices are derived from the trade value'
      );
    });

    it('reports invalid rows without aborting the import', () => {
      const csvContent = [
        'date,symbol,type,quantity,price',
        '2026-09-22,RELIANCE,BUY,10,1420.50',
        '2026-09-23,RELIANCE,DIVIDEND,10,10.00',
        'not a date,TCS,BUY,1,100.00',
        '2026-09-24,,BUY,1,100.00'
      ].join('\n');

      const result = parseTradebookCsv({ csvContent });

      expect(result.trades).toHaveLength(1);
      expect(result.trades[0].symbol).toEqual('RELIANCE.NS');
      expect(result.errors).toHaveLength(2);
      expect(result.errors[0].message).toContain(
        'Unsupported transaction type'
      );
      expect(result.errors[1].message).toContain('Invalid date');
      expect(result.skippedRows).toEqual(1);
    });

    it('skips duplicates within one file', () => {
      const csvContent = [
        'date,symbol,type,quantity,price',
        '2026-09-22,RELIANCE,BUY,10,1420.50',
        '2026-09-22,RELIANCE,BUY,10,1420.50'
      ].join('\n');

      const result = parseTradebookCsv({ csvContent });

      expect(result.trades).toHaveLength(1);
      expect(result.warnings[0]).toContain('duplicate');
    });

    it('applies a default account and exchange', () => {
      const csvContent = [
        'date,symbol,type,quantity,price',
        '2026-09-22,RELIANCE,BUY,10,1420.50'
      ].join('\n');

      const result = parseTradebookCsv({
        account: 'Zerodha',
        csvContent,
        defaultExchange: 'BSE'
      });

      expect(result.trades[0].symbol).toEqual('RELIANCE.BO');
      expect(result.trades[0].account).toEqual('Zerodha');
      expect(result.trades[0].currency).toEqual(DEFAULT_INDIAN_CURRENCY);
    });

    it('rejects a file that is not a trade book', () => {
      const result = parseTradebookCsv({
        csvContent: 'name,value\nfoo,bar'
      });

      expect(result.isTradebook).toBe(false);
      expect(result.errors[0].message).toContain(
        'does not look like a trade book'
      );
    });

    it('rejects an empty file', () => {
      const result = parseTradebookCsv({ csvContent: '  ' });

      expect(result.errors[0].message).toEqual('The file is empty');
    });
  });

  describe('getTradeSignature', () => {
    it('is stable for the same trade', () => {
      const trade = {
        date: '2026-09-22T00:00:00.000Z',
        quantity: 10,
        symbol: 'RELIANCE.NS',
        type: 'BUY',
        unitPrice: 1420.5
      };

      expect(getTradeSignature(trade)).toEqual(getTradeSignature(trade));
    });

    it('prefers the broker order id', () => {
      const signature = getTradeSignature({
        date: '2026-09-22T00:00:00.000Z',
        orderId: '2609220000123',
        quantity: 10,
        symbol: 'RELIANCE.NS',
        type: 'BUY',
        unitPrice: 1420.5
      });

      expect(signature).toEqual('2026-09-22|RELIANCE.NS|2609220000123');
    });
  });

  describe('isTradebookCsv', () => {
    it('detects broker exports', () => {
      expect(
        isTradebookCsv(
          'Trade Date,Trading Symbol,Buy/Sell,Traded Qty,Avg Price'
        )
      ).toBe(true);
    });

    it('does not detect other files', () => {
      expect(isTradebookCsv('name,value')).toBe(false);
      expect(isTradebookCsv('')).toBe(false);
    });
  });

  describe('defaults', () => {
    it('targets the Indian market', () => {
      expect(DEFAULT_INDIAN_CURRENCY).toEqual('INR');
      expect(DEFAULT_INDIAN_EXCHANGE).toEqual('NSE');
    });
  });
});
