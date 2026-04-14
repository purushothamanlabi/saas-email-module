Use this structure for a production-style NestJS mail module with Amazon SES + BullMQ + Redis.

Why this shape works:

* BullMQ lets one worker process many I/O-heavy jobs concurrently, and concurrency is configurable per worker; multiple workers can also run in parallel across processes or machines. ([BullMQ][1])
* Amazon SES v2 supports sending email through `SendEmailCommand`, and configuration sets let you publish sends, deliveries, bounces, and complaints to AWS destinations for monitoring. ([AWS Documentation][2])
* AWS recommends having a bounce/complaint handling system in place for SES sending, and CloudWatch reputation metrics can be used to alarm or pause sending when quality drops. ([AWS Documentation][3])

## Install

```bash
npm i bullmq ioredis @aws-sdk/client-sesv2 class-validator class-transformer
npm i @nestjs/config
```

## Environment

```env
PORT=3000
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=

AWS_REGION=ap-south-1
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key

MAIL_FROM_EMAIL=no-reply@yourdomain.com
MAIL_FROM_NAME=Your App
MAIL_REPLY_TO=support@yourdomain.com

SES_CONFIGURATION_SET=app-transactional
MAIL_WORKER_CONCURRENCY=50

APP_URL=https://yourapp.com
```

For SES, your sending identity must be verified, and if your account is still in the SES sandbox, recipients are restricted too. AWS’s SES docs call this out in their sending examples. ([AWS Documentation][4])

---

## Folder structure

```text
src/
  app.module.ts
  main.ts

  common/
    env.validation.ts

  mail/
    mail.module.ts
    mail.constants.ts
    mail.types.ts
    mail.service.ts
    mail.controller.ts
    ses-mail.service.ts
    mail.worker.ts
    mail.queue.ts
    template.service.ts
```

---

## `src/common/env.validation.ts`

```ts
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
  @Max(500)
  MAIL_WORKER_CONCURRENCY!: number;

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
```

---

## `src/mail/mail.constants.ts`

```ts
export const MAIL_QUEUE_NAME = 'mail-queue';

export const MAIL_JOB_NAMES = {
  OTP: 'send-otp-email',
  WELCOME: 'send-welcome-email',
  BULK_CAMPAIGN: 'send-bulk-campaign',
} as const;
```

---

## `src/mail/mail.types.ts`

```ts
export type MailPriority = 1 | 2 | 3 | 4 | 5;

export interface BaseMailJob {
  to: string;
  subject: string;
  tags?: string[];
  metadata?: Record<string, string>;
}

export interface OtpMailJob extends BaseMailJob {
  type: 'otp';
  name?: string;
  otpCode: string;
  expiresInMinutes: number;
}

export interface WelcomeMailJob extends BaseMailJob {
  type: 'welcome';
  name?: string;
}

export interface CampaignRecipient {
  email: string;
  name?: string;
  vars?: Record<string, string>;
}

export interface BulkCampaignJob {
  type: 'bulk-campaign';
  campaignId: string;
  subject: string;
  recipients: CampaignRecipient[];
  htmlTemplate: string;
  textTemplate?: string;
  tags?: string[];
  metadata?: Record<string, string>;
}

export type MailJobData = OtpMailJob | WelcomeMailJob | BulkCampaignJob;
```

---

## `src/mail/template.service.ts`

