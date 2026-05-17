import { IsOptional, IsUrl } from 'class-validator';

export class UpdateWebhookDto {
  @IsOptional()
  @IsUrl({ require_tld: false })
  url?: string;

  @IsOptional()
  headers?: Record<string, string>;
}
