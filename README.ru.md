# Obsidian AI Assistant

[English](./README.md) · **Русский**

Локальный AI-чат с tool calling для вашего Obsidian-хранилища. Работает с любым OpenAI-совместимым endpoint'ом — [vLLM](https://github.com/vllm-project/vllm), [llama.cpp](https://github.com/ggerganov/llama.cpp), [LM Studio](https://lmstudio.ai), [Ollama](https://ollama.com) (через его OpenAI-совместимый API) или внешним сервисом в духе OpenAI — и даёт модели возможность читать, писать и искать в ваших заметках.

> Весь инференс можно оставить локальным. Никакие данные не покидают vault, если вы не указали удалённый endpoint.

---

## Возможности

- **Стриминг-чат** в правой панели, с рендерингом Markdown и `[[wikilinks]]`
- **Tool calling** — модель действует в vault:
  - `list_files`, `read_file`, `write_file`, `edit_file`, `append_to_file`, `delete_file`
  - `search` (с опциональным `ripgrep` для скорости)
  - `get_backlinks`, `get_outlinks`, `get_tags`
- **Контекст активной заметки** — открытая заметка автоматически подкидывается в системное сообщение
- **Автосуммаризация истории** при превышении порога токенов
- **Тогглы на каждый инструмент** — можно отключить любую операцию
- **Безопасно по дизайну** — все пути нормализуются и не выходят за пределы vault; `delete_file` идёт в системную корзину, никогда не permanent
- **Редактируемый системный промпт** — есть разумный дефолт, можно полностью переписать; кнопка сброса к дефолту в настройках

---

## Установка

### Вариант A — вручную из GitHub Releases (рекомендуется)

