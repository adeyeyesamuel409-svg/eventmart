# EventMart

A cloud-native event ticketing platform, built progressively across 7 phases: from a
single orders monolith to a fully event-driven microservices system running on AWS EKS
with CI/CD and observability.

## Architecture

```
                         Internet
                             │
                    ┌────────▼────────┐
                    │  ALB (ingress)  │  path-based routing
                    └────────┬────────┘
        ┌──────────┬─────────┼──────────┬─────────────┐
        ▼          ▼         ▼          ▼             ▼
   ┌─────────┐ ┌──────┐ ┌────────┐ ┌─────────┐ ┌──────────────┐
   │ catalog │ │ cart │ │ orders │ │payments │ │notifications │
   └────┬────┘ └──┬───┘ └───┬────┘ └────┬────┘ └──────┬───────┘
        │         │         │           │             │
        │    HTTP │    SNS  │ event bus │        SQS  │
        │         │         ▼           ▼             │
        │         │    ┌─────────────────────┐        │
        │         └───►│  SNS topics + SQS   │◄───────┘
        │              │  (filter policies)  │
        │              └──────────┬──────────┘
        │                         │
   ┌────▼─────────────────────────▼────┐
   │     Aurora Serverless v2 (MySQL)  │  each service owns its tables
   └───────────────────────────────────┘
```

**Event flow:** `checkout` (cart) reserves stock via catalog (HTTP), creates an order via
orders (HTTP). Orders publishes `order.placed` → payments consumes it, simulates payment
(orders over $1,000 fail), publishes `payment.succeeded`/`payment.failed` → orders updates
order status (`placed → paid / payment_failed`) and notifications sends messages.

## Tech stack

- **Services:** Node.js 20, Express 5, mysql2 (5 independently deployable services)
- **Database:** Aurora Serverless v2 MySQL (schema-per-service tables)
- **Events:** Amazon SNS/SQS — filter policies, raw message delivery, DLQs per queue
- **Compute:** EKS (2× t3.medium), IRSA for least-privilege IAM per workload
- **Networking:** VPC (public/private subnets), internet-facing ALB via AWS Load Balancer
  Controller (path-based routing)
- **Local parity:** docker compose + LocalStack (SNS/SQS)
- **CI/CD:** GitHub Actions with GitHub OIDC (no long-lived AWS keys)
- **Observability:** CloudWatch Container Insights (metrics + logs)

## Project structure

```
├── .github/workflows/ci.yml      # CI/CD: test → build/push ECR → deploy EKS
├── docker-compose.yml            # local stack: MySQL + LocalStack + 5 services + monolith
├── infra/
│   ├── aws/                      # CloudFormation foundation + IAM policies
│   ├── eks/                      # eksctl cluster config
│   ├── k8s/                      # deployments, services, configmap, ingress
│   ├── localstack/               # local SNS/SQS topology (mirrors AWS)
│   ├── deploy-cluster.ps1        # foundation stack + EKS cluster
│   ├── deploy-apps.ps1           # deploy services, print public URL
│   ├── setup-events-iam.ps1      # IRSA for the event bus
│   ├── setup-alb-controller.ps1  # AWS Load Balancer Controller (helm)
│   ├── setup-cicd-iam.ps1        # GitHub OIDC role + EKS access
│   ├── setup-observability.ps1   # CloudWatch Container Insights add-on
│   └── teardown.ps1              # remove everything (ALB → cluster → stack)
├── services/
│   ├── catalog/                  # products + stock
│   ├── cart/                     # carts + checkout orchestration
│   ├── orders/                   # order creation/queries, publishes/consumes events
│   ├── payments/                 # payment processing from order.placed
│   ├── notifications/            # consumes all domain events
│   └── monolith/                 # Phase 1 (kept for reference)
└── test/smoke.mjs                # end-to-end smoke tests
```

## API

| Service | Endpoints |
|---|---|
| catalog | `GET/POST /products`, `GET/PATCH /products/:id`, `POST /products/lookup`, `POST /stock/decrement`, `POST /stock/increment` |
| cart | `POST /carts`, `GET /carts/:id`, `POST /carts/:id/items`, `DELETE /carts/:id/items/:productId`, `POST /carts/:id/checkout` |
| orders | `GET /orders`, `GET /orders/:id`, `POST /orders` |
| payments | `GET /payments`, `GET /payments/:orderId` |
| notifications | `GET /notifications` |

