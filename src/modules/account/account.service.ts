import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Movement, Prisma } from '@prisma/client';
import { PrismaService } from 'prisma/prisma.service';
import { PaginationQueryDto } from 'src/shared/dto/pagination-query.dto';
import { UUIDGenerator } from 'src/shared/uuid-generator';
import { CreateAccountDto } from './dto/create-account.dto';

@Injectable()
export class AccountService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createAccountDto: CreateAccountDto) {
    const application = await this.prisma.application.findUnique({
      where: { id: createAccountDto.applicationId },
      select: { id: true },
    });

    if (!application) {
      throw new NotFoundException('Application not found.');
    }

    const existingAccount = await this.prisma.account.findUnique({
      where: { document: createAccountDto.document },
    });

    if (existingAccount) {
      throw new ConflictException('An account with this document already exists.');
    }

    const account = await this.prisma.account.create({
      data: {
        id: UUIDGenerator.generate(),
        applicationId: createAccountDto.applicationId,
        name: createAccountDto.name,
        email: createAccountDto.email,
        document: createAccountDto.document,
        balance: 0,
        creditLimit: 1000,
      },
    });

    return { accountId: account.id };
  }

  async getBalance(accountId: string) {
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
    });

    if (!account) {
      throw new NotFoundException('Account not found.');
    }

    const balance = new Prisma.Decimal(account.balance);
    const creditLimit = new Prisma.Decimal(account.creditLimit);
    const availableLimit = creditLimit.plus(balance);

    return { balance, creditLimit, availableLimit };
  }

  async findMovements(accountId: string, { page, limit }: PaginationQueryDto) {
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: { id: true },
    });

    if (!account) {
      throw new NotFoundException('Account not found.');
    }

    const skip = (page - 1) * limit;

    const [total, movements] = await this.prisma.$transaction([
      this.prisma.movement.count({ where: { accountId } }),
      this.prisma.movement.findMany({
        where: { accountId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return {
      data: movements.map((movement) => this.toMovementResponse(movement)),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  private toMovementResponse(movement: Movement) {
    return {
      movementId: movement.id,
      accountId: movement.accountId,
      type: movement.type,
      amount: movement.amount.toString(),
      status: movement.status,
      balanceAfter: movement.balanceAfter?.toString() ?? null,
      description: movement.description,
      createdAt: movement.createdAt.toISOString(),
      processedAt: movement.processedAt?.toISOString() ?? null,
    };
  }
}