1. Откройте [Releases](https://github.com/cop1cat/obsidian-ai-assistant/releases) и скачайте из последнего релиза:
   - `main.js`
   - `manifest.json`
   - `styles.css`
2. Создайте папку `<vault>/.obsidian/plugins/obsidian-ai-assistant/` и положите туда эти три файла.
3. В Obsidian: **Settings → Community plugins → Reload plugins**, затем включите **AI Assistant**.

### Вариант B — из исходников (свежий `main`)

Нужен Node 18+ и [pnpm](https://pnpm.io/).

```bash
git clone https://github.com/cop1cat/obsidian-ai-assistant.git
cd obsidian-ai-assistant
pnpm install
pnpm run build
```

Скопируйте или сделайте симлинк сборки в vault:

```bash
# Замените /path/to/vault на путь к вашему хранилищу.
mkdir -p /path/to/vault/.obsidian/plugins/obsidian-ai-assistant
ln -sf "$(pwd)/main.js"       /path/to/vault/.obsidian/plugins/obsidian-ai-assistant/main.js
ln -sf "$(pwd)/manifest.json" /path/to/vault/.obsidian/plugins/obsidian-ai-assistant/manifest.json
ln -sf "$(pwd)/styles.css"    /path/to/vault/.obsidian/plugins/obsidian-ai-assistant/styles.css
```

Затем в Obsidian: **Settings → Community plugins → Reload plugins**, и включите **AI Assistant**.

### Вариант C — через BRAT

Если у вас стоит плагин [BRAT](https://github.com/TfTHacker/obsidian42-brat):

1. BRAT settings → **Add Beta plugin**
2. Вставьте: `cop1cat/obsidian-ai-assistant`
3. Включите плагин в **Settings → Community plugins**

BRAT будет сам обновлять плагин при выходе новых релизов.

---

## Настройка

Откройте **Settings → AI Assistant**:

| Настройка | По умолчанию | Комментарий |
|---|---|---|
| **Base URL** | `http://localhost:8000/v1` | OpenAI-совместимый endpoint. Для Ollama — `http://localhost:11434/v1`. |
| **API key** | `EMPTY` | Локальные сервера обычно принимают любое непустое значение. |
| **Model** | _(пусто — обязательно)_ | Имя модели, как его отдаёт endpoint (например `Qwen/Qwen2.5-7B-Instruct`). |
| **Temperature / Top-p** | `0.7` / `1.0` | Стандартные сэмплинг-параметры. |
| **Max context tokens** | `100000` | История суммаризуется при превышении этого порога. |
| **System prompt** | разумный дефолт | Содержит правила работы с vault; можно редактировать целиком. Рядом кнопка «сбросить к дефолту». |
| **Include active note in context** | `true` | Путь и содержимое активной заметки добавляются к системному сообщению. |
| **ripgrep path** | _(пусто)_ | Опционально. Укажите путь к `rg` (например `/opt/homebrew/bin/rg`) для быстрого поиска. |
| **Enabled tools** | все включены | Можно отключить любой инструмент, чтобы модель не могла его вызвать. |

Открыть чат: иконка бота в левом ribbon, либо команда **AI Assistant: Open AI Chat** из command palette.

---

## Быстрый старт с vLLM

```bash
# В одном терминале — поднимаем модель:
pip install vllm
vllm serve Qwen/Qwen2.5-7B-Instruct --port 8000
```

В настройках плагина:

- Base URL: `http://localhost:8000/v1`
- API key: `EMPTY`
- Model: `Qwen/Qwen2.5-7B-Instruct`

Открывайте чат, спросите: _«Перечисли папки верхнего уровня в моём vault и опиши, что в каждой»._

---

## Как работает tool calling

На каждое сообщение пользователя плагин запускает агентный цикл:

1. Отправляет историю (плюс системный промпт с правилами безопасности vault) модели.
2. Если в ответе есть `tool_calls` — выполняет каждый вызов локально через Obsidian API.
3. Дописывает результаты как `role: "tool"` и снова идёт к модели.
4. Останавливается, когда модель вернула ответ без tool calls.

Жёсткий лимит: **20 итераций** на ход. В системном промпте по умолчанию модель инструктируется читать перед редактированием, не выдумывать пути и следовать конвенциям именования вашего vault.

### Что вы увидите в чате

Tool calls показываются свёрнутыми блоками над текстом ассистента:

```
✅ 🔧 read_file(path: "Daily/2026-05-19.md")
   ▶ Кликните, чтобы развернуть аргументы и результат
```

Во время стриминга у текста мигает курсор.

---

## Системный промпт

Полностью редактируется в настройках. Дефолт включает:

- Роль ассистента в vault Obsidian
- Правила работы с путями (относительные, никаких `..`)
- Обязательное чтение файла перед редактированием/перезаписью
- Запрет выдумывать пути — использовать `list_files`/`search`
- Использование `[[wikilinks]]` в ответах

Если переписали и хотите вернуться — кнопка «↺» рядом с полем сбрасывает к дефолту.

---

## Разработка

```bash
pnpm install
pnpm run dev        # esbuild watch → main.js
pnpm run typecheck  # строгая проверка TS
pnpm run build      # typecheck + production-бандл
```

Smoke-тест (загружает бандл как Obsidian, с моком `require("obsidian")`):

```bash
node scripts/smoke-load.mjs
```

Для разработки: симлинк репо в тестовый vault (см. Вариант B) и `pnpm run dev`. После каждой пересборки **Cmd+R** в Obsidian — или поставьте плагин [Hot Reload](https://github.com/pjeby/hot-reload).

Структура проекта:

```
src/
  main.ts                 точка входа плагина, ribbon, команда, регистрация view
  settings.ts             настройки + SettingTab + рантайм-валидация конфига
  view/
    ChatView.ts           ItemView в правой панели
    MessageRenderer.ts    markdown-рендеринг + свёрнутые tool calls
  llm/
    client.ts             обёртка над OpenAI SDK, стриминг
    agent.ts              цикл tool calling
    summarizer.ts         сжатие истории
    tokenizer.ts          обёртка js-tiktoken
    types.ts              ChatMessage, ToolCall, UI-типы
  tools/
    index.ts              реестр инструментов
    list_files.ts, read_file.ts, write_file.ts, edit_file.ts,
    append_to_file.ts, delete_file.ts, search.ts,
    get_backlinks.ts, get_outlinks.ts, get_tags.ts
  utils/
    paths.ts              нормализация путей + защита от выхода за vault
```

---

## Безопасность

- **Пути**: все аргументы инструментов проходят через `normalizePath`; абсолютные пути и `..` отвергаются. Инструменты видят только пути внутри vault.
- **Удаление**: `delete_file` всегда через `vault.trash(file, true)` — системная корзина, восстановимо. Никогда не permanent.
- **Сеть**: единственные исходящие запросы — на Base URL из настроек. Укажите `localhost` — и всё останется офлайн.
- **Тогглы инструментов**: каждый инструмент можно выключить. Отключите `write_file`, `edit_file`, `delete_file`, `append_to_file` — получите read-only ассистента.

---

## Лицензия

MIT — см. [LICENSE](./LICENSE).
