import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { MAIL_QUEUE_NAME } from './mail.constants';
import { MailJobData } from './mail.types';

export const REDIS_CONNECTION = Symbol('REDIS_CONNECTION');
export const MAIL_QUEUE = Symbol('MAIL_QUEUE');

export function createRedisConnection(config: ConfigService): IORedis {
  return new IORedis({
    host: config.getOrThrow<string>('REDIS_HOST'),
    port: config.getOrThrow<number>('REDIS_PORT'),
    password: config.get<string>('REDIS_PASSWORD') || undefined,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
  });
}

export const mailQueueProviders: Provider[] = [
  {
    provide: REDIS_CONNECTION,
    inject: [ConfigService],
    useFactory: (config: ConfigService) => {
      return createRedisConnection(config);
    },
  },
  {
    provide: MAIL_QUEUE,
    inject: [REDIS_CONNECTION],
    useFactory: (connection: IORedis): Queue<MailJobData> => {
      return new Queue<MailJobData>(MAIL_QUEUE_NAME, {
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
