# Telegram Voice -> Calendar (MVP)

MVP сервис на Next.js: пользователь отправляет voice в Telegram, бот распознаёт текст, парсит событие и после подтверждения отправляет `.ics` файл для добавления в Apple Calendar.

## Что реализовано
- Next.js App Router + TypeScript + Node runtime API route
- Telegram Bot API через `grammy`
- Prisma + SQLite (локально)
- Voice pipeline: `received -> transcribed -> parsed -> awaiting_confirmation -> created/cancelled/failed`
- Идемпотентность по `(telegramChatId, telegramMessageId)`
- Абстракции:
  - `ITranscriber` (`mock` + `whisper` адаптер)
  - `IEventParser` (`rules` + заглушка `llm`)
- Rule-based parser (RU/EN):
  - `сегодня`, `завтра`, `в пятницу`
  - `в 18:30`
  - `через 2 часа`
  - длительность (`на час`, `на 30 минут`, `for 2 hours`)
- Confirmation flow в Telegram:
  - `✅ Создать`
  - `✏️ Изменить`
  - `🗑 Отмена`
- Генерация `.ics` (VEVENT + VALARM) и отправка через `sendDocument`
- Команда смены таймзоны: `/timezone Europe/Warsaw`

## Структура

```text
.
├── prisma/
│   └── schema.prisma
├── src/
│   ├── app/
│   │   ├── api/telegram/webhook/route.ts
│   │   ├── globals.css
│   │   ├── layout.tsx
│   │   └── page.tsx
│   └── lib/
│       ├── calendar/icloud.ts
│       ├── config/env.ts
│       ├── db/prisma.ts
│       ├── parser/
│       │   ├── IEventParser.ts
│       │   ├── index.ts
│       │   ├── llm-event-parser.ts
│       │   └── rules-event-parser.ts
│       ├── services/ics.ts
│       ├── telegram/
│       │   ├── bot.ts
│       │   ├── handlers.ts
│       │   ├── keyboards.ts
│       │   └── messages.ts
│       ├── transcriber/
│       │   ├── ITranscriber.ts
│       │   ├── index.ts
│       │   ├── mock-transcriber.ts
│       │   └── whisper-transcriber.ts
│       └── types/event.ts
├── .env.example
├── package.json
└── README.md
```

## ENV
Скопируйте `.env.example` в `.env`:

```bash
cp .env.example .env
```

Обязательные переменные:
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET` (если используете secret token в webhook)
- `DATABASE_URL` (для локального SQLite: `file:./dev.db`)
- `ENCRYPTION_KEY` (зарезервировано под этап iCloud)
- `TRANSCRIBER=mock|whisper`
- `EVENT_PARSER=rules|llm`

Дополнительно:
- `OPENAI_API_KEY` (нужен только для `TRANSCRIBER=whisper`)

## Локальный запуск

```bash
npm install
npm run prisma:generate
npm run prisma:migrate -- --name init
npm run dev
```

## Настройка Telegram webhook

Endpoint:
- `POST /api/telegram/webhook`

Пример с ngrok:

```bash
ngrok http 3000
```

Установить webhook:

```bash
curl -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://<your-ngrok-domain>/api/telegram/webhook",
    "secret_token": "'"${TELEGRAM_WEBHOOK_SECRET}"'"
  }'
```

Пример с Cloudflare Tunnel:

```bash
cloudflared tunnel --url http://localhost:3000
```

Затем аналогично вызовите `setWebhook` с публичным URL.

## Поток бота
1. `/start` -> приветствие и подсказка.
2. Пользователь шлёт voice.
3. Бот скачивает `.ogg`, отправляет в transcriber.
4. Parser строит `EventDraft`.
5. Бот отправляет расшифровку + карточку + inline кнопки.
6. `✅ Создать` -> создаётся запись Event в БД + отправляется `.ics`.
7. `✏️ Изменить` -> бот ждёт правку одной строкой и повторно парсит.
8. `🗑 Отмена` -> черновик переводится в `cancelled`.

## Stage 2 (дизайн, не реализовано в MVP)
- `/connect_icloud`
- хранение app-specific password в зашифрованном виде
- CalDAV discovery + `PUT` события в iCloud
