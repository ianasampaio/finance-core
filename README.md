# Finance Core

Backend financeiro para gestão de contas, movimentações e entrega de webhooks, construído com arquitetura orientada a eventos.

## Objetivo

Prover uma API B2B onde **Applications** (clientes da plataforma) gerenciam contas de seus usuários finais, processam débitos e créditos de forma assíncrona e recebem notificações via webhook a cada movimentação confirmada ou rejeitada.

---

## Tecnologias

| Camada | Tecnologia |
|---|---|
| Framework | NestJS 11 |
| Linguagem | TypeScript 5 |
| Banco de dados | PostgreSQL 16 + Prisma ORM 7 |
| Fila de mensagens | RabbitMQ 3 + amqplib |
| Aritmética financeira | Decimal.js |
| Validação | class-validator / class-transformer |
| Testes | Jest 30 + ts-jest |
| Infraestrutura local | Docker Compose |

---

## Instalação

### Pré-requisitos

- Node.js 20+
- Docker e Docker Compose

### 1. Clonar e instalar dependências

```bash
git clone <repo-url>
cd finance-core
npm install
```

### 2. Configurar variáveis de ambiente

Crie um arquivo `.env` na raiz do projeto:

```env
DATABASE_URL=postgresql://root:root@localhost:5432/finance_core?schema=public
RABBITMQ_URL=amqp://guest:guest@localhost:5672
PORT=3000
```

### 3. Subir a infraestrutura

```bash
docker compose up -d
```

Isso inicia:
- **PostgreSQL** na porta `5432`
- **RabbitMQ** na porta `5672` (AMQP) e `15672` (painel de gestão — usuário `guest` / senha `guest`)

### 4. Aplicar migrations e gerar o cliente Prisma

```bash
npx prisma migrate deploy
npx prisma generate
```

---

## Executando

```bash
# Desenvolvimento (hot reload)
npm run start:dev

# Produção
npm run build
npm run start:prod
```

A API estará disponível em `http://localhost:3000`.

---

## Testes

```bash
# Todos os testes unitários
npm test

# Com cobertura
npm run test:cov

# Modo watch
npm run test:watch
```

---

## Arquitetura

### Visão geral

```
┌─────────────┐     HTTP      ┌──────────────────────────────────┐
│   Cliente   │ ────────────► │            NestJS API            │
└─────────────┘               │  Applications / Accounts /       │
                               │  Movements / Webhooks            │
                               └────────────┬─────────────────────┘
                                            │ publica eventos
                                            ▼
                               ┌────────────────────────┐
                               │        RabbitMQ        │
                               │  finance.events        │
                               └────┬───────────────────┘
                                    │
                     ┌──────────────┴──────────────┐
                     ▼                             ▼
          ┌──────────────────┐         ┌───────────────────────┐
          │ MovementConsumer │         │   WebhookConsumer     │
          │  (balance queue) │         │  (webhook queue)      │
          └────────┬─────────┘         └──────────┬────────────┘
                   │                              │
                   ▼                              ▼
          ┌──────────────────┐         ┌───────────────────────┐
          │MovementProcessor │         │  WebhookDispatcher    │
          │ Aplica débito /  │         │  POST + HMAC-SHA256   │
          │ crédito na conta │         │  Retry exponencial    │
          └──────────────────┘         └───────────────────────┘
```

### Módulos

| Módulo | Responsabilidade |
|---|---|
| `ApplicationModule` | CRUD de Applications (clientes B2B) |
| `AccountModule` | Criação e gestão de contas de usuários |
| `MovementModule` | Criação e consulta de movimentações |
| `MovementProcessorModule` | Worker que processa a fila de movimentações e atualiza saldos |
| `WebhookModule` | CRUD de webhooks registrados por Application |
| `WebhookDispatcherModule` | Worker que entrega webhooks com retry exponencial |
| `RabbitmqModule` | Conexão, exchanges, filas e publicação de eventos |

---

## Fluxos do Sistema

### 1. Cadastro e configuração

```
POST /applications          → cria uma Application (cliente)
POST /accounts              → cria uma conta vinculada à Application
POST /webhooks              → registra uma URL para receber notificações
```

### 2. Fluxo de movimentação (assíncrono)

```
POST /movements
  └─► Salva movimento com status PENDING
  └─► Publica evento movement.created no RabbitMQ
  └─► Retorna 202 Accepted imediatamente

[balance.movements.queue]
  └─► MovementProcessor recebe movement.created
  └─► Adquire lock da conta (SELECT FOR UPDATE)
  └─► DEBIT: verifica se amount ≤ saldo + limite de crédito
       ├─ Aprovado → subtrai do saldo, status = SUCCESS
       └─ Reprovado → mantém saldo, status = FAILED
  └─► CREDIT: soma ao saldo, status = SUCCESS
  └─► Publica movement.confirmed ou movement.failed

[webhook.movements.queue]
  └─► WebhookDispatcher recebe o evento
  └─► Localiza webhooks ativos da Application da conta
  └─► Cria registro WebhookDelivery
  └─► POST para a URL do webhook com assinatura HMAC-SHA256
  └─► Em caso de falha: agenda retry com backoff exponencial
```

### 3. Retry de webhooks

| Tentativa | Delay acumulado |
|---|---|
| 1ª (imediata) | — |
| 2ª | 1 minuto |
| 3ª | 5 minutos |
| 4ª | 30 minutos |
| 5ª | 2 horas |
| 6ª | 24 horas |

