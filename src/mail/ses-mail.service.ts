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
        secretAccessKey: this.config.getOrThrow<string>(
          'AWS_SECRET_ACCESS_KEY',
        ),
      },
    });
  }

  async send(input: SendSesMailInput): Promise<{ messageId?: string }> {
    const fromEmail = this.config.getOrThrow<string>('MAIL_FROM_EMAIL');
    const fromName = this.config.getOrThrow<string>('MAIL_FROM_NAME');
    const replyTo = this.config.getOrThrow<string>('MAIL_REPLY_TO');
    const configurationSetName = this.config.get<string>(
      'SES_CONFIGURATION_SET',
    );
    const emailTags = buildEmailTags(input.tags, input.metadata);

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
      ...(configurationSetName
        ? { ConfigurationSetName: configurationSetName }
        : {}),
      ...(emailTags.length ? { EmailTags: emailTags } : {}),
    };

    const result = await this.client.send(new SendEmailCommand(sesInput));
    this.logger.debug(
      `SES accepted email to=${input.to} messageId=${result.MessageId}`,
    );

    return { messageId: result.MessageId };
  }
}

function buildEmailTags(
  tags?: string[],
  metadata?: Record<string, string>,
): NonNullable<SendEmailCommandInput['EmailTags']> {
  const namedTags = (tags ?? []).map((tag, index) => ({
    Name: `tag${index + 1}`,
    Value: tag,
  }));
  const metadataTags = Object.entries(metadata ?? {}).map(([key, value]) => ({
    Name: normalizeTagName(key),
    Value: value,
  }));

  return [...namedTags, ...metadataTags].slice(0, 10);
}

function normalizeTagName(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 256);

  return normalized || 'metadata';
}
