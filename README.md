# Green Lab Demo MVP

Локальное демо-приложение Green Lab для показа заказчику.

Что уже реализовано:
- вход по ролям и доступ по станциям (RBAC)
- интерфейс по ролям: сортировка / скан-пост / выдача / менеджер
- сортировка с выбором количества корзин и опциональными названиями
- поток сканирования: стирка -> QC -> сушка -> глажка -> выдача
- kiosk-режим скан-поста (сканер как клавиатура, Enter, явный статус OK/Ошибка + звуковой сигнал)
- подтверждение выдачи в системе, финальное закрытие заказа только в CleanCloud
- детали заказа и лог сканов
- локальная база SQLite
- очередь синхронизации CleanCloud (с retry/fail и ручным запуском)
- прием webhook CleanCloud с дедупликацией событий
- экспорт лога сканов (JSON/CSV)
- простой режим оператора для станций сканирования

## Быстрый запуск

```bash
npm install
npm run reset-demo
npm start
```

Открыть в браузере:
- [http://127.0.0.1:3010](http://127.0.0.1:3010)
- если `localhost` не работает, использовать именно `127.0.0.1`
- `npm run reset-demo` работает и при запущенном сервере (через API reset)

## Демо-учётки

- `sorting` / `demo123`
- `washing` / `demo123`
- `qc` / `demo123`
- `drying` / `demo123`
- `ironing` / `demo123`
- `pickup` / `demo123`
- `manager` / `demo123`

## Интеграция CleanCloud (опционально)

Переменные окружения:

- `CLEAN_CLOUD_API_TOKEN` - токен API CleanCloud
- `CLEAN_CLOUD_API_BASE` - базовый URL API (по умолчанию `https://cleancloudapp.com/api`)
- `CLEAN_CLOUD_WEBHOOK_TOKEN` - если задан, webhook требует `x-webhook-token` или `?token=...`
- `CLEAN_CLOUD_SYNC_RETRY_LIMIT` - лимит попыток для очереди (по умолчанию `5`)

Новые API для менеджера:

- `GET /api/sync-queue` - очередь + summary (`pending/processing/processed/failed`)
- `POST /api/sync/run` - принудительно прогнать очередь синка
- `GET /api/webhooks/events` - последние webhook-события
- `POST /api/cleancloud/test-update` - безопасный тест записи статуса в CleanCloud
- `POST /api/cleancloud/webhook` - входящий webhook endpoint (без авторизации в UI)

## Автотесты

```bash
npm run test:all
```

С проверкой CleanCloud:

```bash
CLEAN_CLOUD_API_TOKEN=... npm run test:all
```

## Минимальный ops-контур

- backup SQLite: `npm run backup:db`
- restore из последнего backup: `npm run restore:db`
- ротация логов: `npm run rotate:logs`
- мониторинг здоровья: `npm run monitor:health`
- ежедневный пакет: `npm run ops:daily`
- health endpoint: `GET /healthz` (или `GET /api/healthz`)

Подробный регламент: [OPS_RUNBOOK.md](./OPS_RUNBOOK.md)

## Сценарий показа (8 шагов)

1. Войти как `sorting` и создать корзины для заказа `GL-2401`.
2. Войти как `washing` и отсканировать: `QR:B-2401-1`, `QR:B-2401-2`, `QR:B-2401-3`.
3. Войти как `qc` и выполнить контроль качества по тем же QR-кодам.
4. Войти как `drying` и повторить сканы тех же корзин.
5. Войти как `ironing` и повторить сканы тех же корзин.
6. Войти как `pickup`, проверить корзину и подтвердить выдачу (закрытие выполняется в CleanCloud).
7. Войти как `manager`, показать обзор и логи.
8. Нажать «Сбросить демо-данные» и показать возврат сценария в исходное состояние.

## Что важно проговорить заказчику

- Это MVP-демо, не production-версия.
- Интеграция с реальным CleanCloud пока заглушена.
- Логика маршрутов «разные услуги внутри одного заказа» пока не включена (все корзины идут по общему потоку).


