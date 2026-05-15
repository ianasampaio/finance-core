import { Test, TestingModule } from '@nestjs/testing';
import { MovementType } from '@prisma/client';
import { MovementController } from './movement.controller';
import { MovementService } from './movement.service';

describe('MovementController', () => {
  let controller: MovementController;
  let service: { create: jest.Mock; findOne: jest.Mock };

  beforeEach(async () => {
    service = { create: jest.fn(), findOne: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MovementController],
      providers: [{ provide: MovementService, useValue: service }],
    }).compile();

    controller = module.get(MovementController);
  });

  it('delegates create to the service', async () => {
    const dto = {
      accountId: 'account-uuid',
      amount: 100,
      type: MovementType.DEBIT,
      description: 'test',
    };
    service.create.mockResolvedValue({ movementId: 'mov-id' });

    const result = await controller.create(dto);

    expect(service.create).toHaveBeenCalledWith(dto);
    expect(result).toEqual({ movementId: 'mov-id' });
  });

  it('delegates findOne to the service', async () => {
    service.findOne.mockResolvedValue({ movementId: 'mov-id' });

    const result = await controller.findOne('mov-id');

    expect(service.findOne).toHaveBeenCalledWith('mov-id');
    expect(result).toEqual({ movementId: 'mov-id' });
  });
});
