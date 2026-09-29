import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class ImportTradebookDto {
  /** Name of the account (e.g. `Zerodha`) to assign the activities to */
  @IsOptional()
  @IsString()
  account?: string;

  /** Id of an existing account, takes precedence over `account` */
  @IsOptional()
  @IsString()
  accountId?: string;

  /** The raw content of the weekly trade book (CSV) */
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
