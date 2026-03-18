# Ops Runbook (минимум для запуска)

Этот файл нужен для ежедневной эксплуатации и аварийного восстановления.

## 1) Ежедневные команды

Сделать backup SQLite:

```bash
npm run backup:db
```

Ротация логов:

```bash
npm run rotate:logs
```

Комбинированный ежедневный прогон:

```bash
npm run ops:daily
```

Проверка здоровья сервиса:

```bash
npm run monitor:health
```

Проверка endpoint напрямую:

```bash
curl http://127.0.0.1:${GREENLAB_PORT:-3010}/healthz
```

## 2) Где лежат артефакты

- Бэкапы БД: `backups/sqlite/*.sqlite`
- Снапшоты перед restore: `data/recovery-snapshots/*.sqlite`
- Логи сервера (ротация): `server*.log`, `server*.out.log`, `server*.err.log`

## 3) Пороговые значения мониторинга

- `sync_queue.failed` должно быть `0`
- `sync_queue.pending` не больше `20`
- `sync_queue.processing` не больше `10`

Если порог превышен:

1. Нажать «Запустить sync сейчас» в менеджерском кабинете.
2. Проверить `Очередь синхронизации` и текст ошибок.
3. Если `failed` растет: проверить токен/API CleanCloud и сеть.
4. После исправления запустить повторно: `npm run monitor:health`.

## 4) Аварийное восстановление БД

Важно: перед восстановлением остановите сервер.

### Вариант A: восстановить из последнего backup

```bash
npm run restore:db
```

### Вариант B: восстановить из конкретного файла

```bash
node scripts/restore-db.js --file=backups/sqlite/greenlab-demo-YYYY-MM-DDTHH-mm-ss-sssZ.sqlite
```

После restore:

1. Запустить сервер.
2. Проверить вход (`manager/demo123`).
3. Проверить, что станции и заказы открываются.
4. Проверить `npm run test:all`.

## 5) Проверка целостности backup

Скрипт `backup-db.js` уже выполняет `PRAGMA integrity_check`.
Если backup поврежден, скрипт завершится с ошибкой.

## 6) Рекомендация по расписанию (Windows Task Scheduler)

Минимум:

- `backup:db` — каждые 6 часов.
- `rotate:logs` — каждый день ночью.
- `monitor:health` — каждые 5 минут.

Если бэкапы растут слишком быстро — уменьшите `--keep`.

## 7) Webhook-алерты (опционально)

Можно отправлять алерты в внешний webhook (Telegram bot gateway, Slack incoming webhook и т.д.).

Переменная среды:

```bash
OPS_ALERT_WEBHOOK_URL=https://your-webhook-endpoint
```

Пример ручного запуска:

```bash
node scripts/monitor-health.js --webhook-url=https://your-webhook-endpoint
```
