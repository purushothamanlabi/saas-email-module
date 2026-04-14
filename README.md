# NestJS SES Mail Queue Module

A production-style NestJS mail service that queues email work with BullMQ and Redis, then sends mail through Amazon SES v2.

The module supports:

- OTP emails
- Welcome emails
- Bulk campaign emails
- Per-recipient campaign jobs
- Automatic retry for failed sends
- Configurable worker concurrency
- API-only and worker-enabled runtime modes

## Stack

- NestJS 11
- BullMQ
- Redis through `ioredis`
- Amazon SES v2 through `@aws-sdk/client-sesv2`
- `@nestjs/config`
- `class-validator` and `class-transformer`

## Project Structure

```text
src/
  app.module.ts
  main.ts
  mail/
    env.validation.ts
    mail.constants.ts
    mail.controller.ts
    mail.module.ts
    mail.queue.ts
    mail.service.ts
    mail.types.ts
    mail.worker.ts
    ses-mail.service.ts
    template.service.ts
```

## Setup

Install dependencies:

```bash
npm install
```

Create a local environment file:

```bash
copy .env.example .env
```

Update `.env` with your Redis and AWS SES settings:

```env
PORT=3000
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=

AWS_REGION=ap-south-1
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key

MAIL_FROM_EMAIL=no-reply@yourdomain.com
MAIL_FROM_NAME=Your App
MAIL_REPLY_TO=support@yourdomain.com

SES_CONFIGURATION_SET=app-transactional
MAIL_WORKER_CONCURRENCY=1000
MAIL_WORKER_ENABLED=true

APP_URL=https://yourapp.com
```

Redis must be running before queueing or processing mail. For local development, one simple option is:

```bash
docker run --name mail-redis -p 6379:6379 redis:7
```

## Running

Start the app:

```bash
npm run start:dev
```

Production mode:

```bash
npm run build
npm run start:prod
```

Runtime modes:

- `MAIL_WORKER_ENABLED=true`: API and mail worker run in the same NestJS process.
- `MAIL_WORKER_ENABLED=false`: API can queue mail, but this process will not consume jobs.

For separate API and worker deployments, run API processes with `MAIL_WORKER_ENABLED=false` and worker processes with `MAIL_WORKER_ENABLED=true`.

## API

### Queue OTP Email

```bash
curl -X POST http://localhost:3000/mail/otp \
  -H "Content-Type: application/json" \
  -d "{\"to\":\"user@example.com\",\"name\":\"Arun\",\"expiresInMinutes\":10}"
```

Response:

```json
{
  "queued": true,
  "jobId": "1",
  "otpCode": "123456"
}
```

`otpCode` is returned by the demo controller for testing. Remove it from responses before using this endpoint in production.

### Queue Welcome Email

```bash
curl -X POST http://localhost:3000/mail/welcome \
  -H "Content-Type: application/json" \
  -d "{\"to\":\"user@example.com\",\"name\":\"Arun\"}"
```

Response:

```json
{
  "queued": true,
  "jobId": "2"
}
```

### Queue Campaign Emails

```bash
curl -X POST http://localhost:3000/mail/campaign \
  -H "Content-Type: application/json" \
  -d "{\"campaignId\":\"spring-sale-001\",\"subject\":\"Hello {{firstName}}\",\"htmlTemplate\":\"<h1>Hi {{firstName}}</h1><p>{{email}}</p>\",\"textTemplate\":\"Hi {{firstName}}\",\"batchSize\":500,\"recipients\":[{\"email\":\"a@example.com\",\"name\":\"Asha\"},{\"email\":\"b@example.com\",\"name\":\"Bala\"}]}"
```

Response:

```json
{
  "queued": true,
  "queuedRecipients": 2,
  "jobIds": [
    "campaign-recipient-...",
    "campaign-recipient-..."
  ]
}
```

Campaign behavior:

- Each recipient becomes one BullMQ job.
- Each campaign job sends exactly one email.
- Failed campaign emails retry independently.
- `batchSize` only controls how many jobs are inserted per `addBulk` call.
- Campaign templates support variables like `{{firstName}}` and `{{email}}`.

## Queue And Retry Behavior

The queue name is:

```text
mail-queue
```

Default retry configuration:

```ts
attempts: 5
backoff: {
  type: 'exponential',
  delay: 2000,
}
removeOnComplete: 1000
removeOnFail: 5000
```

Retry scope:

- OTP retry is per email.
- Welcome retry is per email.
- Campaign retry is per recipient email.

Campaign recipient job IDs are deterministic:

```text
campaign-recipient-<sha256(campaignId + email)>
```

This helps prevent duplicate queued jobs for the same campaign recipient while the BullMQ job still exists.

## Worker Concurrency

`MAIL_WORKER_CONCURRENCY` controls the maximum number of active jobs in one worker process.

It is a maximum, not a fixed number of running jobs.

Example:

```text
Queued jobs: 5
MAIL_WORKER_CONCURRENCY: 1000
Actual active jobs: 5
Idle capacity: 995
```

Code-level throughput formula:

```text
emails_per_second = active_concurrency / average_send_latency_seconds
```

With `MAIL_WORKER_CONCURRENCY=1000`, the worker can run up to 1,000 active mail jobs if enough jobs exist. Actual emails per second still depends on SES/API latency and external limits.

## Validation

Request bodies are validated globally with NestJS `ValidationPipe`:

- unknown body fields are rejected
- DTO values are transformed where configured
- invalid email and numeric values return validation errors

Environment variables are validated in `src/mail/env.validation.ts` on app startup.

## Scripts

```bash
# build
npm run build

# development server
npm run start:dev

# lint and auto-fix
npm run lint

# unit tests
npm run test

# e2e tests
npm run test:e2e
```

In restricted Windows or sandbox environments, Jest worker spawning can fail with `spawn EPERM`. Use single-process Jest commands when needed:

```bash
npx jest --runInBand
npx jest --config ./test/jest-e2e.json --runInBand
```

## Verification

The project has been verified with:

```bash
npm run build
npm run lint
npx jest --runInBand
npx jest --config ./test/jest-e2e.json --runInBand
```

Current tests cover:

- root app endpoint
- campaign queueing as one job per recipient
- campaign worker sending one recipient per job
- template rendering for campaign subject, HTML, and text

## Production Notes

- Verify the SES sender identity or domain before sending real mail.
- SES sandbox accounts can only send to verified recipients.
- Configure SES configuration sets for delivery, bounce, complaint, reject, and send events.
- Keep OTP and transactional email priority higher than campaign email.
- Avoid returning very large `jobIds` arrays for huge campaigns; use a campaign tracking endpoint or database record for large production campaigns.
- Store AWS credentials and secrets outside source code.
