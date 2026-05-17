import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { CreateWebhookDto } from './dto/create-webhook.dto';
import { UpdateWebhookDto } from './dto/update-webhook.dto';

@Injectable()
export class WebhookService {
  constructor(private readonly prisma: PrismaService) {}

  async create(accountId: string, dto: CreateWebhookDto) {
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: { id: true },
    });

    if (!account) throw new NotFoundException('Account not found.');

    return this.prisma.webhook.create({
      data: { url: dto.url, headers: dto.headers, accountId },
      select: {
        id: true,
        accountId: true,
        url: true,
        headers: true,
        createdAt: true
      },
    });
  }

  async findOne(accountId: string, id: string) {
    const webhook = await this.prisma.webhook.findFirst({
      where: { id, accountId },
      select: { id: true, accountId: true, url: true, headers: true, createdAt: true, updatedAt: true },
    });
    if (!webhook) throw new NotFoundException(`Webhook ${id} not found`);
    return webhook;
  }

  async update(accountId: string, id: string, dto: UpdateWebhookDto) {
    if (dto.url === undefined && dto.headers === undefined) {
      throw new BadRequestException('At least one of url or headers must be provided.');
    }

    const webhook = await this.prisma.webhook.findFirst({ where: { id, accountId } });
    if (!webhook) throw new NotFoundException(`Webhook ${id} not found`);

    return this.prisma.webhook.update({
      where: { id },
      data: {
        ...(dto.url !== undefined && { url: dto.url }),
        ...(dto.headers !== undefined && { headers: dto.headers }),
      },
      select: {
        id: true,
        accountId: true,
        url: true,
        headers: true,
        updatedAt: true
      },
    });
  }

  async remove(accountId: string, id: string) {
    const webhook = await this.prisma.webhook.findFirst({ where: { id, accountId } });
    if (!webhook) throw new NotFoundException(`Webhook ${id} not found`);

    await this.prisma.webhook.delete({ where: { id } });
  }
}
