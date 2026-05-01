import { IsEmail, IsNotEmpty, IsString } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateAccountDto {
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
