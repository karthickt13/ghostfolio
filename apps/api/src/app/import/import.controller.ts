import { HasPermission } from '@ghostfolio/api/decorators/has-permission.decorator';
import { HasPermissionGuard } from '@ghostfolio/api/guards/has-permission.guard';
import { TransformDataSourceInRequestInterceptor } from '@ghostfolio/api/interceptors/transform-data-source-in-request/transform-data-source-in-request.interceptor';
import { TransformDataSourceInResponseInterceptor } from '@ghostfolio/api/interceptors/transform-data-source-in-response/transform-data-source-in-response.interceptor';
import { ImportResponse } from '@ghostfolio/common/interfaces';
import { hasPermission, permissions } from '@ghostfolio/common/permissions';
import type { RequestWithUser } from '@ghostfolio/common/types';

import {
  Body,
  Controller,
  Get,
  HttpException,
  Inject,
  Logger,
  Param,
  Post,
  Query,
  UseGuards,
  UseInterceptors
} from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { DataSource } from '@prisma/client';
import { StatusCodes, getReasonPhrase } from 'http-status-codes';

import { ImportDataDto } from './import-data.dto';
import { ImportTradebookDto } from './import-tradebook.dto';
import { ImportService } from './import.service';
import { TradebookService } from './tradebook.service';

@Controller('import')
export class ImportController {
  private readonly logger = new Logger(ImportController.name);

  public constructor(
    private readonly importService: ImportService,
    private readonly tradebookService: TradebookService,
    @Inject(REQUEST) private readonly request: RequestWithUser
  ) {}

  @Post()
  @UseGuards(AuthGuard('jwt'), HasPermissionGuard)
  @HasPermission(permissions.createActivity)
  @UseInterceptors(TransformDataSourceInRequestInterceptor)
  @UseInterceptors(TransformDataSourceInResponseInterceptor)
  public async import(
    @Body() importData: ImportDataDto,
    @Query('dryRun') isDryRunParam = 'false'
  ): Promise<ImportResponse> {
    const isDryRun = isDryRunParam === 'true';

    if (
      !hasPermission(this.request.user.permissions, permissions.createAccount)
    ) {
      throw new HttpException(
        getReasonPhrase(StatusCodes.FORBIDDEN),
        StatusCodes.FORBIDDEN
      );
    }

    try {
      const activities = await this.importService.import({
        isDryRun,
        accountsWithBalancesDto: importData.accounts ?? [],
        activitiesDto: importData.activities,
        assetProfilesWithMarketDataDto: importData.assetProfiles ?? [],
        platformsDto: importData.platforms ?? [],
        tagsDto: importData.tags ?? [],
        user: this.request.user
      });

      return { activities };
    } catch (error) {
      this.logger.error(error);

      throw new HttpException(
        {
          error: getReasonPhrase(StatusCodes.BAD_REQUEST),
          message: [error.message]
        },
        StatusCodes.BAD_REQUEST
      );
    }
  }

  /**
   * Weekly upload of a trade book (CSV) of shares bought or sold.
   *
   * Accepts the Ghostfolio template as well as the exports of most Indian
   * brokers. Trades that have been imported before are skipped, so the same
   * file can be uploaded twice by accident.
   */
  @Post('tradebook')
  @UseGuards(AuthGuard(['jwt', 'api-key']), HasPermissionGuard)
  @HasPermission(permissions.createActivity)
  @UseInterceptors(TransformDataSourceInResponseInterceptor)
  public async importTradebook(
    @Body() importTradebookDto: ImportTradebookDto,
    @Query('dryRun') isDryRunParam = 'false'
  ) {
    const isDryRun = isDryRunParam === 'true';

    if (
      !hasPermission(this.request.user.permissions, permissions.createAccount)
    ) {
      throw new HttpException(
        getReasonPhrase(StatusCodes.FORBIDDEN),
        StatusCodes.FORBIDDEN
      );
    }

    try {
      return await this.tradebookService.importTradebook({
        ...importTradebookDto,
        isDryRun,
        user: this.request.user
      } as any);
    } catch (error) {
      this.logger.error(error);

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        {
          error: getReasonPhrase(StatusCodes.BAD_REQUEST),
          message: [error.message]
        },
        StatusCodes.BAD_REQUEST
      );
    }
  }

  @Get('dividends/:dataSource/:symbol')
  @UseGuards(AuthGuard('jwt'), HasPermissionGuard)
  @UseInterceptors(TransformDataSourceInRequestInterceptor)
  @UseInterceptors(TransformDataSourceInResponseInterceptor)
  public async gatherDividends(
    @Param('dataSource') dataSource: DataSource,
    @Param('symbol') symbol: string
  ): Promise<ImportResponse> {
    const maxActivitiesToImport = this.importService.getMaxActivitiesToImport({
      user: this.request.user
    });

    const activities = await this.importService.getDividends({
      dataSource,
      symbol,
      userCurrency: this.request.user.settings.settings.baseCurrency,
      userId: this.request.user.id
    });

    return { activities: activities.slice(0, maxActivitiesToImport) };
  }
}
