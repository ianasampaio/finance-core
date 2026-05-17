import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'prisma/prisma.service';
import { WebhookService } from './webhook.service';

const ACCOUNT_ID = '00000000-0000-0000-0000-000000000001';
const OTHER_ACCOUNT_ID = '00000000-0000-0000-0000-000000000099';

describe('WebhookService', () => {
  let service: WebhookService;
  let prisma: {
    account: { findUnique: jest.Mock };
    webhook: { create: jest.Mock; findFirst: jest.Mock; update: jest.Mock; delete: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      account: { findUnique: jest.fn() },
      webhook: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn(), delete: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(WebhookService);
  });

  describe('create', () => {
    const dto = { url: 'https://example.com/hook' };

    it('creates and returns the webhook without headers', async () => {
      prisma.account.findUnique.mockResolvedValue({ id: ACCOUNT_ID });
      prisma.webhook.create.mockResolvedValue({
        id: 'wh-1', accountId: ACCOUNT_ID, url: dto.url, headers: null, createdAt: new Date(),
      });

      const result = await service.create(ACCOUNT_ID, dto);

      expect(prisma.webhook.create).toHaveBeenCalledWith({
        data: { accountId: ACCOUNT_ID, url: dto.url, headers: undefined },
        select: expect.any(Object),
      });
      expect(result.accountId).toBe(ACCOUNT_ID);
    });

    it('creates the webhook with custom headers', async () => {
      const headers = { Authorization: 'Bearer token', 'X-Api-Key': 'key' };
      prisma.account.findUnique.mockResolvedValue({ id: ACCOUNT_ID });
      prisma.webhook.create.mockResolvedValue({
        id: 'wh-1', accountId: ACCOUNT_ID, url: dto.url, headers, createdAt: new Date(),
      });

      const result = await service.create(ACCOUNT_ID, { ...dto, headers });

      expect(result.headers).toEqual(headers);
    });

    it('throws NotFoundException when account does not exist', async () => {
      prisma.account.findUnique.mockResolvedValue(null);

      await expect(service.create(ACCOUNT_ID, dto)).rejects.toThrow(NotFoundException);
      expect(prisma.webhook.create).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('returns the webhook when id and accountId match', async () => {
      const webhook = { id: 'wh-1', accountId: ACCOUNT_ID, url: 'https://example.com', headers: null };
      prisma.webhook.findFirst.mockResolvedValue(webhook);

      const result = await service.findOne(ACCOUNT_ID, 'wh-1');

      expect(prisma.webhook.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'wh-1', accountId: ACCOUNT_ID } }),
      );
      expect(result).toBe(webhook);
    });

    it('throws NotFoundException when webhook does not exist', async () => {
      prisma.webhook.findFirst.mockResolvedValue(null);

      await expect(service.findOne(ACCOUNT_ID, 'missing')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when webhook belongs to a different account', async () => {
      prisma.webhook.findFirst.mockResolvedValue(null);

      await expect(service.findOne(OTHER_ACCOUNT_ID, 'wh-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('throws BadRequestException when neither url nor headers are provided', async () => {
      await expect(service.update(ACCOUNT_ID, 'wh-1', {})).rejects.toThrow(BadRequestException);
      expect(prisma.webhook.findFirst).not.toHaveBeenCalled();
    });

    it('updates only url when provided', async () => {
      prisma.webhook.findFirst.mockResolvedValue({ id: 'wh-1', accountId: ACCOUNT_ID });
      prisma.webhook.update.mockResolvedValue({ id: 'wh-1', url: 'https://new.example.com' });

      await service.update(ACCOUNT_ID, 'wh-1', { url: 'https://new.example.com' });

      expect(prisma.webhook.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { url: 'https://new.example.com' } }),
      );
    });

    it('updates only headers when provided', async () => {
      const headers = { Authorization: 'Bearer token' };
      prisma.webhook.findFirst.mockResolvedValue({ id: 'wh-1', accountId: ACCOUNT_ID });
      prisma.webhook.update.mockResolvedValue({});

      await service.update(ACCOUNT_ID, 'wh-1', { headers });

      expect(prisma.webhook.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { headers } }),
      );
    });

    it('updates both url and headers when both are provided', async () => {
      const headers = { Authorization: 'Bearer new' };
      prisma.webhook.findFirst.mockResolvedValue({ id: 'wh-1', accountId: ACCOUNT_ID });
      prisma.webhook.update.mockResolvedValue({});

      await service.update(ACCOUNT_ID, 'wh-1', { url: 'https://example.com', headers });

      expect(prisma.webhook.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { url: 'https://example.com', headers } }),
      );
    });

    it('throws NotFoundException when webhook does not exist or belongs to another account', async () => {
      prisma.webhook.findFirst.mockResolvedValue(null);

      await expect(service.update(OTHER_ACCOUNT_ID, 'wh-1', { url: 'https://x.com' })).rejects.toThrow(NotFoundException);
      expect(prisma.webhook.update).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('hard deletes the webhook', async () => {
      prisma.webhook.findFirst.mockResolvedValue({ id: 'wh-1', accountId: ACCOUNT_ID });
      prisma.webhook.delete.mockResolvedValue({});

      await service.remove(ACCOUNT_ID, 'wh-1');

      expect(prisma.webhook.delete).toHaveBeenCalledWith({ where: { id: 'wh-1' } });
    });

    it('throws NotFoundException when webhook does not exist or belongs to another account', async () => {
      prisma.webhook.findFirst.mockResolvedValue(null);

      await expect(service.remove(OTHER_ACCOUNT_ID, 'wh-1')).rejects.toThrow(NotFoundException);
      expect(prisma.webhook.delete).not.toHaveBeenCalled();
    });
  });
});
