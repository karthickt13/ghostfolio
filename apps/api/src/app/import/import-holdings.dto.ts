import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class ImportHoldingsDto {
  /** Name of the account (e.g. `Zerodha`) to assign the activities to */
  @IsOptional()
  @IsString()
  account?: string;

  /** Id of an existing account, takes precedence over `account` */
  @IsOptional()
  @IsString()
  accountId?: string;

  /**
   * Close positions that are held in Ghostfolio but missing in the
   * statement (default `false`)
   */
  @IsOptional()
  @IsBoolean()
  closeMissingPositions?: boolean;

  /** The raw content of the equity summary (CSV) */
  @IsString()
  csvContent: string;

  /** Exchange used when the file has no exchange column (default `NSE`) */
  @IsOptional()
  @IsString()
  defaultExchange?: string;

  /** Original file name, used when the upload is archived */
  @IsOptional()
  @IsString()
  fileName?: string;
}
