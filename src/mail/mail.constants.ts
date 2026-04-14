export const MAIL_QUEUE_NAME = 'mail-queue';

export const MAIL_JOB_NAMES = {
  OTP: 'send-otp-email',
  WELCOME: 'send-welcome-email',
  BULK_CAMPAIGN_RECIPIENT: 'send-bulk-campaign-recipient',
} as const;