```ts
import { Injectable } from '@nestjs/common';

@Injectable()
export class TemplateService {
  renderOtpTemplate(input: {
    name?: string;
    otpCode: string;
    expiresInMinutes: number;
    appName: string;
  }) {
    const greeting = input.name ? `Hi ${this.escape(input.name)},` : 'Hi,';

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #111827;">
        <h2 style="margin-bottom: 16px;">${this.escape(input.appName)} verification code</h2>
        <p>${greeting}</p>
        <p>Your one-time verification code is:</p>
        <div style="font-size: 32px; letter-spacing: 8px; font-weight: 700; margin: 24px 0;">
          ${this.escape(input.otpCode)}
        </div>
        <p>This code expires in ${input.expiresInMinutes} minutes.</p>
        <p>If you did not request this code, you can ignore this email.</p>
      </div>
    `.trim();

    const text = [
      `${input.appName} verification code`,
      '',
      greeting,
      '',
      `Your OTP is: ${input.otpCode}`,
      `It expires in ${input.expiresInMinutes} minutes.`,
      '',
      'If you did not request this code, ignore this email.',
    ].join('\n');

    return { html, text };
  }

  renderWelcomeTemplate(input: { name?: string; appName: string; loginUrl: string }) {
    const greeting = input.name ? `Hi ${this.escape(input.name)},` : 'Hi,';

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #111827;">
        <h2>Welcome to ${this.escape(input.appName)}</h2>
        <p>${greeting}</p>
        <p>Your account is ready.</p>
        <p>
          <a href="${this.escape(input.loginUrl)}"
             style="display:inline-block;padding:12px 18px;background:#111827;color:#fff;text-decoration:none;border-radius:8px;">
             Open dashboard
          </a>
        </p>
      </div>
    `.trim();

    const text = [
      `Welcome to ${input.appName}`,
      '',
      greeting,
      '',
      `Open dashboard: ${input.loginUrl}`,
    ].join('\n');

    return { html, text };
  }

  renderCampaignTemplate(
    template: string,
    vars: Record<string, string | undefined>,
  ): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
      return this.escape(vars[key] ?? '');
    });
  }

  private escape(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
```

---

## `src/mail/mail.queue.ts`

```ts
import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import IORedis from 'ioredis';
import { Queue } from 'bullmq';
import { MAIL_QUEUE_NAME } from './mail.constants';

export const REDIS_CONNECTION = Symbol('REDIS_CONNECTION');
export const MAIL_QUEUE = Symbol('MAIL_QUEUE');

export const mailQueueProviders: Provider[] = [
  {
    provide: REDIS_CONNECTION,
    inject: [ConfigService],
    useFactory: (config: ConfigService) => {
      return new IORedis({
        host: config.getOrThrow<string>('REDIS_HOST'),
        port: config.getOrThrow<number>('REDIS_PORT'),
        password: config.get<string>('REDIS_PASSWORD') || undefined,
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
      });
    },
  },
  {
    provide: MAIL_QUEUE,
    inject: [REDIS_CONNECTION],
    useFactory: (connection: IORedis) => {
      return new Queue(MAIL_QUEUE_NAME, {
        connection,
        defaultJobOptions: {
          attempts: 5,
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
          removeOnComplete: 1000,
          removeOnFail: 5000,
        },
      });
    },
  },
];
```

---

## `src/mail/ses-mail.service.ts`

```ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  SESv2Client,
  SendEmailCommand,
  SendEmailCommandInput,
} from '@aws-sdk/client-sesv2';

export interface SendSesMailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
  tags?: string[];
  metadata?: Record<string, string>;
}

@Injectable()
export class SesMailService {
  private readonly logger = new Logger(SesMailService.name);
  private readonly client: SESv2Client;

  constructor(private readonly config: ConfigService) {
    this.client = new SESv2Client({
      region: this.config.getOrThrow<string>('AWS_REGION'),
      credentials: {
        accessKeyId: this.config.getOrThrow<string>('AWS_ACCESS_KEY_ID'),
        secretAccessKey: this.config.getOrThrow<string>('AWS_SECRET_ACCESS_KEY'),
      },
    });
  }

  async send(input: SendSesMailInput): Promise<{ messageId?: string }> {
    const fromEmail = this.config.getOrThrow<string>('MAIL_FROM_EMAIL');
    const fromName = this.config.getOrThrow<string>('MAIL_FROM_NAME');
    const replyTo = this.config.getOrThrow<string>('MAIL_REPLY_TO');
    const configurationSetName = this.config.get<string>('SES_CONFIGURATION_SET');

    const sesInput: SendEmailCommandInput = {
      FromEmailAddress: `${fromName} <${fromEmail}>`,
      Destination: {
        ToAddresses: [input.to],
      },
      ReplyToAddresses: [replyTo],
      Content: {
        Simple: {
          Subject: {
            Data: input.subject,
            Charset: 'UTF-8',
          },
          Body: {
            Html: {
              Data: input.html,
              Charset: 'UTF-8',
            },
            ...(input.text
              ? {
                  Text: {
                    Data: input.text,
                    Charset: 'UTF-8',
                  },
                }
              : {}),
          },
        },
      },
      ...(configurationSetName ? { ConfigurationSetName: configurationSetName } : {}),
      ...(input.tags?.length
        ? {
            EmailTags: input.tags.map((tag) => ({
              Name: 'tag',
              Value: tag,
            })),
          }
        : {}),
      ...(input.metadata
        ? {
            ListManagementOptions: undefined,
          }
        : {}),
    };

    const result = await this.client.send(new SendEmailCommand(sesInput));
    this.logger.debug(`SES accepted email to=${input.to} messageId=${result.MessageId}`);

    return { messageId: result.MessageId };
  }
}
```

---

## `src/mail/mail.service.ts`

```ts
import { Inject, Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { MAIL_QUEUE } from './mail.queue';
import { MAIL_JOB_NAMES } from './mail.constants';
import {
  BulkCampaignJob,
  CampaignRecipient,
  OtpMailJob,
  WelcomeMailJob,
} from './mail.types';

@Injectable()
export class MailService {
  constructor(@Inject(MAIL_QUEUE) private readonly mailQueue: Queue) {}

  async queueOtpEmail(input: {
    to: string;
    name?: string;
    otpCode: string;
    expiresInMinutes?: number;
  }) {
    const job: OtpMailJob = {
      type: 'otp',
      to: input.to,
      name: input.name,
      otpCode: input.otpCode,
      expiresInMinutes: input.expiresInMinutes ?? 10,
      subject: `Your verification code is ${input.otpCode}`,
      tags: ['transactional', 'otp'],
      metadata: {
        mailType: 'otp',
      },
    };

    return this.mailQueue.add(MAIL_JOB_NAMES.OTP, job, {
      priority: 1,
    });
  }

  async queueWelcomeEmail(input: { to: string; name?: string }) {
    const job: WelcomeMailJob = {
      type: 'welcome',
      to: input.to,
      name: input.name,
      subject: 'Welcome to our app',
      tags: ['transactional', 'welcome'],
      metadata: {
        mailType: 'welcome',
      },
    };

    return this.mailQueue.add(MAIL_JOB_NAMES.WELCOME, job, {
      priority: 3,
    });
  }

  async queueBulkCampaign(input: {
    campaignId: string;
    subject: string;
    recipients: CampaignRecipient[];
    htmlTemplate: string;
    textTemplate?: string;
    batchSize?: number;
  }) {
    const batchSize = input.batchSize ?? 500;
    const batches = chunkArray(input.recipients, batchSize);

    const jobs = batches.map((recipients, index) => {
      const job: BulkCampaignJob = {
        type: 'bulk-campaign',
        campaignId: `${input.campaignId}-batch-${index + 1}`,
        subject: input.subject,
        recipients,
        htmlTemplate: input.htmlTemplate,
        textTemplate: input.textTemplate,
        tags: ['bulk', 'campaign'],
        metadata: {
          mailType: 'bulk-campaign',
          campaignId: input.campaignId,
        },
      };

      return {
        name: MAIL_JOB_NAMES.BULK_CAMPAIGN,
        data: job,
        opts: {
          priority: 5,
        },
      };
    });

    return this.mailQueue.addBulk(jobs);
  }
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
```

---

## `src/mail/mail.worker.ts`

```ts
import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, QueueEvents, Worker } from 'bullmq';
import { MAIL_JOB_NAMES, MAIL_QUEUE_NAME } from './mail.constants';
import { REDIS_CONNECTION } from './mail.queue';
import IORedis from 'ioredis';
import { BulkCampaignJob, OtpMailJob, WelcomeMailJob } from './mail.types';
import { SesMailService } from './ses-mail.service';
import { TemplateService } from './template.service';

@Injectable()
export class MailWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MailWorker.name);
  private worker?: Worker;
  private queueEvents?: QueueEvents;

  constructor(
    private readonly config: ConfigService,
    private readonly sesMailService: SesMailService,
    private readonly templateService: TemplateService,
    @Inject(REDIS_CONNECTION) private readonly redis: IORedis,
  ) {}

  onModuleInit() {
    const concurrency = this.config.getOrThrow<number>('MAIL_WORKER_CONCURRENCY');

    this.worker = new Worker(
      MAIL_QUEUE_NAME,
      async (job: Job) => {
        switch (job.name) {
          case MAIL_JOB_NAMES.OTP:
            await this.handleOtp(job as Job<OtpMailJob>);
            return;
          case MAIL_JOB_NAMES.WELCOME:
            await this.handleWelcome(job as Job<WelcomeMailJob>);
            return;
          case MAIL_JOB_NAMES.BULK_CAMPAIGN:
            await this.handleBulkCampaign(job as Job<BulkCampaignJob>);
            return;
          default:
            throw new Error(`Unknown job: ${job.name}`);
        }
      },
      {
        connection: this.redis,
        concurrency,
      },
    );

    this.queueEvents = new QueueEvents(MAIL_QUEUE_NAME, {
      connection: this.redis,
    });

    this.worker.on('completed', (job) => {
      this.logger.debug(`Completed job ${job.id} (${job.name})`);
    });

    this.worker.on('failed', (job, err) => {
      this.logger.error(`Failed job ${job?.id} (${job?.name}): ${err.message}`, err.stack);
    });

    this.queueEvents.on('waiting', ({ jobId }) => {
      this.logger.debug(`Job waiting: ${jobId}`);
    });

    this.logger.log(`Mail worker started with concurrency=${concurrency}`);
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queueEvents?.close();
  }

  private async handleOtp(job: Job<OtpMailJob>) {
    const { html, text } = this.templateService.renderOtpTemplate({
      name: job.data.name,
      otpCode: job.data.otpCode,
      expiresInMinutes: job.data.expiresInMinutes,
      appName: 'Your App',
    });

    await this.sesMailService.send({
      to: job.data.to,
      subject: job.data.subject,
      html,
      text,
      tags: job.data.tags,
      metadata: job.data.metadata,
    });
  }

  private async handleWelcome(job: Job<WelcomeMailJob>) {
    const { html, text } = this.templateService.renderWelcomeTemplate({
      name: job.data.name,
      appName: 'Your App',
      loginUrl: `${this.config.getOrThrow<string>('APP_URL')}/login`,
    });

    await this.sesMailService.send({
      to: job.data.to,
      subject: job.data.subject,
      html,
      text,
      tags: job.data.tags,
      metadata: job.data.metadata,
    });
  }

  private async handleBulkCampaign(job: Job<BulkCampaignJob>) {
    for (const recipient of job.data.recipients) {
      const html = this.templateService.renderCampaignTemplate(job.data.htmlTemplate, {
        firstName: recipient.name,
        email: recipient.email,
        ...(recipient.vars ?? {}),
      });

      const text = job.data.textTemplate
        ? this.templateService.renderCampaignTemplate(job.data.textTemplate, {
            firstName: recipient.name,
            email: recipient.email,
            ...(recipient.vars ?? {}),
          })
        : undefined;

      await this.sesMailService.send({
        to: recipient.email,
        subject: job.data.subject,
        html,
        text,
        tags: job.data.tags,
        metadata: {
          ...(job.data.metadata ?? {}),
          campaignId: job.data.campaignId,
        },
      });
    }
  }
}
```

---

## `src/mail/mail.controller.ts`

```ts
import { Body, Controller, Post } from '@nestjs/common';
import { MailService } from './mail.service';
import { IsArray, IsEmail, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class SendOtpDto {
  @IsEmail()
  to!: string;

  @IsOptional()
  @IsString()
  name?: string;
}

class CampaignRecipientDto {
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  name?: string;
}

class BulkCampaignDto {
  @IsString()
  campaignId!: string;

  @IsString()
  subject!: string;

  @IsString()
  htmlTemplate!: string;

  @IsOptional()
  @IsString()
  textTemplate?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CampaignRecipientDto)
  recipients!: CampaignRecipientDto[];
}

@Controller('mail')
export class MailController {
  constructor(private readonly mailService: MailService) {}

  @Post('otp')
  async sendOtp(@Body() body: SendOtpDto) {
    const otpCode = generateOtp();
    const job = await this.mailService.queueOtpEmail({
      to: body.to,
      name: body.name,
      otpCode,
      expiresInMinutes: 10,
    });

    return {
      queued: true,
      jobId: job.id,
      otpCode, // remove this in production
    };
  }

  @Post('campaign')
  async queueCampaign(@Body() body: BulkCampaignDto) {
    const jobs = await this.mailService.queueBulkCampaign({
      campaignId: body.campaignId,
      subject: body.subject,
      htmlTemplate: body.htmlTemplate,
      textTemplate: body.textTemplate,
      recipients: body.recipients,
      batchSize: 500,
    });

    return {
      queued: true,
      batches: jobs.length,
      jobIds: jobs.map((j) => j.id),
    };
  }
}

function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}
```

---

## `src/mail/mail.module.ts`

```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MailService } from './mail.service';
import { MailController } from './mail.controller';
import { SesMailService } from './ses-mail.service';
import { TemplateService } from './template.service';
import { MailWorker } from './mail.worker';
import { mailQueueProviders } from './mail.queue';

@Module({
  imports: [ConfigModule],
  controllers: [MailController],
  providers: [
    ...mailQueueProviders,
    MailService,
    SesMailService,
    TemplateService,
    MailWorker,
  ],
  exports: [MailService],
})
export class MailModule {}
```

---

## `src/app.module.ts`

```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MailModule } from './mail/mail.module';
import { validateEnv } from './common/env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    MailModule,
  ],
})
export class AppModule {}
```

---

## `src/main.ts`

```ts
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  await app.listen(process.env.PORT || 3000);
  console.log(`Server running on http://localhost:${process.env.PORT || 3000}`);
}

