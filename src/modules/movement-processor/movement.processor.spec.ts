import { Test, TestingModule } from '@nestjs/testing';
import { MovementStatus, MovementType, Prisma } from '@prisma/client';
import { PrismaService } from 'prisma/prisma.service';
import {
  InvalidMovementAmountError,
  MovementNotFoundError,
} from 'src/shared/errors/movement.errors';
import { MovementCreatedData } from 'src/shared/types/movement-events.types';
import { MOVEMENT_EVENTS } from '../rabbitmq/rabbitmq.constants';
import { DomainEvent, RabbitmqService } from '../rabbitmq/rabbitmq.service';
import { MovementProcessor } from './movement.processor';

type TxMock = {
  movement: { findUnique: jest.Mock; update: jest.Mock };
  account: { findUniqueOrThrow: jest.Mock; update: jest.Mock };
  $executeRaw: jest.Mock;
};

const buildEvent = (
  data: Partial<MovementCreatedData> = {},
): DomainEvent<MovementCreatedData> => ({
  eventId: 'event-id',
  eventType: MOVEMENT_EVENTS.CREATED,
  version: 1,
  aggregateId: 'movement-id',
  occurredAt: '2026-05-15T10:00:00.000Z',
  data: {
    accountId: 'account-id',
    type: MovementType.DEBIT,
    amount: '100',
    status: MovementStatus.PENDING,
    description: 'desc',
    createdAt: '2026-05-15T10:00:00.000Z',
    ...data,
  },
});

