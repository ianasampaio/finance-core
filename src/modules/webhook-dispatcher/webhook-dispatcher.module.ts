import { Module } from '@nestjs/common';
import { WebhookConsumer } from './webhook.consumer';
import { WebhookDispatcher } from './webhook.dispatcher';

@Module({
  providers: [WebhookConsumer, WebhookDispatcher],
})
export class WebhookDispatcherModule {}
