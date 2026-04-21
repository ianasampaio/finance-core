import { Module } from '@nestjs/common';
import { PrismaModule } from 'prisma/prisma.module';
import { AccountModule } from './modules/account/account.module';

@Module({
  imports: [PrismaModule, AccountModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
