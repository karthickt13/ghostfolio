import {
  getHoldingsCsvTemplate,
  isHoldingsCsv,
  parseHoldingsCsv
} from './holdings.helper';

describe('HoldingsHelper', () => {
  describe('parseHoldingsCsv', () => {
    it('parses the template', () => {
      const result = parseHoldingsCsv({
        csvContent: getHoldingsCsvTemplate()
      });

      expect(result.isHoldings).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.holdings).toEqual([
        {
          averageUnitPrice: 1420.5,
          currency: 'INR',
          isin: 'INE002A01018',
          lastPrice: 1466.3,
          name: 'Reliance Industries Ltd',
          quantity: 10,
          symbol: 'RELIANCE.NS'
        },
        {
          averageUnitPrice: 3890.1,
          currency: 'INR',
          isin: 'INE467B01029',
          lastPrice: 3942.15,
          name: 'Tata Consultancy Services Ltd',
          quantity: 5,
          symbol: 'TCS.NS'
        }
      ]);
    });

    it('parses a broker equity summary with an ISIN', () => {
      const csvContent = [
        'Scrip Name,ISIN,Quantity,Avg Buy Price,LTP,Market Value',
        'RELIANCE,INE002A01018,10,1420.50,1466.30,14663.00',
        'TCS,INE467B01029,5,3890.10,3942.15,19710.75'
      ].join('\n');

      const result = parseHoldingsCsv({ csvContent });

      expect(result.errors).toEqual([]);
      expect(result.holdings).toHaveLength(2);
      expect(result.holdings[0].symbol).toEqual('RELIANCE.NS');
      expect(result.holdings[0].quantity).toEqual(10);
      expect(result.holdings[0].averageUnitPrice).toEqual(1420.5);
      expect(result.holdings[0].lastPrice).toEqual(1466.3);
    });

    it('parses a depository style statement', () => {
      const csvContent = [
        'Company Name,Shares,Average Cost,Closing Price',
        'Infosys Ltd,20,1532.65,1587.25'
      ].join('\n');

      const result = parseHoldingsCsv({ csvContent });

      expect(result.errors).toEqual([]);
      expect(result.holdings[0].symbol).toEqual('INFOSYSLTD.NS');
      expect(result.holdings[0].name).toEqual('Infosys Ltd');
      expect(result.warnings[0]).toContain('derived from the company name');
      expect(result.holdings[0].quantity).toEqual(20);
      expect(result.holdings[0].averageUnitPrice).toEqual(1532.65);
      expect(result.holdings[0].lastPrice).toEqual(1587.25);
    });

    it('derives the average price from the invested amount', () => {
      const csvContent = [
        'Symbol,Quantity,Invested Amount,Current Value',
        'ITC,100,41235.00,42890.00'
      ].join('\n');

      const result = parseHoldingsCsv({ csvContent });

      expect(result.holdings[0].averageUnitPrice).toEqual(412.35);
    });

    it('falls back to the last price and warns', () => {
      const csvContent = ['Symbol,Quantity,LTP', 'HDFCBANK,15,1712.40'].join(
        '\n'
      );

      const result = parseHoldingsCsv({ csvContent });

      expect(result.holdings[0].averageUnitPrice).toEqual(1712.4);
      expect(result.warnings[0]).toContain('no average buy price');
    });

    it('skips empty positions and subtotal rows', () => {
      const csvContent = [
        'Symbol,Quantity,Avg Buy Price',
        'RELIANCE,10,1420.50',
        'TCS,0,3890.10',
        ',,,',
        'Total,10,14205.00'
      ].join('\n');

      const result = parseHoldingsCsv({ csvContent });

      expect(result.holdings).toHaveLength(1);
      expect(result.holdings[0].symbol).toEqual('RELIANCE.NS');
    });

    it('reports rows without a quantity', () => {
      const csvContent = [
        'Symbol,Quantity,Avg Buy Price',
        'RELIANCE,,1420.50'
      ].join('\n');

      const result = parseHoldingsCsv({ csvContent });

      expect(result.holdings).toEqual([]);
      expect(result.errors[0].message).toContain('Invalid quantity');
    });

    it('uses the statement date of the file', () => {
      const csvContent = [
        'As On Date,Symbol,Quantity,Avg Buy Price',
        '26-09-2026,RELIANCE,10,1420.50'
      ].join('\n');

      const result = parseHoldingsCsv({ csvContent });

      expect(result.date).toEqual('2026-09-26T00:00:00.000Z');
    });

    it('keeps the ISIN when there is no symbol', () => {
      const csvContent = [
        'ISIN,Quantity,Avg Buy Price',
        'INE002A01018,10,1420.50'
      ].join('\n');

      const result = parseHoldingsCsv({ csvContent });

      expect(result.holdings[0].symbol).toEqual('INE002A01018');
      expect(result.holdings[0].isin).toEqual('INE002A01018');
    });

    it('rejects a file without a symbol or quantity column', () => {
      const result = parseHoldingsCsv({ csvContent: 'name,value\nfoo,bar' });

      expect(result.isHoldings).toBe(false);
      expect(result.errors[0].message).toContain(
        'does not look like a holdings summary'
      );
    });

    it('rejects an empty file', () => {
      const result = parseHoldingsCsv({ csvContent: '' });

      expect(result.errors[0].message).toEqual('The file is empty');
    });
  });

  describe('isHoldingsCsv', () => {
    it('detects holdings summaries', () => {
      expect(isHoldingsCsv('Scrip Name,ISIN,Quantity,Avg Buy Price,LTP')).toBe(
        true
      );
      expect(isHoldingsCsv('Company Name,Shares,Average Cost')).toBe(true);
    });

    it('does not detect trade books', () => {
      expect(
        isHoldingsCsv('Trade Date,Trading Symbol,Buy/Sell,Traded Qty,Avg Price')
      ).toBe(false);
    });

    it('does not detect unrelated files', () => {
      expect(isHoldingsCsv('name,value')).toBe(false);
      expect(isHoldingsCsv('')).toBe(false);
    });
  });
});
