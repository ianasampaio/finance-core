import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';

const ACCOUNT_ID = '00000000-0000-0000-0000-000000000001';

describe('WebhookController', () => {
  let controller: WebhookController;
  let service: {
    create: jest.Mock;
    findOne: jest.Mock;
    update: jest.Mock;
    remove: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      create: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WebhookController],
      providers: [{ provide: WebhookService, useValue: service }],
    }).compile();

    controller = module.get(WebhookController);
  });

  it('delegates create to the service with accountId from route', async () => {
    const dto = { url: 'https://example.com/hook' };
    service.create.mockResolvedValue({ id: 'wh-1', accountId: ACCOUNT_ID, url: dto.url });

    await controller.create(ACCOUNT_ID, dto);

    expect(service.create).toHaveBeenCalledWith(ACCOUNT_ID, dto);
  });

  it('delegates findOne to the service with accountId and id', async () => {
    service.findOne.mockResolvedValue({ id: 'wh-1', accountId: ACCOUNT_ID });

    await controller.findOne(ACCOUNT_ID, 'wh-1');

    expect(service.findOne).toHaveBeenCalledWith(ACCOUNT_ID, 'wh-1');
  });

  it('delegates update to the service with accountId and id', async () => {
    const dto = { url: 'https://new.example.com/hook' };
    service.update.mockResolvedValue({ id: 'wh-1', url: dto.url });

    await controller.update(ACCOUNT_ID, 'wh-1', dto);

    expect(service.update).toHaveBeenCalledWith(ACCOUNT_ID, 'wh-1', dto);
  });

  it('delegates remove to the service with accountId and id', async () => {
    service.remove.mockResolvedValue(undefined);

    await controller.remove(ACCOUNT_ID, 'wh-1');

    expect(service.remove).toHaveBeenCalledWith(ACCOUNT_ID, 'wh-1');
  });

  it('propagates NotFoundException from findOne', async () => {
    service.findOne.mockRejectedValue(new NotFoundException());

    await expect(controller.findOne(ACCOUNT_ID, 'missing')).rejects.toThrow(NotFoundException);
  });

  it('propagates NotFoundException from update when webhook belongs to another account', async () => {
    service.update.mockRejectedValue(new NotFoundException());

    await expect(controller.update(ACCOUNT_ID, 'wh-1', { url: 'https://x.com' })).rejects.toThrow(NotFoundException);
  });

  it('propagates NotFoundException from remove when webhook belongs to another account', async () => {
    service.remove.mockRejectedValue(new NotFoundException());

    await expect(controller.remove(ACCOUNT_ID, 'missing')).rejects.toThrow(NotFoundException);
  });
});
