# PostgreSQL Migration Plan

Цель: перейти с локального SQLite на PostgreSQL без остановки разработки и без скрытого риска для тестирования.

## Текущее состояние

- Приложение открывает БД через `backend/db`.
- SQLite-схема вынесена в `backend/db/sqlite-schema.js`.
- `GREENLAB_DB_CLIENT=sqlite` остается рабочим режимом по умолчанию.
- `GREENLAB_DB_CLIENT=postgres` намеренно не запускает приложение, пока запросы не переведены на асинхронный PostgreSQL-адаптер.
- SQL portability audit доступен через `npm run audit:db`.
- Прямые `last_insert_rowid()` убраны из workflow-кода.
- Прямые `BEGIN IMMEDIATE` из runtime/workflow-кода сведены к `backend/db/transaction.js`.

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

- `npm run audit:db` - 207 findings
- high: `9`
- medium: `191`
- low: `7`

Оставшиеся high-блокеры в основном относятся к SQLite-only ops/demo scripts (`backup-db`, `restore-db`, `audit-workflow-state`, `seed-scenarios`) и будут заменяться отдельными PostgreSQL-командами после подключения реального PostgreSQL-драйвера.

## Что не делать

- Не ставить `GREENLAB_DB_CLIENT=postgres` на текущем runtime.
- Не подключать PostgreSQL только в `server.js`, оставляя остальной код на `db.prepare(...)`.
- Не смешивать демо-данные и production-данные в одной базе.
