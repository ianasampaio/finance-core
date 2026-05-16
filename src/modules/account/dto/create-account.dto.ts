import { IsEmail, IsNotEmpty, IsString, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateAccountDto {
  @IsUUID()
  applicationId!: string;

  @Transform(({ value }) => value?.trim())
  @IsString()
  @IsNotEmpty()
  name!: string;

  @Transform(({ value }) => value?.toLowerCase().trim())
  @IsEmail()
  email!: string;

  @Transform(({ value }) => value?.replace(/\D/g, ''))
  @IsString()
  @IsNotEmpty()
  document!: string;
}
