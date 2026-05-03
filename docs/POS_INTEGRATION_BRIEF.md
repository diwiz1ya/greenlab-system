# Green Lab system: technical overview for POS integration

This document describes the Green Lab production workflow system and the recommended integration approach for connecting an external POS.

## Purpose

Green Lab is responsible for the production lifecycle after an order has been accepted by the POS:

- basket creation and QR tracking;
- station workflow control;
- washing/drying machine cycles;
- QC, rework and customer approval cases;
- ironing;
- pickup assembly and shelf/location placement;
- scan/event history;
- status synchronization back to the external system.

The POS should remain the source of truth for sales, payments, customer-facing order creation and receipts. Green Lab should be the source of truth for operational basket movement inside the laundry.

## Current status

The application is implemented and tested as a working MVP with PostgreSQL support.

Tested workflow:

```text
sorting -> washing -> drying -> qc/rework -> ironing -> pickup
```

Also tested:

- demo reset and seed data;
- idempotent write operations;
- scan history;
- pickup placement by BIN/LOC QR;
- webhook deduplication;
- sync queue;
- PostgreSQL runtime.

The current repository includes both SQLite and PostgreSQL adapters:

- SQLite: local demo/development mode.
- PostgreSQL: recommended staging/production mode.

## Technology stack

- Runtime: Node.js.
- HTTP server: built-in Node HTTP server.
- Frontend: vanilla HTML/CSS/JavaScript.
- QR scanner: `html5-qrcode`.
- Database:
  - SQLite for local demo;
  - PostgreSQL for staging/production.
- PostgreSQL driver: `pg`.
- Deployment target: any Node-capable server with PostgreSQL.

## Main project structure

```text
server.js                 Application entrypoint and HTTP routing bootstrap
backend/routes/           API route handlers
backend/workflow/         Station workflow logic
backend/orders/           Order query/read models
backend/pickup/           Pickup workbench and placement logic
backend/cleancloud/       External sync queue/webhook logic
backend/db/               SQLite/PostgreSQL repositories and schema
public/                   Frontend application
scripts/                  Tests, audits, backup/restore, PostgreSQL schema apply
```

## Roles and stations

Default demo users:

| Role/login | Purpose |
| --- | --- |
| `sorting` | Creates baskets for incoming orders. |
| `washing` | Loads/unloads baskets through washing machines. |
| `drying` | Loads/unloads baskets through drying machines. |
| `qc` | Inspects baskets after drying, creates rework/customer approval/HOLD cases. |
| `rework` | Handles rework baskets after customer approval and QC transfer. |
| `ironing` | Moves accepted baskets through ironing. |
| `pickup` | Assembles order kits, places ready orders into pickup BIN/LOC. |
| `manager` | Full access, dashboards, reset, sync queue, webhook/security history. |

## Order lifecycle

High-level order status flow:

```text
sorting
  -> washing
  -> drying
  -> qc
  -> ironing
  -> pickup
```

Special states:

- `customer_approval`: QC has requested customer approval for additional treatment/rework.
- `rework`: a separate rework basket is created after approval and transfer confirmation.
- `hold`: manager decision required, usually after damage detection.
- `archived`: basket QR is released after completed pickup.

Important basket invariant:

```text
baskets.station should match baskets.status for active baskets
```

The system has an audit command for this:

```bash
npm run audit:workflow
```

## Database model summary

Core tables:

| Table | Purpose |
| --- | --- |
| `orders` | Main order card and current high-level status. |
| `baskets` | Physical/logic baskets, QR code, station/status and item composition. |
| `basket_catalog` | Pool of reusable BIN QR codes. |
| `basket_images` | Uploaded basket/QC photos. |
| `laundry_machines` | Washing/drying machines. |
| `machine_loads` | Active/completed/cancelled machine cycles. |
| `machine_load_baskets` | Baskets inside a machine cycle. |
| `rework_requests` | QC rework/customer approval requests and transfer tasks. |
| `pickup_locations` | Pickup shelf/location catalog. |
| `pickup_order_placements` | Final BIN/LOC placement for ready pickup orders. |
| `scan_events` | Operational event log. |
| `sync_queue` | Outbound sync events to an external system. |
| `webhook_events` | Inbound webhook log/deduplication. |
| `idempotency_records` | Idempotent write request cache. |
| `users` | Local operators and roles. |

