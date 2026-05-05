import { Injectable } from '@nestjs/common';
import { MovementStatus, Prisma } from '@prisma/client';
import { PrismaService } from 'prisma/prisma.service';
import { UUIDGenerator } from 'src/shared/uuid-generator';
import { RabbitmqService } from '../rabbitmq/rabbitmq.service';
import { CreateMovementDto } from './dto/create-movement.dto';
import { MOVEMENT_EVENTS } from '../rabbitmq/rabbitmq.constants';
import { MovementCreatedData } from 'src/shared/types/movement-events.types';

@Injectable()
export class MovementService {
  constructor(
    private readonly rabbitmq: RabbitmqService,
    private readonly prisma: PrismaService,
  ) {}

  async create(createMovementDto: CreateMovementDto) {
    const { accountId, amount, type, description } = createMovementDto;

    const movement = await this.prisma.movement.create({
      data: {
        id: UUIDGenerator.generate(),
        accountId,
        amount: new Prisma.Decimal(amount),
        type,
        description,
        status: MovementStatus.PENDING,
      },
    });

    await this.rabbitmq.publishEvent(
      MOVEMENT_EVENTS.CREATED,
      movement.id,
      {
        accountId: movement.accountId,
        type: movement.type,
        amount: movement.amount.toString(),
        status: movement.status,
        description: movement.description,
        createdAt: movement.createdAt.toISOString(),
      } satisfies MovementCreatedData,
    );

    return {
      movementId: movement.id,
      accountId: movement.accountId,
      type: movement.type,
      amount: movement.amount.toString(),
      status: movement.status,
      description: movement.description,
      createdAt: movement.createdAt,
    };
  }

  findAll() {
    return `This action returns all movement`;
  }

  findOne(id: string) {
    return `This action returns a #${id} movement`;
  }
}
