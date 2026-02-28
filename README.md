# Telegram Voice -> Calendar (MVP)

MVP сервис на Next.js: пользователь отправляет voice в Telegram, бот распознаёт текст, парсит событие и после подтверждения добавляет событие в iCloud Calendar (CalDAV). Если iCloud не настроен или недоступен, бот отправляет `.ics`.

## Что реализовано
- Next.js App Router + TypeScript + Node runtime API route
- Telegram Bot API через `grammy`
- Prisma + SQLite (локально)
- Voice pipeline: `received -> transcribed -> parsed -> awaiting_confirmation -> created/cancelled/failed`
- Идемпотентность по `(telegramChatId, telegramMessageId)`
- Абстракции:
  - `ITranscriber` (`mock` + локальный `whisper.cpp` адаптер)
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
- Прямая синхронизация с iCloud Calendar через CalDAV (по env-настройкам)
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

Основные переменные:
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET` (если используете secret token в webhook)
- `DATABASE_URL` (для локального SQLite: `file:./dev.db`)
- `ENCRYPTION_KEY` (зарезервировано под этап iCloud)
- `ICLOUD_APPLE_ID` (опционально, для прямой записи в iCloud)
- `ICLOUD_APP_SPECIFIC_PASSWORD` (опционально, app-specific password Apple ID)
- `ICLOUD_CALDAV_BASE_URL` (опционально, по умолчанию `https://caldav.icloud.com`)
- `ICLOUD_CALENDAR_NAME` (опционально, имя календаря для записи; если не задано, берётся первый найденный)
- `TRANSCRIBER=mock|whisper` (`mock` - бесплатный режим по умолчанию, `whisper` - локальный open-source STT)
- `EVENT_PARSER=rules|llm` (`llm` в MVP не реализован, автоматически используется `rules`)

Дополнительно:
- `WHISPER_CPP_BIN` (по умолчанию `whisper-cli`)
- `WHISPER_MODEL_PATH` (обязателен для `TRANSCRIBER=whisper`)
- `WHISPER_LANGUAGE` (по умолчанию `auto`)
- `WHISPER_THREADS` (по умолчанию можно оставить `4`)
- `MOCK_TRANSCRIPT_TEXT` (текст-заглушка в `mock` режиме)

## Локальный STT (whisper.cpp)

Для `TRANSCRIBER=whisper` нужны локально:
- `ffmpeg`
- бинарник `whisper.cpp` (`whisper-cli` или путь в `WHISPER_CPP_BIN`)
- модель whisper (например `ggml-base.bin`), путь в `WHISPER_MODEL_PATH`

Пример установки в каталоге проекта:

```bash
python3 -m venv .tools/pyenv
. .tools/pyenv/bin/activate
python -m pip install cmake
git clone --depth 1 https://github.com/ggerganov/whisper.cpp.git .tools/whisper.cpp
make -C .tools/whisper.cpp -j4
bash .tools/whisper.cpp/models/download-ggml-model.sh base
```

Пример значений в `.env`:

```bash
TRANSCRIBER=whisper
WHISPER_CPP_BIN=whisper-cli
WHISPER_MODEL_PATH=/absolute/path/to/ggml-base.bin
WHISPER_LANGUAGE=ru
WHISPER_THREADS=4
```

## Локальный запуск

```bash
npm install
npm run prisma:generate
npm run prisma:migrate -- --name init
npm run lint
npm run build
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
6. `✅ Создать` -> создаётся запись Event в БД + попытка прямой записи в iCloud (CalDAV).
7. Если iCloud не настроен/недоступен, бот отправляет `.ics` как fallback.
8. `✏️ Изменить` -> бот ждёт правку одной строкой и повторно парсит.
9. `🗑 Отмена` -> черновик переводится в `cancelled`.

## Настройка прямой записи в iCloud
1. На Apple ID включите 2FA (если ещё не включено).
2. Создайте app-specific password: `appleid.apple.com` -> Sign-In and Security -> App-Specific Passwords.
3. Добавьте в `.env`:

```bash
ICLOUD_APPLE_ID="your_apple_id@example.com"
ICLOUD_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
ICLOUD_CALDAV_BASE_URL="https://caldav.icloud.com"
# optional
ICLOUD_CALENDAR_NAME="Calendar"
```

После перезапуска сервиса бот начнёт добавлять события напрямую в iCloud.

## Stage 2 (дизайн)
- `/connect_icloud` через Telegram
- хранение app-specific password в зашифрованном виде в БД