The PostgreSQL schema is in:

```text
backend/db/postgres-schema.sql
```

Apply schema:

```bash
GREENLAB_DATABASE_URL=postgres://user:password@host:5432/greenlab npm run db:postgres:schema
```

## Existing internal API surface

These endpoints are currently used by the Green Lab UI.

Auth/session:

```text
POST /api/login
GET  /api/session
POST /api/logout
```

Core/manager:

```text
GET  /api/stations
GET  /api/overview
POST /api/demo/reset
GET  /api/export/scans
GET  /api/recent-scans
```

Orders:

```text
GET /api/orders?station=:station
GET /api/orders/:id
GET /api/qc/live-metrics
```

Sorting:

```text
POST /api/sorting/create-baskets
POST /api/sorting/update-baskets
POST /api/orders/:id/return-sorting
```

Machine cycle:

```text
GET  /api/machines/workbench?station=washing|drying
POST /api/machines/loads/start
POST /api/machines/loads/validate-basket
POST /api/machines/loads/:id/cancel
POST /api/machines/loads/:id/unload-basket
```

Generic scan:

```text
POST /api/scan
```

QC/rework:

```text
POST /api/qc/inspect
POST /api/qc/reject
POST /api/qc/rework
GET  /api/qc/transfer-tasks
POST /api/qc/transfer-tasks/:id/confirm
POST /api/rework-requests/:id/approve
POST /api/rework-requests/:id/decline
POST /api/orders/:id/release-hold
```

Pickup:

```text
GET  /api/pickup/workbench
POST /api/pickup/place-order
POST /api/pickup/complete
```

External sync/webhook management:

```text
GET  /api/sync-queue
POST /api/sync/run
POST /api/sync/retry-order
GET  /api/webhooks/events
POST /api/cleancloud/webhook
POST /api/cleancloud/test-update
POST /api/orders/:id/enrich-contact
```

## Recommended POS integration boundary

The POS should not write directly to Green Lab tables.

Recommended integration style:

1. POS creates or updates an order through a dedicated Green Lab integration API.
2. Green Lab returns its internal order identifier and public order number.
3. Green Lab operators process baskets/stations in Green Lab.
4. POS receives status changes from Green Lab by webhook or polls a status endpoint.
5. POS displays production status to cashier/customer.

## Proposed POS API contract

The current MVP has the workflow API. For a clean POS integration we recommend adding a dedicated namespace:

```text
/api/integrations/pos/*
```

### Create order

```http
POST /api/integrations/pos/orders
Authorization: Bearer <integration-token>
Content-Type: application/json
```

Example request:

```json
{
  "pos_order_id": "POS-123456",
  "public_id": "GL-2601",
  "customer": {
    "id": "CUST-1001",
    "name": "Dian Saputra",
    "phone": "+62 812 2601",
    "email": "customer@example.com"
  },
  "service_tier": "Premium",
  "order_weight": 4.4,
  "items": [
    {
      "category": "top",
      "label": "Shirt",
      "quantity": 3
    }
  ],
  "created_at": "2026-05-03T10:00:00.000Z"
}
```

Example response:

```json
{
  "ok": true,
  "order": {
    "id": 101,
    "public_id": "GL-2601",
    "pos_order_id": "POS-123456",
    "status": "sorting"
  }
}
```

### Get order status

```http
GET /api/integrations/pos/orders/POS-123456
Authorization: Bearer <integration-token>
```

Example response:

