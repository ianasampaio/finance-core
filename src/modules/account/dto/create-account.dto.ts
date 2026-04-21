import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class CreateAccountDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  document: string;
}
