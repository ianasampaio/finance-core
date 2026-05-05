export const RABBITMQ_EXCHANGES = {
  EVENTS: 'finance.events',
  RETRY: 'finance.retry.ex',
  DEAD_LETTER: 'finance.dlx',
} as const;

export const MOVEMENT_EVENTS = {
  CREATED: 'movement.created',
  CONFIRMED: 'movement.confirmed',
  FAILED: 'movement.failed',
} as const;

export type MovementEventType =
  (typeof MOVEMENT_EVENTS)[keyof typeof MOVEMENT_EVENTS];

export const RABBITMQ_QUEUES = {
  BALANCE: 'balance.movements.queue',
  WEBHOOK: 'webhook.movements.queue',
  DEAD_LETTER: 'movements.dead-letter',
} as const;

export const QUEUE_BINDINGS: Record<string, readonly string[]> = {
  [RABBITMQ_QUEUES.BALANCE]: [
    MOVEMENT_EVENTS.CREATED,
  ],
  [RABBITMQ_QUEUES.WEBHOOK]: [
    MOVEMENT_EVENTS.CONFIRMED,
    MOVEMENT_EVENTS.FAILED,
  ],
};

export const RABBITMQ_CONFIG = {
  RETRY_TTL_MS: 15_000,
  MAX_RETRIES: 5,
  PREFETCH: 1,
  RECONNECT_DELAY_MS: 5_000,
} as const;
