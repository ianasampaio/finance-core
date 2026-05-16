import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';

describe('WebhookController', () => {
  let controller: WebhookController;
  let service: {
    create: jest.Mock;
    findOne: jest.Mock;
    remove: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      create: jest.fn(),
      findOne: jest.fn(),
      remove: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WebhookController],
      providers: [{ provide: WebhookService, useValue: service }],
    }).compile();

    controller = module.get(WebhookController);
  });

  it('delegates create to the service', async () => {
    const dto = {
      applicationId: '00000000-0000-0000-0000-000000000001',
      url: 'https://example.com/hook',
    };
    service.create.mockResolvedValue({ id: 'wh-1', ...dto, secret: 'abc', active: true });

    await controller.create(dto);

    expect(service.create).toHaveBeenCalledWith(dto);
  });

  it('delegates findOne to the service', async () => {
    service.findOne.mockResolvedValue({ id: 'wh-1' });

    await controller.findOne('wh-1');

    expect(service.findOne).toHaveBeenCalledWith('wh-1');
  });

  it('delegates remove to the service', async () => {
    service.remove.mockResolvedValue(undefined);

    await controller.remove('wh-1');

    expect(service.remove).toHaveBeenCalledWith('wh-1');
  });

  it('propagates NotFoundException from findOne', async () => {
    service.findOne.mockRejectedValue(new NotFoundException());

    await expect(controller.findOne('missing')).rejects.toThrow(NotFoundException);
  });

  it('propagates NotFoundException from remove', async () => {
    service.remove.mockRejectedValue(new NotFoundException());

    await expect(controller.remove('missing')).rejects.toThrow(NotFoundException);
  });
});
