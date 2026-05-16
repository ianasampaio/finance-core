import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { CreateApplicationDto } from './dto/create-application.dto';

@Injectable()
export class ApplicationService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateApplicationDto) {
    const app = await this.prisma.application.create({
      data: { name: dto.name },
    });
    return { applicationId: app.id, name: app.name, createdAt: app.createdAt };
  }

  async findOne(id: string) {
    const app = await this.prisma.application.findUnique({ where: { id } });
    if (!app) throw new NotFoundException(`Application ${id} not found`);
    return app;
  }
}
