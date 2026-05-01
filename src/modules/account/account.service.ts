import { Injectable } from '@nestjs/common';
import { CreateAccountDto } from './dto/create-account.dto';
import { PrismaService } from 'prisma/prisma.service';
import { UUIDGenerator } from 'src/shared/uuid-generator';
import { Prisma } from '@prisma/client';

@Injectable()
export class AccountService {
  constructor(private prisma: PrismaService) {}

  async create(createAccountDto: CreateAccountDto) {
    const existingAccount = await this.prisma.account.findUnique({
      where: {
        document: createAccountDto.document,
      },
    });

    if (existingAccount) {
      throw new Error('An account with this document already exists.');
    }

    const creditLimit = 1000.00;
    const balance = 0.00;

    const account = await this.prisma.account.create({
      data: {
        id: UUIDGenerator.generate(),
        name: createAccountDto.name,
        email: createAccountDto.email,
        document: createAccountDto.document,
        balance: balance,
        creditLimit: creditLimit,
      }
     });

    return {
      accountId: account.id,
    };
  }

  async getBalance(accountId: string) {
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
    });

    if (!account) {
      throw new Error('Account not found.');
    }

    const balance = new Prisma.Decimal(account.balance);
    const creditLimit = new Prisma.Decimal(account.creditLimit);

    const availableLimit = creditLimit.plus(balance);

    return {
      balance,
      creditLimit,
      availableLimit,
    };
  }
}
