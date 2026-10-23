import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import type { Queue } from '../types.ts';

export class SqsQueue implements Queue {
  private readonly client: SQSClient;

  constructor(
    private readonly queueUrl: string,
    options: { region?: string; client?: SQSClient } = {},
  ) {
    this.client = options.client ?? new SQSClient(options.region ? { region: options.region } : {});
  }

  async send(message: unknown, options: { delaySeconds?: number } = {}): Promise<void> {
    await this.client.send(
      new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: typeof message === 'string' ? message : JSON.stringify(message),
        DelaySeconds: options.delaySeconds,
      }),
    );
  }
}
