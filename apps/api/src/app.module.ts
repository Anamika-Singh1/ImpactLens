import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { DependenciesService } from './dependencies.service';
import { DatabaseModule } from './database.module';
import { AuthModule } from './auth/auth.module';
import { WorkspacesController } from './workspaces/workspaces.controller';
import {
  ImportsController,
  GitHubCallbackController,
} from './imports/imports.controller';
import { ImportsService } from './imports/imports.service';
import { ExplorerController } from './explorer/explorer.controller';
import { ExplorerService } from './explorer/explorer.service';
import { RepositoryOverviewController } from './explorer/repository-overview.controller';
import { RepositoryOverviewService } from './explorer/repository-overview.service';
import { FeaturesController } from './features/features.controller';
import { FeaturesService } from './features/features.service';
import { ComparisonsController } from './comparisons/comparisons.controller';
import { ComparisonsService } from './comparisons/comparisons.service';
import { TestEvidenceController } from './test-evidence/test-evidence.controller';
import { TestEvidenceService } from './test-evidence/test-evidence.service';
import { ExplanationsController } from './explanations/explanations.controller';
import { ExplanationsService } from './explanations/explanations.service';
import {
  EXPLANATION_PROVIDER,
  OpenAiExplanationProvider,
} from './explanations/explanation.provider';
import { readConfig } from './config';
import { ReviewsController } from './reviews/reviews.controller';
import { ReviewsService } from './reviews/reviews.service';
import { DeletionsController } from './deletions/deletions.controller';
import { DeletionsService } from './deletions/deletions.service';
@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [
    HealthController,
    WorkspacesController,
    ImportsController,
    GitHubCallbackController,
    ExplorerController,
    RepositoryOverviewController,
    FeaturesController,
    ComparisonsController,
    TestEvidenceController,
    ExplanationsController,
    ReviewsController,
    DeletionsController,
  ],
  providers: [
    DependenciesService,
    ImportsService,
    ExplorerService,
    RepositoryOverviewService,
    FeaturesService,
    ComparisonsService,
    TestEvidenceService,
    ExplanationsService,
    ReviewsService,
    DeletionsService,
    {
      provide: EXPLANATION_PROVIDER,
      useFactory: () => new OpenAiExplanationProvider(readConfig().AI_API_KEY),
    },
  ],
})
export class AppModule {}
