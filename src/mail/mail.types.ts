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

export interface CampaignRecipientMailJob {
  type: 'campaign-recipient';
  campaignId: string;
  subject: string;
  recipient: CampaignRecipient;
  htmlTemplate: string;
  textTemplate?: string;
  tags?: string[];
  metadata?: Record<string, string>;
}

export type MailJobData =
  | OtpMailJob
  | WelcomeMailJob
  | CampaignRecipientMailJob;
