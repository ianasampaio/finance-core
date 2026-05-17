import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { CreateWebhookDto } from './dto/create-webhook.dto';
import { UpdateWebhookDto } from './dto/update-webhook.dto';
import { WebhookService } from './webhook.service';

@Controller('accounts/:accountId/webhooks')
export class WebhookController {
  constructor(private readonly webhookService: WebhookService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Body() dto: CreateWebhookDto,
  ) {
    return this.webhookService.create(accountId, dto);
  }

  @Get(':id')
  findOne(
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Param('id') id: string,
  ) {
    return this.webhookService.findOne(accountId, id);
  }

  @Patch(':id')
  update(
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Param('id') id: string,
    @Body() dto: UpdateWebhookDto,
  ) {
    return this.webhookService.update(accountId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Param('id') id: string,
  ) {
    await this.webhookService.remove(accountId, id);
  }
}
