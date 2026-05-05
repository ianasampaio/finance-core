export class InvalidMovementAmountError extends Error {
  constructor(movementId: string, amount: string) {
    super(`Invalid amount "${amount}" for movement ${movementId}`);
    this.name = 'InvalidMovementAmountError';
  }
}

export class MovementNotFoundError extends Error {
  constructor(movementId: string, accountId: string) {
    super(`Movement ${movementId} not found for account ${accountId}`);
    this.name = 'MovementNotFoundError';
  }
}

export class UnknownMovementTypeError extends Error {
  constructor(movementId: string, type: never) {
    super(`Unknown movement type "${String(type)}" for movement ${movementId}`);
    this.name = 'UnknownMovementTypeError';
  }
}
