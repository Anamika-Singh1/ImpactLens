import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Header,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { reviewOutcomes, type ReviewOutcome } from '@impactlens/shared';
import { RequirePermission, type AuthRequest } from '../auth/security';
import { ReviewsService } from './reviews.service';

export class ReviewDto {
  @IsIn(reviewOutcomes) outcome!: ReviewOutcome;
  @IsOptional() @IsString() @MaxLength(4000) comment?: string;
  @IsInt() @Min(0) expectedRevision!: number;
  @Matches(/^[a-f0-9]{40,64}$/) baseSha!: string;
  @Matches(/^[a-f0-9]{40,64}$/) headSha!: string;
  @Matches(/^[a-f0-9]{64}$/) resultHash!: string;
}
export class ReviewPageDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000) page = 1;
}
@Controller(
  'workspaces/:workspaceId/repositories/:repositoryId/comparisons/:analysisId',
)
export class ReviewsController {
  constructor(private readonly service: ReviewsService) {}
  @Get('reviews')
  list(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('repositoryId', ParseUUIDPipe) repositoryId: string,
    @Param('analysisId', ParseUUIDPipe) analysisId: string,
    @Query() query: ReviewPageDto,
  ) {
    return this.service.list(
      { workspaceId, repositoryId },
      analysisId,
      query.page,
    );
  }
  @Post('reviews')
  @RequirePermission('reviews:write')
  create(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('repositoryId', ParseUUIDPipe) repositoryId: string,
    @Param('analysisId', ParseUUIDPipe) analysisId: string,
    @Body() input: ReviewDto,
    @Req() req: AuthRequest,
  ) {
    return this.service.create(
      { workspaceId, repositoryId },
      analysisId,
      input,
      req.authSession!.userId!,
    );
  }
  @Get('report')
  @Header(
    'Content-Disposition',
    'attachment; filename="impactlens-release-review.json"',
  )
  @Header('Cache-Control', 'no-store')
  report(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('repositoryId', ParseUUIDPipe) repositoryId: string,
    @Param('analysisId', ParseUUIDPipe) analysisId: string,
  ) {
    return this.service.report({ workspaceId, repositoryId }, analysisId);
  }
}
