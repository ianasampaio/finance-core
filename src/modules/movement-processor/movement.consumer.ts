import { Injectable, OnModuleInit } from '@nestjs/common';
import { RabbitmqService, DomainEvent } from '../rabbitmq/rabbitmq.service';
import { RABBITMQ_QUEUES } from '../rabbitmq/rabbitmq.constants';
import { MovementProcessor } from './movement.processor';

@Injectable()
export class MovementConsumer implements OnModuleInit {
  constructor(
    private readonly rabbitmq: RabbitmqService,
    private readonly processor: MovementProcessor,
  ) {}

  async onModuleInit() {
    await this.rabbitmq.consume(
      RABBITMQ_QUEUES.BALANCE,
      async (msg) => {
        const content = msg.content.toString();

        const event: DomainEvent<unknown> = JSON.parse(content);

        await this.processor.process(event);
      },
    );
  }
}