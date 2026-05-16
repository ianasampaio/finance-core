import { Test, TestingModule } from '@nestjs/testing';
import { MovementStatus, MovementType, WebhookDeliveryStatus } from '@prisma/client';
import { PrismaService } from 'prisma/prisma.service';
import { MovementProcessedPayload } from 'src/shared/types/movement-events.types';
import { MOVEMENT_EVENTS } from '../rabbitmq/rabbitmq.constants';
import { DomainEvent } from '../rabbitmq/rabbitmq.service';
import { WebhookDispatcher } from './webhook.dispatcher';

jest.mock('crypto', () => ({
  ...jest.requireActual<typeof import('crypto')>('crypto'),
  randomUUID: jest.fn(() => 'delivery-uuid'),
}));

const buildEvent = (
  overrides: Partial<MovementProcessedPayload> = {},
): DomainEvent<MovementProcessedPayload> => ({
  eventId: 'event-id',
  eventType: MOVEMENT_EVENTS.CONFIRMED,
  version: 1,
  aggregateId: 'movement-id',
  occurredAt: '2026-05-16T12:00:00.000Z',
  data: {
    movementId: 'movement-id',
    accountId: 'account-id',
    type: MovementType.DEBIT,
    amount: '100',
    status: MovementStatus.SUCCESS,
    balanceAfter: '900',
    description: null,
    createdAt: '2026-05-16T11:59:59.000Z',
    processedAt: '2026-05-16T12:00:00.000Z',
    ...overrides,
  },
});

const makeResponse = (ok: boolean, status = ok ? 200 : 500, body = '') => ({
  ok,
  status,
  text: jest.fn().mockResolvedValue(body),
});

