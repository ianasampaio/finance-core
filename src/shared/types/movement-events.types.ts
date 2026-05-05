import { MovementStatus, MovementType } from '@prisma/client';

export type MovementCreatedData = {
  accountId: string;
  type: MovementType;
  amount: string;
  status: MovementStatus;
  description?: string | null;
  createdAt: string;
};

export type MovementProcessedPayload = {
  movementId: string;
  accountId: string;
  type: MovementType;
  amount: string;
  status: MovementStatus;
  balanceAfter: string;
  description: string | null;
  createdAt: string;
  processedAt: string;
};
