import { Decimal } from "@prisma/client/runtime/client";

export class Account {
  id: string;
  name: string;
  email: string;
  document: string;
  balance: Decimal;
  creditLimit: Decimal;
  createdAt: Date;
  updatedAt: Date;
}