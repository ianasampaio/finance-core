import { Test, TestingModule } from '@nestjs/testing';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';

describe('AccountController', () => {
  let controller: AccountController;
  let service: {
    create: jest.Mock;
    getBalance: jest.Mock;
    findMovements: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      create: jest.fn(),
      getBalance: jest.fn(),
      findMovements: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AccountController],
      providers: [{ provide: AccountService, useValue: service }],
    }).compile();

    controller = module.get(AccountController);
  });

  it('delegates create to the service', async () => {
    const dto = {
      applicationId: '00000000-0000-0000-0000-000000000000',
      name: 'Alice',
      email: 'alice@example.com',
      document: '123',
    };
    service.create.mockResolvedValue({ accountId: 'a1' });

    await controller.create(dto);

    expect(service.create).toHaveBeenCalledWith(dto);
  });

  it('delegates getBalance to the service', async () => {
    service.getBalance.mockResolvedValue({ balance: '0' });

    await controller.getBalance('a1');

    expect(service.getBalance).toHaveBeenCalledWith('a1');
  });

  it('delegates findMovements to the service with pagination', async () => {
    service.findMovements.mockResolvedValue({ data: [], meta: {} });

    await controller.findMovements('a1', { page: 2, limit: 10 });

    expect(service.findMovements).toHaveBeenCalledWith('a1', { page: 2, limit: 10 });
  });
});
