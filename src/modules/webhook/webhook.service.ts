import { Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from 'prisma/prisma.service';
import { CreateWebhookDto } from './dto/create-webhook.dto';

@Injectable()
export class WebhookService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateWebhookDto) {
    const application = await this.prisma.application.findUnique({
      where: { id: dto.applicationId },
      select: { id: true },
    });

    if (!application) {
      throw new NotFoundException('Application not found.');
    }

    const secret = randomBytes(32).toString('hex');
    const webhook = await this.prisma.webhook.create({
      data: { applicationId: dto.applicationId, url: dto.url, secret },
      select: {
        id: true,
        applicationId: true,
        url: true,
        active: true,
        createdAt: true,
      },
    });
    // secret é retornado apenas uma vez na criação
    return { ...webhook, secret };
  }

  async findOne(id: string) {
    const webhook = await this.prisma.webhook.findUnique({
      where: { id },
      select: {
        id: true,
        applicationId: true,
        url: true,
        active: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!webhook) throw new NotFoundException(`Webhook ${id} not found`);
    return webhook;
  }

  async remove(id: string) {
    const webhook = await this.prisma.webhook.findUnique({ where: { id } });
    if (!webhook) throw new NotFoundException(`Webhook ${id} not found`);
    await this.prisma.webhook.update({
      where: { id },
      data: { active: false },
    });
  }
}
