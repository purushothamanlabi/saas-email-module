import { Body, Controller, Post } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEmail,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { MailService } from './mail.service';

class SendOtpDto {
  @IsEmail()
  to!: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  @Type(() => Number)
  expiresInMinutes?: number;
}

class SendWelcomeDto {
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

  @IsOptional()
  @IsObject()
  vars?: Record<string, string>;
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

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  @Type(() => Number)
  batchSize?: number;
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
      expiresInMinutes: body.expiresInMinutes,
    });

    return {
      queued: true,
      jobId: job.id,
      otpCode,
    };
  }

  @Post('welcome')
  async sendWelcome(@Body() body: SendWelcomeDto) {
    const job = await this.mailService.queueWelcomeEmail({
      to: body.to,
      name: body.name,
    });

    return {
      queued: true,
      jobId: job.id,
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
      batchSize: body.batchSize,
    });

    return {
      queued: true,
      queuedRecipients: jobs.length,
      jobIds: jobs.map((job) => job.id),
    };
  }
}

function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}
