# PostgreSQL Migration Plan

Цель: перейти с локального SQLite на PostgreSQL без остановки разработки и без скрытого риска для тестирования.

## Текущее состояние

- Приложение открывает БД через `backend/db`.
- SQLite-схема вынесена в `backend/db/sqlite-schema.js`.
- `GREENLAB_DB_CLIENT=sqlite` остается рабочим режимом по умолчанию.
- `GREENLAB_DB_CLIENT=postgres` намеренно не запускает приложение, пока запросы не переведены на асинхронный PostgreSQL-адаптер.
- Черновик PostgreSQL-схемы добавлен в `backend/db/postgres-schema.sql`, но runtime его пока не применяет автоматически.
- Placeholder conversion helper добавлен в `backend/db/sql-placeholders.js`; быстрый тест доступен через `npm run test:sql-placeholders`.
- SQL portability audit доступен через `npm run audit:db`.
- DB boundary audit доступен через `npm run audit:db-boundaries` и проверяет, что runtime-сервисы не используют `db.prepare/db.exec` вне `backend/db`.
- DB schema parity audit доступен через `npm run audit:db-schema` и проверяет совпадение таблиц/колонок между SQLite bootstrap/migrations и PostgreSQL draft.
- Прямые `last_insert_rowid()` убраны из workflow-кода.
- Прямые `BEGIN IMMEDIATE` из runtime/workflow-кода сведены к `backend/db/transaction.js`.
- Auth/users и security events уже вызываются через repository factory `backend/db/repositories.js`.
- Idempotency records уже вызываются через repository factory `backend/db/repositories.js`.
- System health/sync summary reads уже вызываются через repository factory `backend/db/repositories.js`.
- Demo seed/bootstrap SQL уже вынесен в SQLite repository, `server.js` оставляет только порядок seed-операций и очистку upload-файлов.
- Order detail/overview/station-list reads уже вынесены в SQLite repository, `backend/orders/queries.js` оставляет сборку DTO для UI.
- CleanCloud sync queue, webhook and contact enrichment SQL уже вынесены в SQLite repository, `backend/cleancloud/service.js` оставляет API-вызовы и бизнес-решения.
- Workflow progress/pickup invariant reads and pickup flag writes уже частично вынесены в SQLite repository.
- Machine workbench reads уже вынесены в SQLite workflow repository.
- Machine basket validation reads уже вынесены в SQLite workflow repository.
- Machine start writes уже вынесены в SQLite workflow repository.
- Machine unload reads уже вынесены в SQLite workflow repository.
- Machine unload writes уже вынесены в SQLite workflow repository.
- Machine cancel reads/writes уже вынесены в SQLite workflow repository.
- Workflow scan basket reads/writes уже частично вынесены в SQLite workflow repository.
- Workflow HOLD release reads/writes уже вынесены в SQLite workflow repository.
- Workflow pickup placement reads/writes уже вынесены в SQLite workflow repository.
- Workflow pickup completion reads/writes уже вынесены в SQLite workflow repository.
- Rework list/context reads, QC basket lookup/error events, QC rework request creation, customer approval decisions, QC transfer confirmations и HOLD transitions уже вынесены в SQLite rework repository.
- Sorting catalog reads, QR conflict checks, basket image storage and sorting basket/order writes уже вынесены в SQLite sorting repository.
- Core reset counters и scan export/recent scans уже вынесены в SQLite repositories.
- Pickup workbench reads уже вынесены в SQLite repository, сам pickup-сервис больше не держит SQL для сборки экрана.

## Почему нужен поэтапный переход

Сейчас backend-код напрямую использует синхронный контракт:

```js
db.prepare(sql).get(...)
db.prepare(sql).all(...)
db.prepare(sql).run(...)
db.exec(sql)
```

Обычный PostgreSQL-драйвер для Node работает через `await pool.query(...)`. Поэтому простая замена драйвера сломает маршруты, транзакции и обработчики ошибок. Нужен слой репозиториев или адаптеров, после чего маршруты можно переводить контролируемо.

## Безопасные этапы

1. Зафиксировать SQLite как текущий runtime и держать тесты зелеными.
2. Вынести SQL по доменам: auth, orders, workflow, pickup, cleancloud, security.
3. Добавить PostgreSQL-схему и миграции с отдельной тестовой БД.
4. Перевести сервисы на асинхронный контракт.
5. Прогнать workflow smoke-тесты на SQLite и PostgreSQL.
6. Только после этого включать `GREENLAB_DB_CLIENT=postgres` для staging/production.

## Audit baseline

Текущий baseline после первого cleanup:

- `npm run audit:db` - 197 findings
- high: `0`
- medium: `190`
- low: `7`

SQLite-only runtime, backup and transaction code сейчас собран в `backend/db`. Дальше нужно не бороться с high-блокерами, а постепенно переводить `db.prepare(...).get/all/run` на будущий async repository/query слой.

Первым шагом этот repository слой уже начат для:

- login/user password hash migration
- idempotency record cache
- system health and sync queue summary reads
- demo seed/bootstrap writes
- order detail/overview/station-list reads
- cleancloud sync queue/webhook/contact enrichment reads and writes
- workflow progress/pickup invariant reads and pickup flag writes
- machine workbench reads
- machine basket validation reads
- machine start writes
- machine unload reads
- machine unload writes
- machine cancel reads/writes
- workflow scan basket reads/writes
- workflow HOLD release reads/writes
- workflow pickup placement reads/writes
- workflow pickup completion reads/writes
- rework list/context reads, QC basket lookup/error events, QC rework request creation, customer approval decisions, QC transfer confirmations, and HOLD transitions
- sorting catalog reads, QR conflict checks, basket image storage, and sorting basket/order writes
- security event insert/list
- demo reset counters
- scan export/recent scan reads
- pickup workbench snapshot/progress reads

## Что не делать

- Не ставить `GREENLAB_DB_CLIENT=postgres` на текущем runtime.
- Не подключать PostgreSQL только в `server.js`, оставляя остальной код на `db.prepare(...)`.
- Не смешивать демо-данные и production-данные в одной базе.