Após 6 tentativas sem sucesso, o `WebhookDelivery` é marcado como `FAILED`. Ao reiniciar a aplicação, entregas `PENDING` são recuperadas do banco e reagendadas automaticamente.

---

## Referência da API

### Applications

#### Criar Application

```http
POST /applications
Content-Type: application/json

{
  "name": "Minha Empresa"
}
```

```json
{
  "applicationId": "uuid",
  "name": "Minha Empresa",
  "createdAt": "2026-05-16T12:00:00.000Z"
}
```

#### Buscar Application

```http
GET /applications/:id
```

---

### Accounts

#### Criar conta

```http
POST /accounts
Content-Type: application/json

{
  "applicationId": "uuid",
  "name": "Alice",
  "email": "alice@example.com",
  "document": "12345678900"
}
```

```json
{
  "accountId": "uuid"
}
```

> Toda conta é criada com `balance = 0` e `creditLimit = 1000`.

#### Consultar saldo

```http
GET /accounts/:id
```

```json
{
  "balance": "250.00",
  "creditLimit": "1000.00",
  "availableLimit": "1250.00"
}
```

#### Listar movimentações da conta

```http
GET /accounts/:id/movements?page=1&limit=20
```

```json
{
  "data": [
    {
      "movementId": "uuid",
      "accountId": "uuid",
      "type": "DEBIT",
      "amount": "100.00",
      "status": "SUCCESS",
      "balanceAfter": "150.00",
      "description": "Compra",
      "createdAt": "2026-05-16T11:00:00.000Z",
      "processedAt": "2026-05-16T11:00:01.000Z"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 42,
    "totalPages": 3
  }
}
```

#### Desativar conta

```http
DELETE /accounts/:id
```

Resposta: `204 No Content`

> Operação de soft delete — a conta é marcada como `active = false`.

---

### Movements

#### Criar movimentação

```http
POST /movements
Content-Type: application/json

{
  "accountId": "uuid",
  "type": "DEBIT",
  "amount": "100.50",
  "description": "Compra online"
}
```

```json
HTTP 202 Accepted

{
  "movementId": "uuid",
  "accountId": "uuid",
  "type": "DEBIT",
  "amount": "100.50",
  "status": "PENDING",
  "balanceAfter": null,
  "description": "Compra online",
  "createdAt": "2026-05-16T12:00:00.000Z",
  "processedAt": null
}
```

> O status final (`SUCCESS` ou `FAILED`) é definido de forma assíncrona pelo worker de processamento.

#### Consultar movimentação

```http
GET /movements/:id
```

---

### Webhooks

#### Registrar webhook

```http
POST /webhooks
Content-Type: application/json

{
  "applicationId": "uuid",
  "url": "https://minha-api.com/webhooks/finance"
}
```

```json
{
  "id": "uuid",
  "applicationId": "uuid",
  "url": "https://minha-api.com/webhooks/finance",
  "active": true,
  "createdAt": "2026-05-16T12:00:00.000Z",
  "secret": "a1b2c3..."
}
```

> O `secret` é retornado **apenas na criação**. Guarde-o para verificar a assinatura das entregas.

#### Buscar webhook

```http
GET /webhooks/:id
```

#### Atualizar URL

```http
PATCH /webhooks/:id
Content-Type: application/json

{
  "url": "https://nova-url.com/hook"
}
```

#### Desativar webhook

```http
DELETE /webhooks/:id
```

Resposta: `204 No Content`

---

### Payload e assinatura do webhook

Cada entrega faz um `POST` para a URL registrada com os headers:

```
Content-Type:  application/json
X-Webhook-Id:  <delivery-uuid>
X-Timestamp:   2026-05-16T12:00:00.000Z
X-Signature:   sha256=<hmac-hex>
```

A assinatura é um HMAC-SHA256 do body usando o `secret` do webhook:

```js
const signature = createHmac('sha256', secret).update(body).digest('hex');
// Validar: `sha256=${signature}` === req.headers['x-signature']
```

**Exemplo de payload:**

```json
{
  "webhookId": "delivery-uuid",
  "event": "movement.confirmed",
  "movementId": "uuid",
  "accountId": "uuid",
  "type": "CREDIT",
  "amount": "500.00",
  "status": "SUCCESS",
  "balanceAfter": "750.00",
  "description": null,
  "processedAt": "2026-05-16T12:00:01.000Z"
}
```

**Eventos possíveis:**

| Evento | Quando ocorre |
|---|---|
| `movement.confirmed` | Movimentação processada com sucesso |
| `movement.failed` | Movimentação rejeitada (ex: saldo insuficiente) |

---

## Modelo de dados

```
Application
  ├── Account (N)
  │     └── Movement (N)
  └── Webhook (N)
        └── WebhookDelivery (N)
```

| Entidade | Campos principais |
|---|---|
| Application | `id`, `name` |
| Account | `id`, `applicationId`, `name`, `email`, `document`, `balance`, `creditLimit`, `active` |
| Movement | `id`, `accountId`, `type`, `amount`, `status`, `balanceAfter`, `description`, `processedAt` |
| Webhook | `id`, `applicationId`, `url`, `secret`, `active` |
| WebhookDelivery | `id`, `webhookId`, `movementId`, `status`, `attempts`, `nextAttemptAt`, `payload`, `responseStatus` |
