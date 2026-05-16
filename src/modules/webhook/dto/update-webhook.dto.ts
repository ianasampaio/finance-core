import { IsUrl } from 'class-validator';

export class UpdateWebhookDto {
  @IsUrl({ require_tld: false })
  url!: string;
}
