# Finance Core

Backend financeiro para gestão de contas, movimentações e entrega de webhooks, construído com arquitetura orientada a eventos.

## Objetivo

Prover uma API onde clientes gerenciam contas de usuários finais, processam débitos e créditos de forma assíncrona e recebem notificações via webhook a cada movimentação confirmada ou rejeitada.

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
└─────────────┘               │  Accounts / Movements / Webhooks │
                              └────────────┬─────────────────────┘
                                           │ publica eventos
                                           ▼
                               ┌────────────────────────┐
                               │        RabbitMQ        │
                               │      finance.events    │
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
          │ Aplica débito /  │         │  POST com headers     │
          │ crédito na conta │         │  Retry exponencial    │
          └──────────────────┘         └───────────────────────┘
```

### Módulos

| Módulo | Responsabilidade |
|---|---|
| `AccountModule` | CRUD de contas de usuários |
| `MovementModule` | Criação e consulta de movimentações |
| `MovementProcessorModule` | Worker que processa a fila de movimentações e atualiza saldos |
| `WebhookModule` | CRUD de webhooks registrados por conta |
| `WebhookDispatcherModule` | Worker que entrega webhooks com retry exponencial |
| `RabbitmqModule` | Conexão, exchanges, filas e publicação de eventos |

---

## Fluxos do Sistema

### 1. Cadastro e configuração

```
POST /accounts                              → cria uma conta
POST /accounts/:accountId/webhooks          → registra webhook para a conta
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
  └─► Localiza webhooks cadastrados na conta
  └─► Cria registro WebhookDelivery
  └─► POST para a URL do webhook com headers configurados
  └─► Em caso de falha: agenda retry com backoff exponencial
```

Após 6 tentativas sem sucesso, o `WebhookDelivery` é marcado como `FAILED`. Ao reiniciar a aplicação, entregas `PENDING` são recuperadas do banco e reagendadas automaticamente.

---

## Referência da API

### Accounts

#### Criar conta

```http
POST /accounts
Content-Type: application/json

{
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

#### Remover conta

```http
DELETE /accounts/:id
```

Resposta: `204 No Content`

> Remove a conta e todos os seus dados (movimentações e webhooks) permanentemente.

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

Webhooks são registrados por conta. Todos os endpoints exigem o `accountId` como parâmetro de rota, garantindo que apenas webhooks pertencentes àquela conta sejam acessados.

#### Registrar webhook

```http
POST /accounts/:accountId/webhooks
Content-Type: application/json

{
  "url": "https://minha-api.com/webhooks/finance",
  "headers": {
    "X-Api-Key": "chave-secreta"
  }
}
```

```json
{
  "id": "uuid",
  "accountId": "uuid",
  "url": "https://minha-api.com/webhooks/finance",
  "headers": {
    "X-Api-Key": "chave-secreta"
  },
  "createdAt": "2026-05-16T12:00:00.000Z"
}
```

> O campo `headers` é opcional. Use-o para enviar tokens de autenticação ou qualquer header customizado que o servidor destino exija.

#### Buscar webhook

```http
GET /accounts/:accountId/webhooks/:id
```

#### Atualizar webhook

```http
PATCH /accounts/:accountId/webhooks/:id
Content-Type: application/json

{
  "url": "https://nova-url.com/hook",
  "headers": {
    "Authorization": "Bearer novo-token"
  }
}
```

> Pelo menos um dos campos (`url` ou `headers`) deve ser informado.

#### Remover webhook

```http
DELETE /accounts/:accountId/webhooks/:id
```

Resposta: `204 No Content`

---

### Payload do webhook

Cada entrega faz um `POST` para a URL registrada com os seguintes headers fixos mais os headers customizados configurados no webhook:

```
Content-Type:  application/json
X-Webhook-Id:  <delivery-uuid>
X-Timestamp:   2026-05-16T12:00:00.000Z
Authorization: Bearer meu-token        ← exemplo de header customizado
```

> Headers customizados são enviados junto aos fixos. Se houver conflito de nome, o header fixo tem prioridade.

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
