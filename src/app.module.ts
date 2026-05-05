import { Module } from '@nestjs/common';
import { PrismaModule } from 'prisma/prisma.module';
import { AccountModule } from './modules/account/account.module';
import { MovementModule } from './modules/movement/movement.module';
import { RabbitmqModule } from './modules/rabbitmq/rabbitmq.module';
import { MovementProcessorModule } from './modules/movement-processor/movement-processor.module';

@Module({
  imports: [RabbitmqModule, PrismaModule, AccountModule, MovementModule, MovementProcessorModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
