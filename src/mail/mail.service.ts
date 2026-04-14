import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { createHash } from 'crypto';
import IORedis from 'ioredis';
import { MAIL_JOB_NAMES } from './mail.constants';
import { MAIL_QUEUE, REDIS_CONNECTION } from './mail.queue';
import {
  CampaignRecipientMailJob,
  CampaignRecipient,
  MailJobData,
  OtpMailJob,
  WelcomeMailJob,
} from './mail.types';

@Injectable()
export class MailService implements OnModuleDestroy {
  constructor(
    @Inject(MAIL_QUEUE) private readonly mailQueue: Queue<MailJobData>,
    @Inject(REDIS_CONNECTION) private readonly redis: IORedis,
  ) {}

  async onModuleDestroy() {
    await this.mailQueue.close();
    this.redis.disconnect();
  }

  async queueOtpEmail(input: {
    to: string;
    name?: string;
    otpCode: string;
    expiresInMinutes?: number;
  }): Promise<Job<OtpMailJob>> {
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

    const queuedJob = await this.mailQueue.add(MAIL_JOB_NAMES.OTP, job, {
      priority: 1,
    });

    return queuedJob as Job<OtpMailJob>;
  }

  async queueWelcomeEmail(input: {
    to: string;
    name?: string;
  }): Promise<Job<WelcomeMailJob>> {
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

    const queuedJob = await this.mailQueue.add(MAIL_JOB_NAMES.WELCOME, job, {
      priority: 3,
    });

    return queuedJob as Job<WelcomeMailJob>;
  }

  async queueBulkCampaign(input: {
    campaignId: string;
    subject: string;
    recipients: CampaignRecipient[];
    htmlTemplate: string;
    textTemplate?: string;
    batchSize?: number;
  }): Promise<Job<CampaignRecipientMailJob>[]> {
    const batchSize = input.batchSize ?? 500;
    const batches = chunkArray(input.recipients, batchSize);
    const queuedJobs: Job<CampaignRecipientMailJob>[] = [];

    for (const recipients of batches) {
      const jobs = recipients.map((recipient) => {
        const job: CampaignRecipientMailJob = {
          type: 'campaign-recipient',
          campaignId: input.campaignId,
          subject: input.subject,
          recipient,
          htmlTemplate: input.htmlTemplate,
          textTemplate: input.textTemplate,
          tags: ['bulk', 'campaign'],
          metadata: {
            mailType: 'bulk-campaign',
            campaignId: input.campaignId,
          },
        };

        return {
          name: MAIL_JOB_NAMES.BULK_CAMPAIGN_RECIPIENT,
          data: job,
          opts: {
            priority: 5,
            jobId: createCampaignRecipientJobId(
              input.campaignId,
              recipient.email,
            ),
          },
        };
      });

      const chunkQueuedJobs = await this.mailQueue.addBulk(jobs);
      queuedJobs.push(...(chunkQueuedJobs as Job<CampaignRecipientMailJob>[]));
    }

    return queuedJobs;
  }
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];

  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }

  return out;
}

function createCampaignRecipientJobId(
  campaignId: string,
  recipientEmail: string,
): string {
  const hash = createHash('sha256')
    .update(`${campaignId}\n${recipientEmail.toLowerCase()}`)
    .digest('hex');

  return `campaign-recipient-${hash}`;
}
