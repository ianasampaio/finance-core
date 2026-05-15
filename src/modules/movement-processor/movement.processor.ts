import { Injectable, Logger } from '@nestjs/common';
import { MovementStatus, MovementType } from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from 'prisma/prisma.service';
import { 
  InvalidMovementAmountError, 
  MovementNotFoundError, 
  UnknownMovementTypeError 
} from 'src/shared/errors/movement.errors';
import { 
  MovementCreatedData, 
  MovementProcessedPayload 
} from 'src/shared/types/movement-events.types';
import { MOVEMENT_EVENTS } from '../rabbitmq/rabbitmq.constants';
import { DomainEvent, RabbitmqService } from '../rabbitmq/rabbitmq.service';

@Injectable()
export class MovementProcessor {
  private readonly logger = new Logger(MovementProcessor.name);

  constructor(
    private readonly rabbitmq: RabbitmqService,
    private readonly prisma: PrismaService,
  ) {}

  async process(event: DomainEvent<unknown>): Promise<void> {
    switch (event.eventType) {
      case MOVEMENT_EVENTS.CREATED: {
        const payload = await this.handleMovementCreated(
          event as DomainEvent<MovementCreatedData>,
        );
        if (payload) {
          const eventType =
            payload.status === MovementStatus.SUCCESS
              ? MOVEMENT_EVENTS.CONFIRMED
              : MOVEMENT_EVENTS.FAILED;
          await this.rabbitmq.publishEvent(eventType, payload.movementId, payload);
        }
        break;
      }
      default:
        return;
    }
  }

  private async handleMovementCreated(
    event: DomainEvent<MovementCreatedData>,
  ): Promise<MovementProcessedPayload | null> {
    const movementId = event.aggregateId;
    const { 
      accountId,
      type,
      amount: amountStr,
      description,
      createdAt
    } = event.data;

    const amount = new Decimal(amountStr);

    if (amount.isNaN() || amount.lte(0)) {
      throw new InvalidMovementAmountError(movementId, amountStr);
    }

    const processedAt = new Date();

    return this.prisma
      .$transaction(async (tx) => {
        const movement = await tx.movement.findUnique({
          where: { id: movementId, accountId },
        });

        if (!movement) {
          throw new MovementNotFoundError(movementId, accountId);
        }

        if (movement.status !== MovementStatus.PENDING) {
          this.logger.warn(
            `Movement ${movementId} already processed (${movement.status}). Skipping.`,
          );
          return null;
        }

        await tx.$executeRaw`SELECT id FROM "Account" WHERE id = ${accountId} FOR UPDATE`;

        const account = await tx.account.findUniqueOrThrow({
          where: { id: accountId },
        });

        const balance = new Decimal(account.balance.toString());
        const creditLimit = new Decimal(account.creditLimit.toString());
        const { newBalance, rejected } = this.applyMovementToBalance(
          movementId,
          type,
          amount,
          balance,
          creditLimit,
        );

        const newStatus = rejected ? MovementStatus.FAILED : MovementStatus.SUCCESS;

        if (!rejected) {
          await tx.account.update({
            where: { id: accountId },
            data: { balance: newBalance.toFixed() },
          });
        }

        await tx.movement.update({
          where: { id: movementId },
          data: { status: newStatus, processedAt },
        });

        return {
          movementId,
          accountId,
          type,
          amount: amount.toFixed(),
          status: newStatus,
          balanceAfter: newBalance.toFixed(),
          description: description ?? null,
          createdAt,
          processedAt: processedAt.toISOString(),
        } satisfies MovementProcessedPayload;
      })
      .catch((err: unknown) => {
        this.logger.error(
          `Failed to process movement ${movementId} for account ${accountId}`,
          err,
        );
        throw err;
      });
  }

  private applyMovementToBalance(
    movementId: string,
    type: MovementType,
    amount: Decimal,
    balance: Decimal,
    creditLimit: Decimal,
  ): { newBalance: Decimal; rejected: boolean } {
    switch (type) {
      case MovementType.DEBIT: {
        const availableLimit = balance.add(creditLimit);
        const rejected = amount.gt(availableLimit);
        return { newBalance: rejected ? balance : balance.sub(amount), rejected };
      }
      case MovementType.CREDIT:
        return { newBalance: balance.add(amount), rejected: false };
      default: {
        const _exhaustive: never = type;
        throw new UnknownMovementTypeError(movementId, _exhaustive);
      }
    }
  }
}
