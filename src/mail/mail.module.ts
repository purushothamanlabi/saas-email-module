import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MailController } from './mail.controller';
import { mailQueueProviders } from './mail.queue';
import { MailService } from './mail.service';
import { MailWorker } from './mail.worker';
import { SesMailService } from './ses-mail.service';
import { TemplateService } from './template.service';

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
