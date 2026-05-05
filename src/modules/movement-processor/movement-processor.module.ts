import { Module } from '@nestjs/common';
import { RabbitmqModule } from '../rabbitmq/rabbitmq.module';
import { MovementConsumer } from './movement.consumer';
import { MovementProcessor } from './movement.processor';

@Module({
  imports: [
    RabbitmqModule,
  ],
  providers: [
    MovementConsumer,
    MovementProcessor,
  ],
})
export class MovementProcessorModule {}