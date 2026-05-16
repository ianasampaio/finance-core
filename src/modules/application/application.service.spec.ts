import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'prisma/prisma.service';
import { ApplicationService } from './application.service';

describe('ApplicationService', () => {
  let service: ApplicationService;
  let prisma: {
    application: { create: jest.Mock; findUnique: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      application: { create: jest.fn(), findUnique: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApplicationService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(ApplicationService);
  });

  describe('create', () => {
    it('creates and returns the application', async () => {
      const now = new Date();
      prisma.application.create.mockResolvedValue({ id: 'app-1', name: 'Acme', createdAt: now });

      const result = await service.create({ name: 'Acme' });

      expect(prisma.application.create).toHaveBeenCalledWith({
        data: { name: 'Acme' },
      });
      expect(result).toEqual({ applicationId: 'app-1', name: 'Acme', createdAt: now });
    });
  });

  describe('findOne', () => {
    it('returns the application when found', async () => {
      const app = { id: 'app-1', name: 'Acme', createdAt: new Date() };
      prisma.application.findUnique.mockResolvedValue(app);

      const result = await service.findOne('app-1');

      expect(result).toBe(app);
    });

    it('throws NotFoundException when application does not exist', async () => {
      prisma.application.findUnique.mockResolvedValue(null);

      await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
    });
  });
});
