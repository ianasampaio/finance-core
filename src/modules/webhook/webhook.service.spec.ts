import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'prisma/prisma.service';
import { WebhookService } from './webhook.service';

jest.mock('crypto', () => ({
  ...jest.requireActual<typeof import('crypto')>('crypto'),
  randomBytes: jest.fn(() => Buffer.from('a'.repeat(32))),
}));

describe('WebhookService', () => {
  let service: WebhookService;
  let prisma: {
    application: { findUnique: jest.Mock };
    webhook: { create: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      application: { findUnique: jest.fn() },
      webhook: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
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
    const dto = {
      applicationId: '00000000-0000-0000-0000-000000000001',
      url: 'https://example.com/hook',
    };

    it('creates and returns the webhook with a generated secret', async () => {
      prisma.application.findUnique.mockResolvedValue({ id: dto.applicationId });
      const now = new Date();
      prisma.webhook.create.mockResolvedValue({
        id: 'wh-1',
        applicationId: dto.applicationId,
        url: dto.url,
        active: true,
        createdAt: now,
      });

      const result = await service.create(dto);

      expect(prisma.webhook.create).toHaveBeenCalledWith({
        data: {
          applicationId: dto.applicationId,
          url: dto.url,
          secret: expect.any(String),
        },
        select: { id: true, applicationId: true, url: true, active: true, createdAt: true },
      });
      expect(result.secret).toBeDefined();
    });

    it('throws NotFoundException when application does not exist', async () => {
      prisma.application.findUnique.mockResolvedValue(null);

      await expect(service.create(dto)).rejects.toThrow(NotFoundException);
      expect(prisma.webhook.create).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('returns the webhook when found', async () => {
      const webhook = { id: 'wh-1', applicationId: 'app-1', url: 'https://example.com', active: true };
      prisma.webhook.findUnique.mockResolvedValue(webhook);

      const result = await service.findOne('wh-1');

      expect(result).toBe(webhook);
    });

    it('throws NotFoundException when webhook does not exist', async () => {
      prisma.webhook.findUnique.mockResolvedValue(null);

      await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('updates and returns the webhook with the new url', async () => {
      prisma.webhook.findUnique.mockResolvedValue({ id: 'wh-1' });
      const updated = { id: 'wh-1', applicationId: 'app-1', url: 'https://new.example.com', active: true, updatedAt: new Date() };
      prisma.webhook.update.mockResolvedValue(updated);

      const result = await service.update('wh-1', { url: 'https://new.example.com' });

      expect(prisma.webhook.update).toHaveBeenCalledWith({
        where: { id: 'wh-1' },
        data: { url: 'https://new.example.com' },
        select: { id: true, applicationId: true, url: true, active: true, updatedAt: true },
      });
      expect(result).toBe(updated);
    });

    it('throws NotFoundException when webhook does not exist', async () => {
      prisma.webhook.findUnique.mockResolvedValue(null);

      await expect(service.update('missing', { url: 'https://x.com' })).rejects.toThrow(NotFoundException);
      expect(prisma.webhook.update).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('deactivates the webhook', async () => {
      prisma.webhook.findUnique.mockResolvedValue({ id: 'wh-1' });
      prisma.webhook.update.mockResolvedValue({});

      await service.remove('wh-1');

      expect(prisma.webhook.update).toHaveBeenCalledWith({
        where: { id: 'wh-1' },
        data: { active: false },
      });
    });

    it('throws NotFoundException when webhook does not exist', async () => {
      prisma.webhook.findUnique.mockResolvedValue(null);

      await expect(service.remove('missing')).rejects.toThrow(NotFoundException);
      expect(prisma.webhook.update).not.toHaveBeenCalled();
    });
  });
});
