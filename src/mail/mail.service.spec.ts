import { Job, Queue } from 'bullmq';
import IORedis from 'ioredis';
import { MAIL_JOB_NAMES } from './mail.constants';
import { MailService } from './mail.service';
import { CampaignRecipientMailJob, MailJobData } from './mail.types';

type BulkJobInput = {
  name: string;
  data: CampaignRecipientMailJob;
  opts: {
    priority: number;
    jobId: string;
  };
};

describe('MailService', () => {
  function createService() {
    const addBulk = jest.fn((jobs: BulkJobInput[]) => {
      return Promise.resolve(
        jobs.map(
          (job) =>
            ({
              id: job.opts.jobId,
              name: job.name,
              data: job.data,
            }) as Job<CampaignRecipientMailJob>,
        ),
      );
    });
    const queue = {
      addBulk,
      close: jest.fn(),
    } as unknown as Queue<MailJobData>;
    const redis = {
      disconnect: jest.fn(),
    } as unknown as IORedis;

    return {
      addBulk,
      service: new MailService(queue, redis),
    };
  }

  it('queues one campaign job per recipient', async () => {
    const { addBulk, service } = createService();

    const jobs = await service.queueBulkCampaign({
      campaignId: 'spring-sale',
      subject: 'Hello {{firstName}}',
      htmlTemplate: '<p>{{email}}</p>',
      textTemplate: 'Hi {{firstName}}',
      batchSize: 2,
      recipients: [
        { email: 'a@example.com', name: 'Asha' },
        { email: 'b@example.com', name: 'Bala' },
        { email: 'c@example.com', name: 'Chitra' },
      ],
    });

    const queuedInputs = addBulk.mock.calls.flatMap(([chunk]) => chunk);

    expect(addBulk).toHaveBeenCalledTimes(2);
    expect(jobs).toHaveLength(3);
    expect(queuedInputs).toHaveLength(3);
    expect(queuedInputs.map((job) => job.name)).toEqual([
      MAIL_JOB_NAMES.BULK_CAMPAIGN_RECIPIENT,
      MAIL_JOB_NAMES.BULK_CAMPAIGN_RECIPIENT,
      MAIL_JOB_NAMES.BULK_CAMPAIGN_RECIPIENT,
    ]);
    expect(queuedInputs.map((job) => job.data.recipient.email)).toEqual([
      'a@example.com',
      'b@example.com',
      'c@example.com',
    ]);
    expect(queuedInputs[0].data).not.toHaveProperty('recipients');
    expect(queuedInputs.map((job) => job.opts.priority)).toEqual([5, 5, 5]);
    expect(
      queuedInputs.every((job) =>
        /^campaign-recipient-[a-f0-9]{64}$/.test(job.opts.jobId),
      ),
    ).toBe(true);
    expect(new Set(queuedInputs.map((job) => job.opts.jobId)).size).toBe(3);
  });
});
