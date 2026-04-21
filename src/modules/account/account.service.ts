import { Injectable } from '@nestjs/common';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { PrismaService } from 'prisma/prisma.service';
import { UUIDGenerator } from 'src/shared/uuid-generator';

@Injectable()
export class AccountService {
  constructor(private prisma: PrismaService) {}

  create(createAccountDto: CreateAccountDto) {
    const existingAccount = this.prisma.account.findUnique({
      where: {
        document: createAccountDto.document,
      },
    });

    if (existingAccount) {
      throw new Error('An account with this document already exists.');
    }

    const creditLimit = 1000.00;
    const balance = 0.00;

    const account = this.prisma.account.create({
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
     }
  }

  findAll() {
    return `This action returns all account`;
  }

  findOne(id: number) {
    return `This action returns a #${id} account`;
  }

  update(id: number, updateAccountDto: UpdateAccountDto) {
    return `This action updates a #${id} account`;
  }

  remove(id: number) {
    return `This action removes a #${id} account`;
  }
}
