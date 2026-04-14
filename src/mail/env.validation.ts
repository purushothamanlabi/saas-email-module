import { plainToInstance } from 'class-transformer';
import {
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  validateSync,
} from 'class-validator';

class EnvVars {
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT!: number;

  @IsString()
  REDIS_HOST!: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  REDIS_PORT!: number;

  @IsOptional()
  @IsString()
  REDIS_PASSWORD?: string;

  @IsString()
  AWS_REGION!: string;

  @IsString()
  AWS_ACCESS_KEY_ID!: string;

  @IsString()
  AWS_SECRET_ACCESS_KEY!: string;

  @IsEmail()
  MAIL_FROM_EMAIL!: string;

  @IsString()
  MAIL_FROM_NAME!: string;

  @IsEmail()
  MAIL_REPLY_TO!: string;

  @IsOptional()
  @IsString()
  SES_CONFIGURATION_SET?: string;

  @IsInt()
  @Min(1)
  @Max(1000)
  MAIL_WORKER_CONCURRENCY!: number;

  @IsOptional()
  @IsString()
  MAIL_WORKER_ENABLED?: string;

  @IsString()
  APP_URL!: string;
}

export function validateEnv(config: Record<string, unknown>) {
  const validated = plainToInstance(EnvVars, {
    ...config,
    PORT: Number(config.PORT ?? 3000),
    REDIS_PORT: Number(config.REDIS_PORT ?? 6379),
    MAIL_WORKER_CONCURRENCY: Number(config.MAIL_WORKER_CONCURRENCY ?? 50),
  });

  const errors = validateSync(validated, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(errors.toString());
  }

  return validated;
}
