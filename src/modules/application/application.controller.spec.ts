import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ApplicationController } from './application.controller';
import { ApplicationService } from './application.service';

describe('ApplicationController', () => {
  let controller: ApplicationController;
  let service: {
    create: jest.Mock;
    findOne: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      create: jest.fn(),
      findOne: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ApplicationController],
      providers: [{ provide: ApplicationService, useValue: service }],
    }).compile();

    controller = module.get(ApplicationController);
  });

  it('delegates create to the service', async () => {
    const dto = { name: 'Acme' };
    service.create.mockResolvedValue({ applicationId: 'app-1', name: 'Acme', createdAt: new Date() });

    await controller.create(dto);

    expect(service.create).toHaveBeenCalledWith(dto);
  });

  it('delegates findOne to the service', async () => {
    service.findOne.mockResolvedValue({ id: 'app-1', name: 'Acme' });

    await controller.findOne('app-1');

    expect(service.findOne).toHaveBeenCalledWith('app-1');
  });

  it('propagates NotFoundException from findOne', async () => {
    service.findOne.mockRejectedValue(new NotFoundException());

    await expect(controller.findOne('missing')).rejects.toThrow(NotFoundException);
  });
});
