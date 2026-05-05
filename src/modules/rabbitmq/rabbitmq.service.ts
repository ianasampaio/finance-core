import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as amqplib from 'amqplib';
import {
  QUEUE_BINDINGS,
  RABBITMQ_CONFIG,
  RABBITMQ_EXCHANGES,
  RABBITMQ_QUEUES,
} from './rabbitmq.constants';

type ConsumeHandler = (msg: amqplib.ConsumeMessage) => Promise<void> | void;

export type DomainEvent<T = unknown> = {
  eventId: string;
  eventType: string;
  version: number;
  aggregateId: string;
  occurredAt: string;
  data: T;
};

@Injectable()
export class RabbitmqService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RabbitmqService.name);
  private connection?: amqplib.ChannelModel;
  private channel?: amqplib.ConfirmChannel;
  private isShuttingDown = false;
  private reconnectTimer?: NodeJS.Timeout;

  async onModuleInit() {
    await this.connect();
  }

  async onModuleDestroy() {
    this.isShuttingDown = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

    try {
      await this.channel?.close();
    } catch (err) {
      this.logger.error('Erro ao fechar canal RabbitMQ', err as Error);
    }

    try {
      await this.connection?.close();
    } catch (err) {
      this.logger.error('Erro ao fechar conexão RabbitMQ', err as Error);
    }

    this.logger.log('Conexão com RabbitMQ encerrada.');
  }

  private async connect(): Promise<void> {
    const url = process.env.RABBITMQ_URL ?? 'amqp://localhost';

    try {
      const connection = await amqplib.connect(url);
      const channel = await connection.createConfirmChannel();
      await channel.prefetch(RABBITMQ_CONFIG.PREFETCH);

      connection.on('error', (err) =>
        this.logger.error('Erro na conexão RabbitMQ', err),
      );
      connection.on('close', () => this.handleConnectionClose());

      this.connection = connection;
      this.channel = channel;

      await this.setup();
      this.logger.log('RabbitMQ conectado e configurado.');
    } catch (err) {
      this.logger.error(
        'Falha ao conectar no RabbitMQ. Tentando novamente...',
        err as Error,
      );
      this.scheduleReconnect();
    }
  }

  private handleConnectionClose() {
    if (this.isShuttingDown) return;
    this.logger.warn('Conexão RabbitMQ encerrada inesperadamente.');
    this.connection = undefined;
    this.channel = undefined;
    this.scheduleReconnect();
  }

  private scheduleReconnect() {
    if (this.isShuttingDown) return;
    this.reconnectTimer = setTimeout(
      () => void this.connect(),
      RABBITMQ_CONFIG.RECONNECT_DELAY_MS,
    );
  }

  private async setup() {
    if (!this.channel) throw new Error('Canal RabbitMQ não inicializado');

    await this.channel.assertExchange(RABBITMQ_EXCHANGES.EVENTS, 'topic', {
      durable: true,
    });
    await this.channel.assertExchange(RABBITMQ_EXCHANGES.RETRY, 'topic', {
      durable: true,
    });
    await this.channel.assertExchange(
      RABBITMQ_EXCHANGES.DEAD_LETTER,
      'topic',
      { durable: true },
    );

    await this.channel.assertQueue(RABBITMQ_QUEUES.DEAD_LETTER, {
      durable: true,
    });
    await this.channel.bindQueue(
      RABBITMQ_QUEUES.DEAD_LETTER,
      RABBITMQ_EXCHANGES.DEAD_LETTER,
      '#',
    );

    for (const [queue, patterns] of Object.entries(QUEUE_BINDINGS)) {
      await this.declareConsumerQueue(queue, patterns);
    }
  }

  private async declareConsumerQueue(
    queue: string,
    patterns: readonly string[],
  ) {
    if (!this.channel) throw new Error('Canal RabbitMQ não inicializado');

    const retryQueue = `${queue}.retry`;

    await this.channel.assertQueue(queue, {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': RABBITMQ_EXCHANGES.RETRY,
        'x-dead-letter-routing-key': queue,
      },
    });

    await this.channel.assertQueue(retryQueue, {
      durable: true,
      arguments: {
        'x-message-ttl': RABBITMQ_CONFIG.RETRY_TTL_MS,
        'x-dead-letter-exchange': RABBITMQ_EXCHANGES.EVENTS,
      },
    });
    await this.channel.bindQueue(
      retryQueue,
      RABBITMQ_EXCHANGES.RETRY,
      queue,
    );

    for (const pattern of patterns) {
      await this.channel.bindQueue(
        queue,
        RABBITMQ_EXCHANGES.EVENTS,
        pattern,
      );
    }
  }

  private getChannelOrThrow(): amqplib.ConfirmChannel {
    if (!this.channel) {
      throw new Error('Canal RabbitMQ indisponível.');
    }
    return this.channel;
  }

  async publish(
    exchange: string,
    routingKey: string,
    payload: unknown,
    headers?: Record<string, unknown>,
  ): Promise<void> {
    const channel = this.getChannelOrThrow();
    const content = Buffer.from(JSON.stringify(payload));

    await new Promise<void>((resolve, reject) => {
      channel.publish(
        exchange,
        routingKey,
        content,
        {
          persistent: true,
          contentType: 'application/json',
          headers,
        },
        (err) => (err ? reject(err) : resolve()),
      );
    });
  }

  async publishEvent<T>(
    eventType: string,
    aggregateId: string,
    data: T,
  ): Promise<DomainEvent<T>> {
    const envelope: DomainEvent<T> = {
      eventId: randomUUID(),
      eventType,
      version: 1,
      occurredAt: new Date().toISOString(),
      aggregateId,
      data,
    };

    await this.publish(RABBITMQ_EXCHANGES.EVENTS, eventType, envelope);
    return envelope;
  }

  async consume(queue: string, handler: ConsumeHandler): Promise<void> {
    const channel = this.getChannelOrThrow();
    await channel.consume(queue, async (msg) => {
      if (!msg) return;

      try {
        await handler(msg);
        channel.ack(msg);
      } catch (err) {
        this.logger.error(
          `Erro processando mensagem da fila ${queue}`,
          err as Error,
        );
        this.handleFailure(queue, msg);
      }
    });
  }

  private handleFailure(queue: string, msg: amqplib.ConsumeMessage) {
    const channel = this.getChannelOrThrow();
    const xDeath = msg.properties.headers?.['x-death'] as
      | Array<{ count?: number }>
      | undefined;
    const attempts = xDeath?.[0]?.count ?? 0;

    if (attempts >= RABBITMQ_CONFIG.MAX_RETRIES) {
      this.logger.warn(
        `Mensagem excedeu ${RABBITMQ_CONFIG.MAX_RETRIES} tentativas em ${queue}. Movendo para DLQ.`,
      );
      channel.publish(
        RABBITMQ_EXCHANGES.DEAD_LETTER,
        msg.fields.routingKey,
        msg.content,
        { persistent: true, headers: msg.properties.headers },
      );
      channel.ack(msg);
      return;
    }

    channel.nack(msg, false, false);
  }
}
