import { Test, TestingModule } from '@nestjs/testing';
import { RABBITMQ_QUEUES } from '../rabbitmq/rabbitmq.constants';
import { RabbitmqService } from '../rabbitmq/rabbitmq.service';
import { MovementConsumer } from './movement.consumer';
import { MovementProcessor } from './movement.processor';

describe('MovementConsumer', () => {
  let consumer: MovementConsumer;
  let rabbitmq: { consume: jest.Mock };
  let processor: { process: jest.Mock };

  beforeEach(async () => {
    rabbitmq = { consume: jest.fn() };
    processor = { process: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MovementConsumer,
        { provide: RabbitmqService, useValue: rabbitmq },
        { provide: MovementProcessor, useValue: processor },
      ],
    }).compile();

    consumer = module.get(MovementConsumer);
  });

  it('subscribes to the balance queue on module init', async () => {
    await consumer.onModuleInit();

    expect(rabbitmq.consume).toHaveBeenCalledWith(
      RABBITMQ_QUEUES.BALANCE,
      expect.any(Function),
    );
  });

  it('parses the message content and delegates to the processor', async () => {
    let handler: (msg: { content: Buffer }) => Promise<void> = async () => {};
    rabbitmq.consume.mockImplementation((_queue, cb) => {
      handler = cb;
    });

    await consumer.onModuleInit();

    const event = { eventType: 'movement.created', aggregateId: 'mov-1' };
    await handler({ content: Buffer.from(JSON.stringify(event)) });

    expect(processor.process).toHaveBeenCalledWith(event);
  });
});
