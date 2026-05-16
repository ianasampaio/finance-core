import { IsUrl, IsUUID } from 'class-validator';

export class CreateWebhookDto {
  @IsUUID()
  applicationId!: string;

  @IsUrl({ require_tld: false })
  url!: string;
}