Events on the bus (SNS message attribute `event-type`, JSON body with
`{eventType, eventId, occurredAt, data}`): `order.placed`, `payment.succeeded`,
`payment.failed`.

## Getting started (local)

Prerequisites: Docker, Node.js 20+.

```powershell
docker compose up --build -d     # MySQL + LocalStack + 5 services (monolith on :3010)
node test/smoke.mjs              # 30 end-to-end checks incl. the event flow
docker compose down -v
```

Services: catalog `:3011`, cart `:3012`, orders `:3013`, payments `:3014`,
notifications `:3015`. LocalStack (`:4576`) provides local SNS/SQS with the same
topology as AWS.

## Testing

```powershell
node test/smoke.mjs                                                   # local (docker compose)
$env:GATEWAY_URL="http://<alb-dns>"; node test/smoke.mjs              # through the public ALB
```

The smoke tests cover product CRUD, cart flows, checkout, stock decrement, oversell
rejection, the async event flow (payment recorded, order status transitions,
notifications), and the payment failure path (orders over $1,000). Tests are re-runnable
against dirty databases (unique SKUs per run). CI runs the same suite on every push.

## Deployment (AWS)

One-time setup (idempotent), in order:

```powershell
powershell -ExecutionPolicy Bypass -File infra/deploy-cluster.ps1       # VPC, Aurora, SNS/SQS, ECR, KMS, EKS
powershell -ExecutionPolicy Bypass -File infra/setup-events-iam.ps1    # IRSA for events
powershell -ExecutionPolicy Bypass -File infra/setup-alb-controller.ps1
powershell -ExecutionPolicy Bypass -File infra/setup-cicd-iam.ps1      # then: gh variable set AWS_ROLE_ARN --body <role-arn>
powershell -ExecutionPolicy Bypass -File infra/setup-observability.ps1
```

Deploy / redeploy the services:

```powershell
powershell -ExecutionPolicy Bypass -File infra/deploy-apps.ps1   # prints the public URL
```

## CI/CD

Every push to `main` runs the pipeline (see `Actions`):

1. **test** — spins up the full stack with LocalStack and runs the smoke tests
2. **deploy** — authenticates to AWS via GitHub OIDC, builds and pushes the 5 images to
   ECR (tagged `:latest` and `:<sha>`), deploys to EKS, rolls out new images

No AWS credentials are stored in GitHub; the role is assumable only by this repository's
`main` branch.

## Observability

CloudWatch Container Insights (installed by `infra/setup-observability.ps1`):

- **Metrics:** CloudWatch console → Metrics → ContainerInsights → EKS → `eventmart`
  (node/pod/container CPU & memory, API server metrics)
- **Logs:** CloudWatch Logs → `/aws/containerinsights/eventmart/application`

## Teardown

Removes the ALB first (prevents leaks), then the EKS cluster, then the CloudFormation
foundation stack:

```powershell
powershell -ExecutionPolicy Bypass -File infra/teardown.ps1
```

Note: the ALB (~$18/month), Aurora Serverless v2, and EKS nodes bill while running.

## How the project evolved

| Phase | Commit | What landed |
|---|---|---|
| 1 | `b81c1af` | Orders monolith (catalog + cart + orders) with docker-compose and smoke tests |
| 2 | `f8094c3` | AWS foundation: VPC, Aurora Serverless v2, SNS/SQS event bus, ECR, KMS, EKS |
| 3 | `1d38199` | Extract catalog/cart/orders microservices, push to ECR, deploy to EKS |
| 4 | `40f34d6` | Event-driven payments + notifications via SNS/SQS with IRSA |
| 5 | `c55165c` | Internet-facing ALB ingress with path-based routing |
| 6 | `34a6fcc` | GitHub Actions CI/CD with GitHub OIDC |
| 7 | `c002a04` | CloudWatch Container Insights observability |
