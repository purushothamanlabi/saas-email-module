import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, QueueEvents, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { MAIL_JOB_NAMES, MAIL_QUEUE_NAME } from './mail.constants';
import { createRedisConnection } from './mail.queue';
import {
  CampaignRecipientMailJob,
  OtpMailJob,
  WelcomeMailJob,
} from './mail.types';
import { SesMailService } from './ses-mail.service';
import { TemplateService } from './template.service';

@Injectable()
export class MailWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MailWorker.name);
  private worker?: Worker;
  private workerConnection?: IORedis;
  private queueEvents?: QueueEvents;
  private queueEventsConnection?: IORedis;

  constructor(
    private readonly config: ConfigService,
    private readonly sesMailService: SesMailService,
    private readonly templateService: TemplateService,
  ) {}

  onModuleInit() {
    if (!this.isWorkerEnabled()) {
      this.logger.log('Mail worker disabled');
      return;
    }

    const concurrency = this.config.getOrThrow<number>(
      'MAIL_WORKER_CONCURRENCY',
    );
    this.workerConnection = createRedisConnection(this.config);
    this.queueEventsConnection = createRedisConnection(this.config);

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
          case MAIL_JOB_NAMES.BULK_CAMPAIGN_RECIPIENT:
            await this.handleCampaignRecipient(
              job as Job<CampaignRecipientMailJob>,
            );
            return;
          default:
            throw new Error(`Unknown job: ${job.name}`);
        }
      },
      {
        connection: this.workerConnection,
        concurrency,
      },
    );

    this.queueEvents = new QueueEvents(MAIL_QUEUE_NAME, {
      connection: this.queueEventsConnection,
    });

    this.worker.on('completed', (job) => {
      this.logger.debug(`Completed job ${job.id} (${job.name})`);
    });

    this.worker.on('failed', (job, err) => {
      this.logger.error(
        `Failed job ${job?.id} (${job?.name}): ${err.message}`,
        err.stack,
      );
    });

    this.worker.on('error', (err) => {
      this.logger.error(`Mail worker error: ${err.message}`, err.stack);
    });

    this.queueEvents.on('waiting', ({ jobId }) => {
      this.logger.debug(`Job waiting: ${jobId}`);
    });

    this.queueEvents.on('error', (err) => {
      this.logger.error(`Mail queue event error: ${err.message}`, err.stack);
    });

    this.logger.log(`Mail worker started with concurrency=${concurrency}`);
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queueEvents?.close();
    this.workerConnection?.disconnect();
    this.queueEventsConnection?.disconnect();
  }

  private async handleOtp(job: Job<OtpMailJob>) {
    const appName = this.config.getOrThrow<string>('MAIL_FROM_NAME');
    const { html, text } = this.templateService.renderOtpTemplate({
      name: job.data.name,
      otpCode: job.data.otpCode,
      expiresInMinutes: job.data.expiresInMinutes,
      appName,
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
    const appName = this.config.getOrThrow<string>('MAIL_FROM_NAME');
    const { html, text } = this.templateService.renderWelcomeTemplate({
      name: job.data.name,
      appName,
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

  private async handleCampaignRecipient(job: Job<CampaignRecipientMailJob>) {
    const { recipient } = job.data;
    const vars = {
      firstName: recipient.name,
      email: recipient.email,
      ...(recipient.vars ?? {}),
    };
    const subject = this.templateService.renderCampaignTemplate(
      job.data.subject,
      vars,
      { escapeHtml: false },
    );
    const html = this.templateService.renderCampaignTemplate(
      job.data.htmlTemplate,
      vars,
    );
    const text = job.data.textTemplate
      ? this.templateService.renderCampaignTemplate(
          job.data.textTemplate,
          vars,
          {
            escapeHtml: false,
          },
        )
      : undefined;

    await this.sesMailService.send({
      to: recipient.email,
      subject,
      html,
      text,
      tags: job.data.tags,
      metadata: {
        ...(job.data.metadata ?? {}),
        campaignId: job.data.campaignId,
      },
    });
  }

  private isWorkerEnabled(): boolean {
    const configured = this.config.get<string>('MAIL_WORKER_ENABLED');

    if (configured === undefined) {
      return this.config.get<string>('NODE_ENV') !== 'test';
    }

    return !['0', 'false', 'no', 'off'].includes(configured.toLowerCase());
  }
}
