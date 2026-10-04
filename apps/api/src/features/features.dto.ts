import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { criticalities } from '@impactlens/shared';
export class FeatureDto {
  @IsOptional()
  @IsString()
  @Length(1, 100)
  @Matches(/^[a-zA-Z0-9_.-]+$/)
  key?: string;
  @IsString() @Length(1, 150) @Matches(/\S/) name!: string;
  @IsOptional() @IsString() @MaxLength(5000) description?: string;
  @IsOptional() @IsIn(criticalities) criticality?: string;
  @IsOptional() @IsString() @MaxLength(150) responsibleTeam?: string;
  @IsOptional() @IsString() @MaxLength(5000) customerWorkflow?: string;
}
export class UpdateFeatureDto extends FeatureDto {
  @IsInt() @Min(1) expectedVersion!: number;
}
export class MappingDto {
  @IsUUID() snapshotId!: string;
  @IsUUID() fileId!: string;
  @IsOptional() @IsString() @Length(1, 1000) nodeId?: string;
  @IsString() @Length(1, 2000) @Matches(/\S/) rationale!: string;
}
export class EditMappingDto extends MappingDto {
  @IsInt() @Min(1) expectedVersion!: number;
}
export class ReviewMappingDto {
  @IsInt() @Min(1) expectedVersion!: number;
  @IsIn(['CONFIRM', 'REJECT']) action!: 'CONFIRM' | 'REJECT';
  @IsOptional() @IsUUID() snapshotId?: string;
}
export class SnapshotDto {
  @IsUUID() snapshotId!: string;
}
export class SnapshotQuery {
  @IsOptional() @IsUUID() snapshotId?: string;
}
