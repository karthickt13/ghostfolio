#!/usr/bin/env node
/**
 * Weekly upload of a trade book (CSV) to Ghostfolio.
 *
 * Usage:
 *   npm run import:tradebook -- --file ./trades.csv
 *   npm run import:tradebook -- --file ./trades.csv --dry-run
 *   npm run import:tradebook -- --file ./trades.csv --account Zerodha --exchange NSE
 *
 * Configuration (or the matching command line flags):
 *   GHOSTFOLIO_URL    Base URL of the Ghostfolio instance, e.g. https://ghostfolio.example.com
 *   GHOSTFOLIO_TOKEN  Ghostfolio JWT or API key (`Api-Key ...`)
 *
 * Trades that were imported before are skipped, so the same file (or files
 * with overlapping weeks) can be uploaded more than once.
 */

import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

const args = parseArgs(process.argv.slice(2));

const filePath = args['file'];
const isDryRun = args['dry-run'] === 'true' || args['dryRun'] === 'true';
const url = (args['url'] ?? process.env.GHOSTFOLIO_URL ?? '').replace(/\/$/, '');
const token = args['token'] ?? process.env.GHOSTFOLIO_TOKEN;

if (args['help']) {
  printUsage();
  process.exit(0);
}

if (!filePath) {
  console.error('Missing --file <path to the CSV file>');
  printUsage();
  process.exit(1);
}

if (!url) {
  console.error('Missing the URL of the Ghostfolio instance (--url or GHOSTFOLIO_URL)');
  process.exit(1);
}

if (!token) {
  console.error('Missing the access token (--token or GHOSTFOLIO_TOKEN)');
  process.exit(1);
}

const csvContent = await readFile(resolve(filePath), 'utf8');

const response = await fetch(
  `${url}/api/v1/import/tradebook?dryRun=${isDryRun}`,
  {
    body: JSON.stringify({
      account: args['account'],
      csvContent,
      defaultExchange: args['exchange'],
      fileName: basename(filePath)
    }),
    headers: {
      'Authorization': token.startsWith('Api-Key') ? token : `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    method: 'POST'
  }
);

const payload = await response.json().catch(() => {
  return undefined;
});

if (!response.ok) {
  console.error(
    `Import failed (${response.status}): ${
      payload?.message?.join?.(', ') ?? payload?.message ?? response.statusText
    }`
  );
  process.exit(1);
}

const {
  activities = [],
  archiveUrl,
  chargesTotal = 0,
  duplicateCount = 0,
  errors = [],
  importedCount = 0,
  warnings = []
} = payload ?? {};

console.log(
  `${isDryRun ? 'Dry run' : 'Import'}: ${importedCount} ${
    importedCount === 1 ? 'trade' : 'trades'
  }${isDryRun ? ' would be imported' : ' imported'}, ${duplicateCount} skipped (already imported)`
);

if (warnings.length > 0) {
  console.log('');
  console.log('Warnings:');

  for (const warning of warnings) {
    console.log(`  - ${warning}`);
  }
}

if (errors.length > 0) {
  console.log('');
  console.log('Rows that could not be imported:');

  for (const { message, rowNumber } of errors) {
    console.log(`  - Row ${rowNumber}: ${message}`);
  }
}

if (archiveUrl) {
  console.log('');
  console.log(`Archived upload: ${archiveUrl}`);
}

if (isDryRun) {
  console.log('');
  console.log('Preview of the activities:');
  console.table(
    activities.map(({ date, quantity, SymbolProfile, type, unitPrice }) => {
      return {
        date: new Date(date).toISOString().slice(0, 10),
        symbol: SymbolProfile?.symbol,
        type,
        quantity,
        unitPrice
      };
    })
  );
}

console.log('');
console.log(`Charges (brokerage, STT, GST, ...): ${chargesTotal.toFixed(2)}`);

process.exit(errors.length > 0 ? 1 : 0);

function parseArgs(aArgv) {
  const result = {};

  for (let index = 0; index < aArgv.length; index++) {
    const arg = aArgv[index];

    if (!arg.startsWith('--')) {
      continue;
    }

    const [key, inlineValue] = arg.slice(2).split('=');

    if (inlineValue !== undefined) {
      result[key] = inlineValue;
    } else if (
      aArgv[index + 1] === undefined ||
      aArgv[index + 1].startsWith('--')
    ) {
      result[key] = 'true';
    } else {
      result[key] = aArgv[index + 1];
      index++;
    }
  }

  return result;
}

function printUsage() {
  console.log(`
Usage: npm run import:tradebook -- --file <path> [options]

Options:
  --file <path>       Path to the CSV file with the trades of the week
  --url <url>         Base URL of Ghostfolio (or GHOSTFOLIO_URL)
  --token <token>     Ghostfolio JWT or "Api-Key <key>" (or GHOSTFOLIO_TOKEN)
  --account <name>    Account name to assign the activities to, e.g. Zerodha
  --exchange <NSE|BSE> Exchange used when the file has no exchange column
  --dry-run           Validate the file without writing anything
  --help              Show this help
`);
}
