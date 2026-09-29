# Indian Portfolio Setup (Neon + Supabase)

This guide turns Ghostfolio into a live tracker for an Indian equity
portfolio (NSE / BSE) that is updated with a weekly upload of the shares
bought or sold.

Two kinds of files can be uploaded:

| File                                           | Contains                                                        | Effect                                           |
| ---------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------ |
| **Trade book** (weekly)                        | One row per buy or sell of the week                             | Adds the trades as activities                    |
| **Equity summary** (`PortFolioEqtSummary.csv`) | One row per holding with the quantity and the average buy price | Replaces the positions with the ones in the file |

- **[Neon](https://neon.tech)** — the Postgres database that stores users,
  activities and market data (Prisma).
- **[Supabase](https://supabase.com)** — login (Supabase Auth) and the
  archive of every weekly upload (Supabase Storage).
- **Yahoo Finance** — live prices for Indian tickers (`RELIANCE.NS`,
  `TCS.BO`) and historical data for the charts.

```
┌──────────────┐   weekly CSV upload    ┌────────────────────┐
│  Browser /   │ ─────────────────────► │  Ghostfolio API    │
│  CLI upload  │                        │  POST /import/     │
└──────────────┘                        │       tradebook    │
                                        └─────────┬──────────┘
                       archive the file           │ store activities
                                        ┌─────────▼──────────┐
                                        │  Supabase Storage  │
                                        └───────────────────┘
                                        ┌───────────────────┐
                                        │  Neon (Postgres)  │
                                        └───────────────────┘
```

---

## 1. Neon (database)

1. Create a project at [neon.tech](https://neon.tech) in a region close to
   you (e.g. `aws-ap-south-1` for India).
2. Copy **two** connection strings from the dashboard:
   - the **pooled** connection string (ends with `-pooler`) → `DATABASE_URL`
   - the **direct** connection string (no `-pooler`) → `DIRECT_URL`
     (needed for migrations)
3. Both must end with `?sslmode=require`.

```
DATABASE_URL="postgresql://<user>:<password>@<host>-pooler.<region>.aws.neon.tech/ghostfolio?sslmode=require&connect_timeout=300"
DIRECT_URL="postgresql://<user>:<password>@<host>.<region>.aws.neon.tech/ghostfolio?sslmode=require&connect_timeout=300"
```

> Connection pooling matters: Ghostfolio runs cron jobs that gather market
> data and open many short-lived connections. Using the pooled endpoint for
> the app and the direct endpoint for migrations is the recommended setup.

4. Apply the schema (this creates all tables and applies the migrations):

```bash
npm install
npm run database:generate-typings   # prisma generate
npm run database:migrate            # prisma migrate deploy
npm run database:seed               # optional: demo data
```

---

## 2. Supabase (login + file archive)

1. Create a project at [supabase.com](https://supabase.com).
2. **Authentication** → _Providers_: enable **Email** (and optionally
   **Google**). Under _URL Configuration_ add the URL of your Ghostfolio
   instance as the site URL and as a redirect URL.
3. **Storage** → create a bucket named `tradebooks` (private or public —
   the API writes with the service role key either way).
4. Copy the values from _Project Settings → API_:

| Environment variable        | Where to find it                                |
| --------------------------- | ----------------------------------------------- |
| `SUPABASE_URL`              | Project URL (`https://<project>.supabase.co`)   |
| `SUPABASE_ANON_KEY`         | Project API keys → `anon` `public`              |
| `SUPABASE_SERVICE_ROLE_KEY` | Project API keys → `service_role` (**secret!**) |

5. Enable the login in the environment:

```
ENABLE_FEATURE_AUTH_SUPABASE=true
SUPABASE_STORAGE_BUCKET=tradebooks
```

Every upload is archived as
`tradebooks/<user id>/<timestamp>-<file name>.csv`, so a week can always be
re-imported or audited later.

---

## 3. Environment

Full example (see also `.env.india.example`):

```bash
# Neon
DATABASE_URL="postgresql://...-pooler...?sslmode=require"
DIRECT_URL="postgresql://...?sslmode=require"

# Supabase
ENABLE_FEATURE_AUTH_SUPABASE=true
SUPABASE_URL="https://<project>.supabase.co"
SUPABASE_ANON_KEY="<anon key>"
SUPABASE_SERVICE_ROLE_KEY="<service role key>"
SUPABASE_STORAGE_BUCKET=tradebooks

# Indian market defaults
DEFAULT_CURRENCY=INR          # base currency of new users
DATA_SOURCE_IMPORT=YAHOO      # resolves RELIANCE.NS, TCS.BO, ...
DATA_SOURCE_EXCHANGE_RATES=YAHOO

# Cache (Redis is required by Ghostfolio)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=<password>

# Security
ACCESS_TOKEN_SALT=<random string>
JWT_SECRET_KEY=<random string>
ROOT_URL=https://ghostfolio.example.com
```

Start the app:

```bash
npm run start:server   # API on http://localhost:3333
npm run start:client   # Client on http://localhost:4200
```

Then, in the app: **Settings → Base Currency → INR** (new users already
start with `DEFAULT_CURRENCY`).

---

## 4. The weekly upload

### In the app

**Portfolio → Activities → Import → Select File** and pick the CSV of the
week. The importer detects a trade book automatically and shows a preview
with every activity before anything is written.

### Upload a holdings summary (equity summary)

Brokers also send an equity summary (`PortFolioEqtSummary.csv`) that lists
every holding with its quantity and average buy price — no buy/sell rows.
See [`docs/examples/holdings-summary.csv`](./examples/holdings-summary.csv).

`POST /api/v1/import/holdings` **reconciles** the portfolio with the
statement instead of adding the totals as new activities:

| Situation                                             | Adjustment                                                                       |
| ----------------------------------------------------- | -------------------------------------------------------------------------------- |
| The statement has more shares than Ghostfolio         | A `BUY` for the difference, at the average buy price                             |
| The statement has fewer shares                        | A `SELL` for the difference, at the last price of the file                       |
| The quantities match                                  | Nothing                                                                          |
| Ghostfolio holds a stock that is not in the statement | Reported in `missing`, never sold silently (use `--close-missing` to close them) |

Because only the difference is imported, the sync is **idempotent**:
running it twice with the same statement does nothing the second time.

```bash
# see what would change, write nothing
npm run import:tradebook -- --file ./8507436600_PortFolioEqtSummary.csv --holdings --dry-run

# apply it
npm run import:tradebook -- --file ./8507436600_PortFolioEqtSummary.csv --holdings
```

```
Dry run against 2026-09-29: 4 positions match, 1 to buy, 1 to sell
Held in Ghostfolio but not in the statement: INFY.NS
Preview of the adjustments:
┌────────────┬──────────────┬──────┬──────────┬───────────┐
│ date       │ symbol       │ type │ quantity │ unitPrice │
├────────────┼──────────────┼──────┼──────────┼───────────┤
│ 2026-09-29 │ RELIANCE.NS  │ BUY  │        2 │    1420.5 │
│ 2026-09-29 │ TCS.NS       │ SELL │        3 │   3942.15 │
└────────────┴──────────────┴──────┴──────────┴───────────┘
```

Trades that are dated **after** the statement are still applied on top, so
the weekly uploads continue to work after a sync.

### From the command line (or a cron job)

```bash
npm run import:tradebook -- --file ./trades.csv --account Zerodha

# validate first, write nothing
npm run import:tradebook -- --file ./trades.csv --dry-run
```

Environment (or flags `--url` / `--token`):

```bash
GHOSTFOLIO_URL=https://ghostfolio.example.com
GHOSTFOLIO_TOKEN="Api-Key <key>"   # or a Ghostfolio JWT
```

The response reports how many trades were imported, how many were skipped
as duplicates, which rows failed and where the file was archived:

```
Import: 7 trades imported, 2 skipped (already imported)
Rows that could not be imported:
  - Row 12: Invalid date "31/02/2026"
Archived upload: https://<project>.supabase.co/storage/v1/object/public/tradebooks/...
```

**Re-uploading is safe.** Every trade has a fingerprint (date, symbol,
type, quantity, price — or the broker order id). Uploading the same file
twice, or two files with overlapping weeks, never creates duplicates.

---

## 5. CSV format

The template is available in
[`docs/examples/tradebook-template.csv`](./examples/tradebook-template.csv):

```csv
date,symbol,exchange,type,quantity,price,charges,account,orderId
2026-09-21,RELIANCE,NSE,BUY,10,1420.50,22.40,Zerodha,2609210000123
```

| Column     | Required | Description                                                                          |
| ---------- | -------- | ------------------------------------------------------------------------------------ |
| `date`     | yes      | `22-09-2026`, `22/09/2026`, `22-Sep-2026`, `2026-09-22`, ISO or Excel serial         |
| `symbol`   | yes      | `RELIANCE`, `RELIANCE-EQ`, `RELIANCE.NS` — the NSE/BSE suffix is added automatically |
| `exchange` | no       | `NSE` (default) or `BSE`                                                             |
| `type`     | yes      | `BUY` / `SELL` (also `B`, `S`, `Purchase`, `Sale`)                                   |
| `quantity` | yes      | Number of shares                                                                     |
| `price`    | yes\*    | Price per share; \*derived from the trade value if missing                           |
| `charges`  | no       | Total charges (brokerage + STT + GST + stamp duty + ...)                             |
| `account`  | no       | Account name, e.g. `Zerodha`                                                         |
| `orderId`  | no       | Broker order id, used to detect duplicates                                           |

### Holdings summary (equity summary)

```csv
Scrip Name,ISIN,Quantity,Avg Buy Price,LTP,Market Value
RELIANCE,INE002A01018,10,1420.50,1466.30,14663.00
```

| Column             | Required | Description                                                                                       |
| ------------------ | -------- | ------------------------------------------------------------------------------------------------- |
| `symbol`           | yes\*    | `RELIANCE`, `RELIANCE-EQ` — the NSE/BSE suffix is added                                           |
| `isin`             | \*       | Used when the file has neither a symbol nor a company name                                        |
| `name`             | \*       | Company name, used as the display name                                                            |
| `quantity`         | yes      | Number of shares held                                                                             |
| `averageUnitPrice` | no\*\*   | Average buy price; \*\*derived from the invested amount or, as a last resort, from the last price |
| `lastPrice`        | no       | LTP / closing price of the file, used to value the position                                       |
| `date`             | no       | Statement date (`As On Date`), defaults to today                                                  |

Trade books are recognized by their transaction type column, equity
summaries by the combination of symbol (or ISIN/company name) and quantity
without a transaction type — so both can be dropped into the same dialog.

Broker exports work without editing them. These column names are
recognized for trade books (case and punctuation insensitive):

| Field    | Accepted column names                                                                |
| -------- | ------------------------------------------------------------------------------------ |
| date     | Trade Date, Order Execution Time, Trade Time, Transaction Date, Order Date           |
| symbol   | Trading Symbol, Scrip, Scrip Name, Ticker, Instrument, Security                      |
| type     | Buy/Sell, Transaction Type, Trade Type, Action, Side                                 |
| quantity | Traded Qty, Traded Quantity, Filled Qty, Shares, Units                               |
| price    | Trade Price, Avg Price, Average Price, Execution Price, Rate                         |
| charges  | Charges, Total Charges, Brokerage, STT, GST, Stamp Duty, SEBI Charges, Other Charges |
| orderId  | Order ID, Order No, Trade ID, Transaction ID                                         |

If the file has no total charges column but separate ones (brokerage, STT,
exchange transaction charges, GST, stamp duty, SEBI charges, ...), they are
summed up and stored as the fee of the activity, so the performance is
calculated net of charges.

Numbers may be formatted the Indian way (`1,23,456.78`, `₹ 1,234.00`,
`(1,234.00)` for negatives).

---

## 6. Live prices

- Symbols are stored with the exchange suffix: `RELIANCE.NS` (NSE) and
  `TCS.BO` (BSE). Entering `RELIANCE` in the app is enough — the importer
  adds the suffix, and for manual activities type the full symbol.
- Ghostfolio gathers prices with its cron service
  (`ENABLE_FEATURE_CRON=true`), so the dashboard, the profit and the
  charts update on their own.
- NSE prices on Yahoo Finance are usually **delayed** (about 15 minutes)
  and are only available while the market data provider publishes them.
- If a symbol cannot be resolved, add it manually with the data source
  `MANUAL` and maintain the price yourself, or configure a paid provider
  (`API_KEY_ALPHA_VANTAGE`, `API_KEY_EOD_HISTORICAL_DATA`,
  `API_KEY_FINANCIAL_MODELING_PREP`).

---

## 7. Deployment notes

- Run the API with the **pooled** Neon connection string and keep
  `DIRECT_URL` for migrations only.
- Redis is required (caching and job queues); any managed Redis works.
- Set `ROOT_URL` to the public URL — it is used for the OAuth redirects.
- Backups: Neon keeps point-in-time restores, Supabase Storage keeps every
  weekly CSV, so the portfolio can always be rebuilt from the uploads.

---

## 8. Validate an upload without a backend

```bash
npm run build:tradebook-preview
npx serve tools/tradebook-preview
```

Opens a page where a trade book **or** an equity summary can be dropped to
see the parsed trades, the synced holdings and the profit — with the same
parser the API uses, but without touching the database.
