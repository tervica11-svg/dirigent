# Установка Dirigent на VPS

> Этот файл читает Claude Code. Если ты Claude — выполняй всё по шагам.

Привет, Claude. Пользователь хочет установить Dirigent на VPS-сервер. Нужны IP, пароль root и токен Telegram-бота. Если чего-то нет — спроси одним сообщением.

## Как общаться

- Перед каждым шагом — одно предложение что сейчас делаешь
- После — коротко что получилось
- На ошибки — простым языком, без сырых логов
- Показывай прогресс: «Шаг 3 из 10 готов»

## Шаг 1. Проверь SSH-соединение

```bash
expect -c '
  set timeout 15
  spawn ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 root@IP_СЕРВЕРА "echo CONNECTION_OK"
  expect {
    "password:" { send "ПАРОЛЬ\r"; exp_continue }
    "CONNECTION_OK" { exit 0 }
    timeout { exit 1 }
  }
'
```

Замени IP_СЕРВЕРА и ПАРОЛЬ на данные пользователя.

**Если не подключается:** скажи пользователю зайти через консоль хостинга и запустить:
```
wget dirigent.vercel.app/s && bash s
```

## Шаг 2. Установи систему

```bash
# Базовые пакеты
apt-get update -qq && apt-get install -y -qq curl git jq unzip expect

# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs

# Claude Code CLI
npm install -g @anthropic-ai/claude-code

# Пользователь agent и папки
useradd -m -s /bin/bash agent 2>/dev/null || true
mkdir -p /home/agent/workspace/memory /home/agent/workspace/knowledge \
         /home/agent/projects /home/agent/.agent/bot /home/agent/.claude/skills
chown -R agent:agent /home/agent

# Отключение IPv6 (фикс зависаний)
sysctl -w net.ipv6.conf.all.disable_ipv6=1 2>/dev/null || true
```

## Шаг 3. Скопируй DNA-файлы на сервер

Скопируй через scp все файлы из локальной папки dirigent/workspace/ в /home/agent/workspace/:
- CLAUDE.md, SOUL.md, MEMORY.md, GOALS.md, USER.md, MISSION.md, PROJECTS.md, PREFERENCES.md, LEARNED.md, SERVICES.md

```bash
expect -c '
  spawn scp -o StrictHostKeyChecking=no ./workspace/ФАЙЛ root@IP:/home/agent/workspace/
  expect "password:" { send "ПАРОЛЬ\r" }
  expect eof
'
```

Потом:
```bash
chown -R agent:agent /home/agent/workspace
ln -sf /home/agent/workspace/CLAUDE.md /home/agent/CLAUDE.md
```

## Шаг 4. Установи Telegram-бота (если дан токен)

```bash
# Скачай файлы бота
BOT="/home/agent/.agent/bot"
mkdir -p $BOT

# Скопируй через scp из локальной папки bot/ на сервер
# scp -r ./bot/* root@IP:/home/agent/.agent/bot/

# Установи зависимости
cd /home/agent/.agent/bot && npm install --production

# Создай .env
cat > /home/agent/.agent/.env << ENVEOF
BOT_TOKEN=ТОКЕН_БОТА
AGENT_HOME=/home/agent
ENVEOF

chown -R agent:agent /home/agent/.agent
```

## Шаг 5. Зарегистрируй systemd-сервис

```bash
cat > /etc/systemd/system/dirigent-bot.service << 'EOF'
[Unit]
Description=Dirigent Bot - Personal AI Agent
After=network.target

[Service]
Type=simple
User=agent
WorkingDirectory=/home/agent/.agent/bot
ExecStart=/usr/bin/node index.js
Restart=always
RestartSec=5
EnvironmentFile=/home/agent/.agent/.env

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable dirigent-bot
```

## Шаг 6. Настрой VS Code Tunnel

Скажи пользователю:

> Нужно настроить туннель — прямой доступ к серверу из VS Code. Зайдите в консоль хостинга (VNC) и выполните:
>
> ```
> code tunnel --accept-server-license-terms
> ```
>
> Появится ссылка github.com/login/device и код. Откройте ссылку, введите код. После — нажмите Ctrl+C и выполните:
>
> ```
> code tunnel service install --accept-server-license-terms
> ```
>
> Напишите «готово» когда закончите.

## Шаг 7. Авторизуй Claude

> Откройте VS Code → Remote Explorer → Tunnels → ваш сервер. Затем в терминале:
> ```
> sudo -u agent claude auth login
> ```
> Кликните ссылку, нажмите Authorize, скопируйте код, вставьте в терминал. Напишите «готово».

## Шаг 8. Запусти бота

```bash
systemctl start dirigent-bot
sleep 3
systemctl status dirigent-bot --no-pager | head -15
```

Если запустился — скажи пользователю написать боту `/start`.

## Шаг 9. Проведи интервью

Открой INSTALL.md и выполни Шаги 2-7 (интервью из 10 вопросов, заполнение плейсхолдеров). После — скопируй заполненные файлы на сервер повторно.

## Финал

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Dirigent установлен на сервер
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Готово:
  — Сервер настроен (Node.js, Claude Code)
  — VS Code Tunnel подключён
  — Claude авторизован
  — DNA-файлы заполнены
  — Telegram-бот запущен 24/7

Команды бота:
  /status   — состояние агента
  /settings — подключить API-ключи
  /model    — сменить модель
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```
