import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { MailWorker } from './mail.worker';
import { SendSesMailInput, SesMailService } from './ses-mail.service';
import { TemplateService } from './template.service';
import { CampaignRecipientMailJob } from './mail.types';

describe('MailWorker', () => {
  it('sends one campaign recipient per campaign job', async () => {
    const send = jest
      .fn<Promise<{ messageId?: string }>, [SendSesMailInput]>()
      .mockResolvedValue({ messageId: 'message-1' });
    const worker = new MailWorker(
      {} as ConfigService,
      { send } as unknown as SesMailService,
      new TemplateService(),
    );
    const handler = worker as unknown as {
      handleCampaignRecipient(
        job: Job<CampaignRecipientMailJob>,
      ): Promise<void>;
    };

    await handler.handleCampaignRecipient({
      data: {
        type: 'campaign-recipient',
        campaignId: 'spring-sale',
        subject: 'Hello {{firstName}}',
        recipient: {
          email: 'a@example.com',
          name: 'Asha',
        },
        htmlTemplate: '<p>{{email}}</p>',
        textTemplate: 'Hi {{firstName}}',
        tags: ['bulk', 'campaign'],
        metadata: {
          mailType: 'bulk-campaign',
          campaignId: 'spring-sale',
        },
      },
    } as Job<CampaignRecipientMailJob>);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      to: 'a@example.com',
      subject: 'Hello Asha',
      html: '<p>a@example.com</p>',
      text: 'Hi Asha',
      tags: ['bulk', 'campaign'],
      metadata: {
        mailType: 'bulk-campaign',
        campaignId: 'spring-sale',
      },
    });
  });
});
