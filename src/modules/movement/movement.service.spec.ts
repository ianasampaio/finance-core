import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { MovementStatus, MovementType, Prisma } from '@prisma/client';
import { PrismaService } from 'prisma/prisma.service';
import { MOVEMENT_EVENTS } from '../rabbitmq/rabbitmq.constants';
import { RabbitmqService } from '../rabbitmq/rabbitmq.service';
import { MovementService } from './movement.service';

jest.mock('src/shared/uuid-generator', () => ({
  UUIDGenerator: { generate: jest.fn(() => 'generated-uuid') },
}));

describe('MovementService', () => {
  let service: MovementService;
  let prisma: { movement: { create: jest.Mock; findUnique: jest.Mock } };
  let rabbitmq: { publishEvent: jest.Mock };

  beforeEach(async () => {
    prisma = {
      movement: {
        create: jest.fn(),
        findUnique: jest.fn(),
      },
    };
    rabbitmq = { publishEvent: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MovementService,
        { provide: PrismaService, useValue: prisma },
        { provide: RabbitmqService, useValue: rabbitmq },
      ],
    }).compile();

    service = module.get(MovementService);
  });

  describe('create', () => {
    const dto = {
      accountId: 'account-uuid',
      amount: 100.5,
      type: MovementType.DEBIT,
      description: 'Compra',
    };

    const createdMovement = {
      id: 'generated-uuid',
      accountId: 'account-uuid',
      amount: new Prisma.Decimal(100.5),
      type: MovementType.DEBIT,
      description: 'Compra',
      status: MovementStatus.PENDING,
      balanceAfter: null,
      createdAt: new Date('2026-05-15T10:00:00.000Z'),
      processedAt: null,
    };

    it('persists the movement as PENDING', async () => {
      prisma.movement.create.mockResolvedValue(createdMovement);

      await service.create(dto);

      expect(prisma.movement.create).toHaveBeenCalledWith({
        data: {
          id: 'generated-uuid',
          accountId: 'account-uuid',
          amount: expect.any(Prisma.Decimal),
          type: MovementType.DEBIT,
          description: 'Compra',
          status: MovementStatus.PENDING,
        },
      });
    });

    it('publishes a movement.created event with the typed payload', async () => {
      prisma.movement.create.mockResolvedValue(createdMovement);

      await service.create(dto);

      expect(rabbitmq.publishEvent).toHaveBeenCalledWith(
        MOVEMENT_EVENTS.CREATED,
        'generated-uuid',
        {
          accountId: 'account-uuid',
          type: MovementType.DEBIT,
          amount: '100.5',
          status: MovementStatus.PENDING,
          description: 'Compra',
          createdAt: '2026-05-15T10:00:00.000Z',
        },
      );
    });

    it('returns the movement response shape', async () => {
      prisma.movement.create.mockResolvedValue(createdMovement);

      const result = await service.create(dto);

      expect(result).toEqual({
        movementId: 'generated-uuid',
        accountId: 'account-uuid',
        type: MovementType.DEBIT,
        amount: '100.5',
        status: MovementStatus.PENDING,
        balanceAfter: null,
        description: 'Compra',
        createdAt: '2026-05-15T10:00:00.000Z',
        processedAt: null,
      });
    });
  });

  describe('findOne', () => {
    it('returns a processed movement with balanceAfter and processedAt populated', async () => {
      prisma.movement.findUnique.mockResolvedValue({
        id: 'movement-uuid',
        accountId: 'account-uuid',
        amount: new Prisma.Decimal('200.00'),
        type: MovementType.DEBIT,
        description: 'Compra no mercado',
        status: MovementStatus.SUCCESS,
        balanceAfter: new Prisma.Decimal('150.00'),
        createdAt: new Date('2026-05-15T10:00:00.000Z'),
        processedAt: new Date('2026-05-15T10:00:01.000Z'),
      });

      const result = await service.findOne('movement-uuid');

      expect(prisma.movement.findUnique).toHaveBeenCalledWith({
        where: { id: 'movement-uuid' },
      });
      expect(result).toEqual({
        movementId: 'movement-uuid',
        accountId: 'account-uuid',
        type: MovementType.DEBIT,
        amount: '200',
        status: MovementStatus.SUCCESS,
        balanceAfter: '150',
        description: 'Compra no mercado',
        createdAt: '2026-05-15T10:00:00.000Z',
        processedAt: '2026-05-15T10:00:01.000Z',
      });
    });

    it('returns null balanceAfter and processedAt when movement is still pending', async () => {
      prisma.movement.findUnique.mockResolvedValue({
        id: 'movement-uuid',
        accountId: 'account-uuid',
        amount: new Prisma.Decimal('200.00'),
        type: MovementType.CREDIT,
        description: null,
        status: MovementStatus.PENDING,
        balanceAfter: null,
        createdAt: new Date('2026-05-15T10:00:00.000Z'),
        processedAt: null,
      });

      const result = await service.findOne('movement-uuid');

      expect(result.balanceAfter).toBeNull();
      expect(result.processedAt).toBeNull();
      expect(result.status).toBe(MovementStatus.PENDING);
    });

    it('throws NotFoundException when movement does not exist', async () => {
      prisma.movement.findUnique.mockResolvedValue(null);

      await expect(service.findOne('missing-uuid')).rejects.toThrow(NotFoundException);
    });
  });
});