describe('MovementProcessor', () => {
  let processor: MovementProcessor;
  let tx: TxMock;
  let prisma: { $transaction: jest.Mock };
  let rabbitmq: { publishEvent: jest.Mock };

  beforeEach(async () => {
    tx = {
      movement: { findUnique: jest.fn(), update: jest.fn() },
      account: { findUniqueOrThrow: jest.fn(), update: jest.fn() },
      $executeRaw: jest.fn().mockResolvedValue(1),
    };
    prisma = {
      $transaction: jest.fn((cb: (tx: TxMock) => Promise<unknown>) => cb(tx)),
    };
    rabbitmq = { publishEvent: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MovementProcessor,
        { provide: PrismaService, useValue: prisma },
        { provide: RabbitmqService, useValue: rabbitmq },
      ],
    }).compile();

    processor = module.get(MovementProcessor);
  });

  it('ignores events whose type is not movement.created', async () => {
    const event = buildEvent();
    (event as DomainEvent<unknown>).eventType = 'other.event';

    await processor.process(event as DomainEvent<unknown>);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(rabbitmq.publishEvent).not.toHaveBeenCalled();
  });

  it('throws InvalidMovementAmountError when amount is zero or negative', async () => {
    await expect(processor.process(buildEvent({ amount: '0' }))).rejects.toThrow(
      InvalidMovementAmountError,
    );
    await expect(processor.process(buildEvent({ amount: '-5' }))).rejects.toThrow(
      InvalidMovementAmountError,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('throws InvalidMovementAmountError when amount is not a number', async () => {
    await expect(processor.process(buildEvent({ amount: 'abc' }))).rejects.toThrow(
      InvalidMovementAmountError,
    );
  });

  it('throws MovementNotFoundError when movement does not exist for the account', async () => {
    tx.movement.findUnique.mockResolvedValue(null);

    await expect(processor.process(buildEvent())).rejects.toThrow(MovementNotFoundError);
    expect(tx.movement.update).not.toHaveBeenCalled();
  });

  it('skips processing when movement is already processed (idempotency)', async () => {
    tx.movement.findUnique.mockResolvedValue({
      id: 'movement-id',
      status: MovementStatus.SUCCESS,
    });

    await processor.process(buildEvent());

    expect(tx.account.update).not.toHaveBeenCalled();
    expect(tx.movement.update).not.toHaveBeenCalled();
    expect(rabbitmq.publishEvent).not.toHaveBeenCalled();
  });

  describe('DEBIT', () => {
    beforeEach(() => {
      tx.movement.findUnique.mockResolvedValue({
        id: 'movement-id',
        status: MovementStatus.PENDING,
      });
    });

    it('accepts debit when amount <= balance + creditLimit and decreases the balance', async () => {
      tx.account.findUniqueOrThrow.mockResolvedValue({
        balance: new Prisma.Decimal('200'),
        creditLimit: new Prisma.Decimal('1000'),
      });

      await processor.process(buildEvent({ type: MovementType.DEBIT, amount: '150' }));

      expect(tx.account.update).toHaveBeenCalledWith({
        where: { id: 'account-id' },
        data: { balance: '50' },
      });
      expect(tx.movement.update).toHaveBeenCalledWith({
        where: { id: 'movement-id' },
        data: expect.objectContaining({
          status: MovementStatus.SUCCESS,
          balanceAfter: '50',
        }),
      });
      expect(rabbitmq.publishEvent).toHaveBeenCalledWith(
        MOVEMENT_EVENTS.CONFIRMED,
        'movement-id',
        expect.objectContaining({ status: MovementStatus.SUCCESS, balanceAfter: '50' }),
      );
    });

    it('rejects debit when amount exceeds available limit and keeps the balance', async () => {
      tx.account.findUniqueOrThrow.mockResolvedValue({
        balance: new Prisma.Decimal('100'),
        creditLimit: new Prisma.Decimal('50'),
      });

      await processor.process(buildEvent({ type: MovementType.DEBIT, amount: '200' }));

      expect(tx.account.update).not.toHaveBeenCalled();
      expect(tx.movement.update).toHaveBeenCalledWith({
        where: { id: 'movement-id' },
        data: expect.objectContaining({
          status: MovementStatus.FAILED,
          balanceAfter: '100',
        }),
      });
      expect(rabbitmq.publishEvent).toHaveBeenCalledWith(
        MOVEMENT_EVENTS.FAILED,
        'movement-id',
        expect.objectContaining({ status: MovementStatus.FAILED, balanceAfter: '100' }),
      );
    });
  });

  describe('CREDIT', () => {
    it('always accepts credit and increases the balance', async () => {
      tx.movement.findUnique.mockResolvedValue({
        id: 'movement-id',
        status: MovementStatus.PENDING,
      });
      tx.account.findUniqueOrThrow.mockResolvedValue({
        balance: new Prisma.Decimal('100'),
        creditLimit: new Prisma.Decimal('1000'),
      });

      await processor.process(buildEvent({ type: MovementType.CREDIT, amount: '250' }));

      expect(tx.account.update).toHaveBeenCalledWith({
        where: { id: 'account-id' },
        data: { balance: '350' },
      });
      expect(tx.movement.update).toHaveBeenCalledWith({
        where: { id: 'movement-id' },
        data: expect.objectContaining({
          status: MovementStatus.SUCCESS,
          balanceAfter: '350',
        }),
      });
      expect(rabbitmq.publishEvent).toHaveBeenCalledWith(
        MOVEMENT_EVENTS.CONFIRMED,
        'movement-id',
        expect.objectContaining({ status: MovementStatus.SUCCESS, balanceAfter: '350' }),
      );
    });
  });

  it('locks the account row inside the transaction before reading the balance', async () => {
    tx.movement.findUnique.mockResolvedValue({
      id: 'movement-id',
      status: MovementStatus.PENDING,
    });
    tx.account.findUniqueOrThrow.mockResolvedValue({
      balance: new Prisma.Decimal('100'),
      creditLimit: new Prisma.Decimal('1000'),
    });

    await processor.process(buildEvent({ type: MovementType.CREDIT, amount: '10' }));

    const lockCallOrder = tx.$executeRaw.mock.invocationCallOrder[0];
    const readCallOrder = tx.account.findUniqueOrThrow.mock.invocationCallOrder[0];
    expect(lockCallOrder).toBeLessThan(readCallOrder);
  });
});