bootstrap();
```

---

## How to use it

### Send one OTP

```bash
curl -X POST http://localhost:3000/mail/otp \
  -H "Content-Type: application/json" \
  -d '{"to":"user@example.com","name":"Arun"}'
```

### Queue a large campaign

```bash
curl -X POST http://localhost:3000/mail/campaign \
  -H "Content-Type: application/json" \
  -d '{
    "campaignId":"spring-sale-001",
    "subject":"Hello {{firstName}}",
    "htmlTemplate":"<h1>Hi {{firstName}}</h1><p>Welcome to our sale.</p>",
    "textTemplate":"Hi {{firstName}}, Welcome to our sale.",
    "recipients":[
      {"email":"a@example.com","name":"Asha"},
      {"email":"b@example.com","name":"Bala"}
    ]
  }'
```

---

## Production notes

Use separate priorities for mail types. OTP should stay highest priority so bulk campaigns never delay it. BullMQ concurrency is local to the worker, and multiple workers can be run in parallel, so a common deployment is one API pod plus separate worker pods for mail processing. ([BullMQ][1])

Use SES configuration sets and event destinations for sends, deliveries, bounces, and complaints, then wire those into SNS, Firehose, or CloudWatch. That is the clean way to monitor and automatically stop unhealthy sending. ([AWS Documentation][5])

Keep bounce rate under 5% and complaint rate under 0.1%; AWS notes accounts can be paused if bounce rate goes above 10% or complaint rate above 0.5%. ([AWS Documentation][6])

For truly large sending, do not blast one giant job with 100k recipients. Split recipients into batches, keep OTP and transactional traffic on a separate queue or separate worker group, and scale workers horizontally. Nest recommends queues for smoothing processing peaks and scaling background work. ([NestJS Documentation][7])

