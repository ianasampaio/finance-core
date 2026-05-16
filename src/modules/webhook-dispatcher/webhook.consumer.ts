import { Injectable, OnModuleInit } from '@nestjs/common';
import { DomainEvent, RabbitmqService } from '../rabbitmq/rabbitmq.service';
import { RABBITMQ_QUEUES } from '../rabbitmq/rabbitmq.constants';
import { MovementProcessedPayload } from 'src/shared/types/movement-events.types';
import { WebhookDispatcher } from './webhook.dispatcher';

@Injectable()
export class WebhookConsumer implements OnModuleInit {
  constructor(
    private readonly rabbitmq: RabbitmqService,
    private readonly dispatcher: WebhookDispatcher,
  ) {}

  async onModuleInit() {
    await this.rabbitmq.consume(RABBITMQ_QUEUES.WEBHOOK, async (msg) => {
      const event: DomainEvent<MovementProcessedPayload> = JSON.parse(
        msg.content.toString(),
      );
      await this.dispatcher.handleEvent(event);
    });
  }
}
