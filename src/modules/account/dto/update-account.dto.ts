import { IsEmail, IsString } from 'class-validator';

export class UpdateAccountDto {
  @IsString()
  name: string;

  @IsEmail()
  email: string;
}