describe('WebhookDispatcher', () => {
  let dispatcher: WebhookDispatcher;
  let prisma: {
    account: { findUnique: jest.Mock };
    webhook: { findMany: jest.Mock };
    webhookDelivery: { create: jest.Mock; findMany: jest.Mock; update: jest.Mock };
  };
  let fetchSpy: jest.SpyInstance;

  beforeEach(async () => {
    jest.useFakeTimers();

    prisma = {
      account: { findUnique: jest.fn() },
      webhook: { findMany: jest.fn() },
      webhookDelivery: {
        create: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
      },
    };

    fetchSpy = jest.spyOn(global, 'fetch');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookDispatcher,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    dispatcher = module.get(WebhookDispatcher);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('handleEvent', () => {
    it('does nothing when account is not found', async () => {
      prisma.account.findUnique.mockResolvedValue(null);

      await dispatcher.handleEvent(buildEvent());

      expect(prisma.webhook.findMany).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('does nothing when there are no active webhooks', async () => {
      prisma.account.findUnique.mockResolvedValue({ applicationId: 'app-1' });
      prisma.webhook.findMany.mockResolvedValue([]);

      await dispatcher.handleEvent(buildEvent());

      expect(prisma.webhookDelivery.create).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('creates a delivery record and dispatches for each active webhook', async () => {
      prisma.account.findUnique.mockResolvedValue({ applicationId: 'app-1' });
      prisma.webhook.findMany.mockResolvedValue([
        { id: 'wh-1', url: 'https://a.example.com/hook', secret: 'secret-a' },
        { id: 'wh-2', url: 'https://b.example.com/hook', secret: 'secret-b' },
      ]);
      prisma.webhookDelivery.update.mockResolvedValue({ attempts: 1 });
      fetchSpy.mockResolvedValue(makeResponse(true));

      await dispatcher.handleEvent(buildEvent());

      expect(prisma.webhookDelivery.create).toHaveBeenCalledTimes(2);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('sends POST with HMAC-SHA256 signature and required headers', async () => {
      prisma.account.findUnique.mockResolvedValue({ applicationId: 'app-1' });
      prisma.webhook.findMany.mockResolvedValue([
        { id: 'wh-1', url: 'https://example.com/hook', secret: 'mysecret' },
      ]);
      prisma.webhookDelivery.update.mockResolvedValue({ attempts: 1 });
      fetchSpy.mockResolvedValue(makeResponse(true));

      await dispatcher.handleEvent(buildEvent());

      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
      expect(url).toBe('https://example.com/hook');
      expect(init.method).toBe('POST');
      expect(init.headers['Content-Type']).toBe('application/json');
      expect(init.headers['X-Webhook-Id']).toBe('delivery-uuid');
      expect(init.headers['X-Timestamp']).toBeDefined();
      expect(init.headers['X-Signature']).toMatch(/^sha256=[a-f0-9]{64}$/);
    });
  });

  describe('delivery outcome', () => {
    beforeEach(() => {
      prisma.account.findUnique.mockResolvedValue({ applicationId: 'app-1' });
      prisma.webhook.findMany.mockResolvedValue([
        { id: 'wh-1', url: 'https://example.com/hook', secret: 'secret' },
      ]);
    });

    it('marks delivery as SUCCESS when fetch returns 2xx', async () => {
      fetchSpy.mockResolvedValue(makeResponse(true, 200, 'ok'));
      prisma.webhookDelivery.update.mockResolvedValue({ attempts: 1 });

      await dispatcher.handleEvent(buildEvent());

      expect(prisma.webhookDelivery.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: WebhookDeliveryStatus.SUCCESS,
            responseStatus: 200,
            responseBody: 'ok',
          }),
        }),
      );
      expect(jest.getTimerCount()).toBe(0);
    });

    it('keeps delivery as PENDING and schedules retry on non-2xx response', async () => {
      fetchSpy.mockResolvedValue(makeResponse(false, 500, 'error'));
      prisma.webhookDelivery.update
        .mockResolvedValueOnce({ attempts: 1 })
        .mockResolvedValueOnce({});

      await dispatcher.handleEvent(buildEvent());

      expect(prisma.webhookDelivery.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: WebhookDeliveryStatus.PENDING,
            responseStatus: 500,
          }),
        }),
      );
      expect(prisma.webhookDelivery.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ nextAttemptAt: expect.any(Date) }),
        }),
      );
      expect(jest.getTimerCount()).toBe(1);
    });

    it('marks delivery as FAILED permanently when MAX_ATTEMPTS is reached', async () => {
      fetchSpy.mockResolvedValue(makeResponse(false, 503));
      prisma.webhookDelivery.update
        .mockResolvedValueOnce({ attempts: 6 }) // MAX_ATTEMPTS = 6
        .mockResolvedValueOnce({});

      await dispatcher.handleEvent(buildEvent());

      const secondCall = prisma.webhookDelivery.update.mock.calls[1][0];
      expect(secondCall).toMatchObject({
        data: { status: WebhookDeliveryStatus.FAILED },
      });
      expect(jest.getTimerCount()).toBe(0);
    });

    it('treats network errors as failures with null responseStatus', async () => {
      fetchSpy.mockRejectedValue(new Error('ECONNREFUSED'));
      prisma.webhookDelivery.update
        .mockResolvedValueOnce({ attempts: 1 })
        .mockResolvedValueOnce({});

      await dispatcher.handleEvent(buildEvent());

      expect(prisma.webhookDelivery.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: WebhookDeliveryStatus.PENDING,
            responseStatus: null,
            responseBody: null,
          }),
        }),
      );
    });
  });

  describe('retry timer', () => {
    it('fires after RETRY_DELAYS_MS[0] (60s) and re-attempts delivery', async () => {
      prisma.account.findUnique.mockResolvedValue({ applicationId: 'app-1' });
      prisma.webhook.findMany.mockResolvedValue([
        { id: 'wh-1', url: 'https://example.com/hook', secret: 'secret' },
      ]);
      fetchSpy
        .mockResolvedValueOnce(makeResponse(false, 500))
        .mockResolvedValueOnce(makeResponse(true, 200));
      prisma.webhookDelivery.update
        .mockResolvedValueOnce({ attempts: 1 }) // first attempt: PENDING
        .mockResolvedValueOnce({})              // nextAttemptAt update
        .mockResolvedValueOnce({ attempts: 2 }); // retry attempt: SUCCESS

      await dispatcher.handleEvent(buildEvent());
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(60_000);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('recoverPendingRetries (via onModuleInit)', () => {
    it('re-schedules timers for pending deliveries with a future nextAttemptAt', async () => {
      prisma.webhookDelivery.findMany.mockResolvedValue([
        {
          id: 'delivery-1',
          nextAttemptAt: new Date(Date.now() + 30_000),
          payload: {},
          webhook: { url: 'https://example.com/hook', secret: 'secret', active: true },
        },
      ]);

      const module = await Test.createTestingModule({
        providers: [
          WebhookDispatcher,
          { provide: PrismaService, useValue: prisma },
        ],
      }).compile();
      await module.init();

      expect(jest.getTimerCount()).toBe(1);
      await module.close();
    });

    it('schedules timer with delay=0 for overdue deliveries', async () => {
      prisma.webhookDelivery.findMany.mockResolvedValue([
        {
          id: 'delivery-2',
          nextAttemptAt: new Date(Date.now() - 10_000), // already overdue
          payload: {},
          webhook: { url: 'https://example.com/hook', secret: 'secret', active: true },
        },
      ]);

      const module = await Test.createTestingModule({
        providers: [
          WebhookDispatcher,
          { provide: PrismaService, useValue: prisma },
        ],
      }).compile();
      await module.init();

      expect(jest.getTimerCount()).toBe(1);
      await module.close();
    });

    it('skips pending deliveries whose webhook is inactive', async () => {
      prisma.webhookDelivery.findMany.mockResolvedValue([
        {
          id: 'delivery-3',
          nextAttemptAt: new Date(Date.now() + 30_000),
          payload: {},
          webhook: { url: 'https://example.com/hook', secret: 'secret', active: false },
        },
      ]);

      const module = await Test.createTestingModule({
        providers: [
          WebhookDispatcher,
          { provide: PrismaService, useValue: prisma },
        ],
      }).compile();
      await module.init();

      expect(jest.getTimerCount()).toBe(0);
      await module.close();
    });
  });

  describe('onModuleDestroy', () => {
    it('cancels all pending retry timers', async () => {
      prisma.account.findUnique.mockResolvedValue({ applicationId: 'app-1' });
      prisma.webhook.findMany.mockResolvedValue([
        { id: 'wh-1', url: 'https://example.com/hook', secret: 'secret' },
      ]);
      fetchSpy.mockResolvedValue(makeResponse(false, 500));
      prisma.webhookDelivery.update
        .mockResolvedValueOnce({ attempts: 1 })
        .mockResolvedValueOnce({});

      await dispatcher.handleEvent(buildEvent());
      expect(jest.getTimerCount()).toBe(1);

      await dispatcher.onModuleDestroy();

      expect(jest.getTimerCount()).toBe(0);
    });

    it('does not schedule new timers after shutdown', async () => {
      await dispatcher.onModuleDestroy();

      prisma.account.findUnique.mockResolvedValue({ applicationId: 'app-1' });
      prisma.webhook.findMany.mockResolvedValue([
        { id: 'wh-1', url: 'https://example.com/hook', secret: 'secret' },
      ]);
      fetchSpy.mockResolvedValue(makeResponse(false, 500));
      prisma.webhookDelivery.update
        .mockResolvedValueOnce({ attempts: 1 })
        .mockResolvedValueOnce({});

      await dispatcher.handleEvent(buildEvent());

      expect(jest.getTimerCount()).toBe(0);
    });
  });
});
