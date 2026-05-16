import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { createHmac, randomUUID } from 'crypto';
import { WebhookDeliveryStatus } from '@prisma/client';
import { PrismaService } from 'prisma/prisma.service';
import { MovementProcessedPayload } from 'src/shared/types/movement-events.types';
import { DomainEvent } from '../rabbitmq/rabbitmq.service';

type WebhookPayload = {
  webhookId: string;
  event: string;
  movementId: string;
  accountId: string;
  type: string;
  amount: string;
  status: string;
  balanceAfter: string;
  description: string | null;
  processedAt: string;
};

const RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000, 7_200_000, 86_400_000];
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;

@Injectable()
export class WebhookDispatcher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhookDispatcher.name);
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private isShuttingDown = false;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.recoverPendingRetries();
  }

  async onModuleDestroy() {
    this.isShuttingDown = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
  }

  async handleEvent(event: DomainEvent<MovementProcessedPayload>): Promise<void> {
    const movementId = event.aggregateId;
    const { accountId } = event.data;

    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: { applicationId: true },
    });

    if (!account) {
      this.logger.warn(`Account ${accountId} not found while dispatching webhook.`);
      return;
    }

    const webhooks = await this.prisma.webhook.findMany({
      where: { applicationId: account.applicationId, active: true },
    });

    if (webhooks.length === 0) return;

    await Promise.all(
      webhooks.map(async (webhook) => {
        const deliveryId = randomUUID();
        const payload = this.buildPayload(deliveryId, event);

        await this.prisma.webhookDelivery.create({
          data: { id: deliveryId, webhookId: webhook.id, movementId, payload },
        });

        await this.attemptDelivery(deliveryId, webhook.url, webhook.secret, payload);
      }),
    );
  }

  private buildPayload(
    deliveryId: string,
    event: DomainEvent<MovementProcessedPayload>,
  ): WebhookPayload {
    const { data } = event;
    return {
      webhookId: deliveryId,
      event: event.eventType,
      movementId: event.aggregateId,
      accountId: data.accountId,
      type: data.type,
      amount: data.amount,
      status: data.status,
      balanceAfter: data.balanceAfter,
      description: data.description,
      processedAt: data.processedAt,
    };
  }

  private async attemptDelivery(
    deliveryId: string,
    url: string,
    secret: string,
    payload: WebhookPayload,
  ): Promise<void> {
    const body = JSON.stringify(payload);
    const timestamp = new Date().toISOString();
    const signature = createHmac('sha256', secret).update(body).digest('hex');

    let responseStatus: number | null = null;
    let responseBody: string | null = null;
    let succeeded = false;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Id': deliveryId,
          'X-Timestamp': timestamp,
          'X-Signature': `sha256=${signature}`,
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });

      responseStatus = response.status;
      responseBody = await response.text().catch(() => null);
      succeeded = response.ok;
    } catch (err) {
      this.logger.warn(
        `Webhook ${deliveryId} network error: ${(err as Error).message}`,
      );
    }

    const updated = await this.prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        attempts: { increment: 1 },
        lastAttemptAt: new Date(),
        responseStatus,
        responseBody,
        status: succeeded
          ? WebhookDeliveryStatus.SUCCESS
          : WebhookDeliveryStatus.PENDING,
      },
    });

    if (succeeded) {
      this.logger.log(`Webhook delivery ${deliveryId} succeeded.`);
      return;
    }

    if (updated.attempts >= MAX_ATTEMPTS) {
      await this.prisma.webhookDelivery.update({
        where: { id: deliveryId },
        data: { status: WebhookDeliveryStatus.FAILED },
      });
      this.logger.error(
        `Webhook delivery ${deliveryId} failed permanently after ${MAX_ATTEMPTS} attempts.`,
      );
      return;
    }

    const delayMs = RETRY_DELAYS_MS[updated.attempts - 1];
    const nextAttemptAt = new Date(Date.now() + delayMs);

    await this.prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: { nextAttemptAt },
    });

    this.logger.warn(
      `Webhook delivery ${deliveryId} failed (attempt ${updated.attempts}/${MAX_ATTEMPTS}). ` +
        `Retrying in ${delayMs / 1000}s.`,
    );

    this.scheduleTimer(deliveryId, url, secret, payload, delayMs);
  }

  private scheduleTimer(
    deliveryId: string,
    url: string,
    secret: string,
    payload: WebhookPayload,
    delayMs: number,
  ): void {
    if (this.isShuttingDown) return;

    const timer = setTimeout(() => {
      this.timers.delete(deliveryId);
      void this.attemptDelivery(deliveryId, url, secret, payload);
    }, delayMs);

    this.timers.set(deliveryId, timer);
  }

  private async recoverPendingRetries(): Promise<void> {
    const pending = await this.prisma.webhookDelivery.findMany({
      where: { status: WebhookDeliveryStatus.PENDING, nextAttemptAt: { not: null } },
      include: { webhook: { select: { url: true, secret: true, active: true } } },
    });

    for (const delivery of pending) {
      if (!delivery.nextAttemptAt || !delivery.webhook.active) continue;
      const delayMs = Math.max(0, delivery.nextAttemptAt.getTime() - Date.now());
      this.scheduleTimer(
        delivery.id,
        delivery.webhook.url,
        delivery.webhook.secret,
        delivery.payload as WebhookPayload,
        delayMs,
      );
    }

    if (pending.length > 0) {
      this.logger.log(`Recovered ${pending.length} pending webhook deliveries.`);
    }
  }
}
