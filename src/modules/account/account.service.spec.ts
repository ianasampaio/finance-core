import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { MovementStatus, MovementType, Prisma } from '@prisma/client';
import { PrismaService } from 'prisma/prisma.service';
import { AccountService } from './account.service';

jest.mock('src/shared/uuid-generator', () => ({
  UUIDGenerator: { generate: jest.fn(() => 'account-uuid') },
}));

describe('AccountService', () => {
  let service: AccountService;
  let prisma: {
    application: { findUnique: jest.Mock };
    account: { findUnique: jest.Mock; create: jest.Mock };
    movement: { count: jest.Mock; findMany: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      application: { findUnique: jest.fn() },
      account: { findUnique: jest.fn(), create: jest.fn() },
      movement: { count: jest.fn(), findMany: jest.fn() },
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccountService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(AccountService);
  });

  describe('create', () => {
    const dto = {
      applicationId: 'app-uuid',
      name: 'Alice',
      email: 'alice@example.com',
      document: '12345678900',
    };

    it('creates the account with default balance and credit limit', async () => {
      prisma.application.findUnique.mockResolvedValue({ id: 'app-uuid' });
      prisma.account.findUnique.mockResolvedValue(null);
      prisma.account.create.mockResolvedValue({ id: 'account-uuid' });

      const result = await service.create(dto);

      expect(prisma.account.create).toHaveBeenCalledWith({
        data: {
          id: 'account-uuid',
          applicationId: 'app-uuid',
          name: 'Alice',
          email: 'alice@example.com',
          document: '12345678900',
          balance: 0,
          creditLimit: 1000,
        },
      });
      expect(result).toEqual({ accountId: 'account-uuid' });
    });

    it('throws NotFoundException when application does not exist', async () => {
      prisma.application.findUnique.mockResolvedValue(null);

      await expect(service.create(dto)).rejects.toThrow(NotFoundException);
      expect(prisma.account.create).not.toHaveBeenCalled();
    });

    it('throws ConflictException when document already exists', async () => {
      prisma.application.findUnique.mockResolvedValue({ id: 'app-uuid' });
      prisma.account.findUnique.mockResolvedValue({ id: 'existing' });

      await expect(service.create(dto)).rejects.toThrow(ConflictException);
      expect(prisma.account.create).not.toHaveBeenCalled();
    });
  });

  describe('getBalance', () => {
    it('returns balance, creditLimit and availableLimit', async () => {
      prisma.account.findUnique.mockResolvedValue({
        balance: new Prisma.Decimal('100'),
        creditLimit: new Prisma.Decimal('500'),
      });

      const result = await service.getBalance('account-uuid');

      expect(result.balance.toString()).toBe('100');
      expect(result.creditLimit.toString()).toBe('500');
      expect(result.availableLimit.toString()).toBe('600');
    });

    it('throws NotFoundException when account does not exist', async () => {
      prisma.account.findUnique.mockResolvedValue(null);

      await expect(service.getBalance('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findMovements', () => {
    const movementRow = {
      id: 'm1',
      accountId: 'account-uuid',
      type: MovementType.DEBIT,
      amount: new Prisma.Decimal('50'),
      description: 'desc',
      status: MovementStatus.SUCCESS,
      balanceAfter: new Prisma.Decimal('150'),
      createdAt: new Date('2026-05-15T10:00:00.000Z'),
      processedAt: new Date('2026-05-15T10:00:01.000Z'),
    };

    it('returns paginated movements ordered by createdAt desc', async () => {
      prisma.account.findUnique.mockResolvedValue({ id: 'account-uuid' });
      prisma.movement.count.mockResolvedValue(42);
      prisma.movement.findMany.mockResolvedValue([movementRow]);

      const result = await service.findMovements('account-uuid', { page: 2, limit: 20 });

      expect(prisma.movement.findMany).toHaveBeenCalledWith({
        where: { accountId: 'account-uuid' },
        orderBy: { createdAt: 'desc' },
        skip: 20,
        take: 20,
      });
      expect(result).toEqual({
        data: [
          {
            movementId: 'm1',
            accountId: 'account-uuid',
            type: MovementType.DEBIT,
            amount: '50',
            status: MovementStatus.SUCCESS,
            balanceAfter: '150',
            description: 'desc',
            createdAt: '2026-05-15T10:00:00.000Z',
            processedAt: '2026-05-15T10:00:01.000Z',
          },
        ],
        meta: { page: 2, limit: 20, total: 42, totalPages: 3 },
      });
    });

    it('throws NotFoundException when account does not exist', async () => {
      prisma.account.findUnique.mockResolvedValue(null);

      await expect(
        service.findMovements('missing', { page: 1, limit: 20 }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.movement.findMany).not.toHaveBeenCalled();
    });

    it('handles empty result set', async () => {
      prisma.account.findUnique.mockResolvedValue({ id: 'account-uuid' });
      prisma.movement.count.mockResolvedValue(0);
      prisma.movement.findMany.mockResolvedValue([]);

      const result = await service.findMovements('account-uuid', { page: 1, limit: 20 });

      expect(result.data).toEqual([]);
      expect(result.meta).toEqual({ page: 1, limit: 20, total: 0, totalPages: 0 });
    });
  });
});