```json
{
  "ok": true,
  "order": {
    "id": 101,
    "public_id": "GL-2601",
    "pos_order_id": "POS-123456",
    "status": "pickup",
    "ready_for_pickup": true,
    "cleancloud_status": "Ready for pickup",
    "updated_at": "2026-05-03T12:30:00.000Z"
  },
  "baskets": [
    {
      "basket_code": "BIN-001",
      "qr_code": "QR:BIN-001",
      "station": "pickup",
      "status": "pickup"
    }
  ]
}
```

### Cancel or hold order

```http
POST /api/integrations/pos/orders/POS-123456/cancel
Authorization: Bearer <integration-token>
```

Possible behavior should be agreed:

- reject cancellation if production already started;
- move to `hold`;
- allow manager-only release;
- mark POS-side cancellation only.

### Order events

```http
GET /api/integrations/pos/orders/POS-123456/events
Authorization: Bearer <integration-token>
```

Returns scan/status history from `scan_events`.

## Webhook from Green Lab to POS

Green Lab should send events to the POS when important status changes happen.

Recommended outbound event:

```json
{
  "event_id": "evt_01H...",
  "event_type": "order.status_changed",
  "occurred_at": "2026-05-03T12:30:00.000Z",
  "order": {
    "greenlab_order_id": 101,
    "public_id": "GL-2601",
    "pos_order_id": "POS-123456",
    "status": "pickup",
    "ready_for_pickup": true
  },
  "station": "pickup",
  "message": "Order is ready for pickup."
}
```

Recommended event types:

```text
order.created
order.status_changed
order.basket_created
order.qc_rework_requested
order.customer_approval_required
order.hold_started
order.hold_released
order.ready_for_pickup
order.completed
```

Webhook requirements:

- POS endpoint should return HTTP 2xx for accepted events.
- Green Lab should retry failed deliveries.
- Events should be idempotent by `event_id`.
- POS should store `event_id` to avoid duplicates.

## Status mapping for POS

Suggested high-level mapping:

| Green Lab status | POS/customer label |
| --- | --- |
| `sorting` | Received / sorting |
| `washing` | Washing |
| `drying` | Drying |
| `qc` | Quality check |
| `customer_approval` | Waiting for customer approval |
| `rework` | Rework / extra treatment |
| `hold` | On hold |
| `ironing` | Ironing |
| `pickup` with `ready_for_pickup=false` | Preparing for pickup |
| `pickup` with `ready_for_pickup=true` | Ready for pickup |
| `archived` baskets / completed pickup | Completed |

Final POS labels should be confirmed with the POS/product team.

## Required decisions from POS team

Before implementation, we need to agree on:

1. Does POS already have an API for order creation/update?
2. What is the POS order primary key?
3. Should Green Lab generate `public_id`, or should POS provide it?
4. Which customer fields are mandatory?
5. Which service/items fields are available in POS?
6. Should POS push orders to Green Lab, or should Green Lab pull orders from POS?
7. Should Green Lab send webhooks to POS, or should POS poll Green Lab?
8. What are the final customer-facing status names?
9. What should happen on cancellation after production has started?
10. What authentication method should be used for integration API and webhooks?

## Current temporary/manual process

The MVP can currently be tested with demo/seed data and manual station operations. Any drag-and-drop or manual handoff from POS is considered temporary.

Production integration should use API/webhook contracts, not direct database edits and not manual file transfer.

## Recommended next steps

1. POS team reviews this document.
2. POS team provides current POS API documentation or sample payloads.
3. Both teams agree on order/status field mapping.
4. Green Lab team implements `/api/integrations/pos/*` endpoints.
5. POS team connects order creation/status display to these endpoints.
6. Both teams run end-to-end tests on a staging PostgreSQL database.
7. Add production monitoring and backup procedures.

## What we need from the POS team

Please provide:

- POS API documentation, if available.
- Example order JSON from POS.
- Example customer JSON from POS.
- List of POS statuses.
- Required customer/order/service fields.
- Preferred webhook URL for receiving Green Lab events.
- Auth requirements: bearer token, API key, HMAC signature or other.
- Test environment credentials.

