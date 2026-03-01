# Qatar Early Warning System (EWS)

A real-time open-source intelligence dashboard that monitors threats to Doha and the Gulf region by aggregating signals from Telegram channels, RSS news feeds, and FAA NOTAM airspace data. It scores each item using English and Farsi keyword engines, detects pre-attack behavioral patterns from IRGC-linked sources, and displays everything on a dark military-style PWA dashboard.

---

## Table of Contents

1. [Requirements](#requirements)
2. [Project Structure](#project-structure)
3. [Installation](#installation)
4. [API Keys & Configuration](#api-keys--configuration)
   - [Telegram Bot](#1-telegram-bot)
   - [VAPID Keys (Push Notifications)](#2-vapid-keys-push-notifications)
   - [FAA NOTAM API](#3-faa-notam-api)
5. [RSS Feeds](#rss-feeds)
6. [Telegram Channels](#telegram-channels)
7. [Running the Server](#running-the-server)
8. [API Endpoints](#api-endpoints)
9. [Threat Scoring System](#threat-scoring-system)
10. [Behavioral Pattern Detection](#behavioral-pattern-detection)
11. [PWA Installation](#pwa-installation)
12. [Deployment](#deployment)

---

## Requirements

| Requirement | Version |
|-------------|---------|
| Node.js | ≥ 18.0.0 |
| npm | ≥ 9.0.0 |
| A Telegram Bot | Free — via @BotFather |
| FAA API credentials | Free — via api.faa.gov *(optional)* |

---

## Project Structure

```
ews-app/
├── backend/
│   ├── server.js          # Express server, all collectors, scoring engine
│   ├── package.json
│   ├── .env               # Your secrets — never commit this
│   └── .env.example       # Template — copy to .env and fill in
└── frontend/
    ├── index.html         # Single-file PWA dashboard
    ├── sw.js              # Service worker (offline + push notifications)
    └── manifest.json      # PWA manifest
```

---

## Installation

```bash
# 1. Clone the repo
git clone https://github.com/Paulnaan/ews-app.git
cd ews-app

# 2. Install backend dependencies
cd backend
npm install

# 3. Copy the environment template
cp .env.example .env

# 4. Generate VAPID keys for push notifications
npm run generate-vapid-keys
# Copy the two output values into .env

# 5. Fill in the rest of .env (see below)

# 6. Start the server
npm start
```

Open your browser at **http://localhost:3001**

---

## API Keys & Configuration

All configuration lives in `backend/.env`. Never commit this file — it is listed in `.gitignore`.

```env
PORT=3001

VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_EMAIL=

TELEGRAM_BOT_TOKEN=
TELEGRAM_CHANNELS=

FAA_CLIENT_ID=
FAA_CLIENT_SECRET=
```

---

### 1. Telegram Bot

The server uses the Telegram Bot API to read messages posted to monitored channels. The bot must be added as an **administrator** to each channel you want to monitor.

#### Step 1 — Create a bot

1. Open Telegram and search for **@BotFather**
2. Send `/newbot`
3. Choose a name (e.g. `EWS Monitor`) and a username (e.g. `ews_monitor_bot`)
4. BotFather will reply with a token like `8313343723:AAHcvN7YXX0MXUDrcKDtA4mK2vc78uoTwu4`
5. Copy this into `.env`:

```env
TELEGRAM_BOT_TOKEN=8313343723:AAHcvN7YXX0MXUDrcKDtA4mK2vc78uoTwu4
```

#### Step 2 — Add bot to channels

For **each channel** you want to monitor:
1. Open the channel in Telegram
2. Go to **Manage Channel → Administrators → Add Administrator**
3. Search for your bot's username and add it
4. The only permission it needs is **Read Messages** (all others can be disabled)

> **Important:** If the bot is not an admin of a channel, it will not receive that channel's posts. Public channels can be monitored by username; private channels require admin access.

#### Step 3 — Set channel list

Add a comma-separated list of channel usernames (with `@`) to `.env`:

```env
TELEGRAM_CHANNELS=@Sepah_Pasdaran,@khamenei_ir,@tasnimnewsen,@mehrnews_en,@PressTV,@IranIntl_En,@YemenMilitary_,@intelslava,@Middle_East_Spectator
```

> **Note:** The following IRGC-linked channels are hardcoded in `server.js` and monitored automatically regardless of `.env`:
> `@IRGCoperations`, `@sepah_news`, `@farsna`, `@jamnews`, `@rajanews`, `@mashreghnews`, `@tasnim_military`, `@defapress`

---

### 2. VAPID Keys (Push Notifications)

VAPID keys let the server send browser push notifications when the threat level escalates.

#### Generate keys

```bash
cd backend
npm run generate-vapid-keys
```

Output will look like:

```
Public Key:  BHYLAh3jh_pExA26n34nBi20X4V6_...
Private Key: EM7-F1UY6-VTtxVceQRT_cWaV-...
```

Copy both into `.env`:

```env
VAPID_PUBLIC_KEY=BHYLAh3jh_pExA26n34nBi20X4V6_...
VAPID_PRIVATE_KEY=EM7-F1UY6-VTtxVceQRT_cWaV-...
VAPID_EMAIL=mailto:you@example.com
```

- `VAPID_EMAIL` must be a real address in `mailto:` format — it is included in push requests so browser vendors can contact you if needed.
- Push notifications are optional. The server runs fully without them.

---

### 3. FAA NOTAM API

The server queries the FAA Digital NOTAM API for airspace notices covering four ICAO regions critical to the Gulf:

| ICAO Code | Region |
|-----------|--------|
| `OIIX` | Tehran FIR (Iran) |
| `OIKK` | Kerman FIR (Iran) |
| `OIGG` | Isfahan FIR (Iran) |
| `OTBD` | Doha / Qatar |

#### Get free credentials

1. Go to **https://api.faa.gov**
2. Click **Sign Up** and create a free developer account
3. After verifying your email, click **Register Application**
4. Give it any name (e.g. `EWS Monitor`)
5. Copy the **Client ID** and **Client Secret** into `.env`:

```env
FAA_CLIENT_ID=your_client_id_here
FAA_CLIENT_SECRET=your_client_secret_here
```

> **Optional:** If these are left blank, the server skips NOTAM collection and logs `FAA credentials not configured, skipping NOTAM collection` at startup. All other features work normally.

---

## RSS Feeds

The following feeds are monitored automatically — no configuration required:

| Feed | Language | Source Type | URL |
|------|----------|-------------|-----|
| Al Jazeera | English | Independent | `aljazeera.com/xml/rss/all.xml` |
| BBC Middle East | English | Independent | `bbci.co.uk/news/world/middle_east/rss.xml` |
| Tasnim News | English | Iranian state | `tasnimnews.ir/en/rss/feed/0/0/0/0/AllStories` |
| PressTV | English | Iranian state | `presstv.ir/rss.xml` |
| Iran International | Farsi | Opposition | `iranintl.com/feed` |
| Tasnim News | Farsi | IRGC-linked | `tasnimnews.ir/fa/rss/feed/0/0/0/0/AllStories` |
| Defapress | Farsi | IRGC-linked | `defapress.ir/fa/rss/allnews` |
| Farda News | Farsi | IRGC-linked | `fardanews.com/feeds` |
| Qatar News Agency | English | Official | `qna.org.qa/en/Pages/RSS-Feeds/Qatar` |

---

## Telegram Channels

### Channels configured via `.env` (customisable)

| Channel | Focus |
|---------|-------|
| `@Sepah_Pasdaran` | IRGC official |
| `@khamenei_ir` | Supreme Leader's office |
| `@tasnimnewsen` | Tasnim News English |
| `@mehrnews_en` | Mehr News English |
| `@PressTV` | Iranian state media English |
| `@IranIntl_En` | Iran International English |
| `@YemenMilitary_` | Houthi / Yemeni military |
| `@intelslava` | OSINT / Intel aggregator |
| `@Middle_East_Spectator` | ME analysis |

### IRGC channels hardcoded in `server.js` (always monitored)

| Channel | Focus |
|---------|-------|
| `@IRGCoperations` | IRGC operations |
| `@sepah_news` | IRGC news |
| `@farsna` | Fars News Agency |
| `@jamnews` | Jam News (hardliner) |
| `@rajanews` | Raja News (hardliner) |
| `@mashreghnews` | Mashregh News (hardliner) |
| `@tasnim_military` | Tasnim military desk |
| `@defapress` | Defense Press (IRGC-linked) |

### Proxy / silence-watch channels

These channels are specifically monitored for **posting silence** — a sudden drop in activity can indicate pre-operation communications blackout:

| Channel | Focus |
|---------|-------|
| `@YemenMilitary_` | Houthi / Yemen military |
| `@intelslava` | Iraqi militia / broader OSINT |

---

## Running the Server

```bash
# Production
cd backend
npm start

# Development (auto-restart on file changes)
npm run dev
```

The server:
- Starts on `http://localhost:3001` (or `PORT` from `.env`)
- Serves the frontend dashboard at `/`
- Runs the first data collection immediately on startup
- Polls all sources every **5 minutes** via cron

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/status` | Threat level, counts, behavioral summary, recent errors |
| `GET` | `/api/signals?limit=N` | All signals sorted by score (max 500) |
| `GET` | `/api/feeds?limit=N` | RSS feed items only (max 200) |
| `GET` | `/api/notams` | Active FAA NOTAMs for monitored regions |
| `GET` | `/api/iran-intel` | Behavioral scores, channel activity map, Farsi keyword timeline |
| `GET` | `/api/vapid-public-key` | VAPID public key for push subscription setup |
| `POST` | `/api/subscribe` | Register a push notification subscription |
| `POST` | `/api/refresh` | Trigger an immediate out-of-cycle data collection |

---

## Threat Scoring System

Each signal (RSS item or Telegram message) is scored using two independent keyword engines.

### English Keywords

| Tier | Points | Example Terms |
|------|--------|---------------|
| Critical | +10 | missile, ballistic, airstrike, nuclear, invasion, evacuation |
| High | +5 | airspace closure, intercept, warship, drone attack, retaliation |
| Medium | +2 | military exercise, warning, sanctions, tension, unrest |
| Low | +1 | iran, qatar, doha, irgc, hezbollah, houthi, persian gulf |

### Farsi Keywords

| Tier | Points | Example Terms |
|------|--------|---------------|
| Critical | +15 | پاسخ قاطع, موشک بالستیک, حمله به قطر, العدید |
| High | +8 | آماده‌باش, عملیات, پاسخ سخت, بدون محدودیت, موشک |
| Medium | +4 | تهدید, اقدام نظامی, سپاه, خامنه‌ای, مقاومت |
| Low | +2 | آمریکا, اسرائیل, صهیونیست, خلیج فارس |

IRGC-sourced content receives a baseline **+2** regardless of keywords.

### Threat Level Thresholds

| Level | Condition |
|-------|-----------|
| 🟢 GREEN | Max score < 5 and total < 25 |
| 🟡 YELLOW | Max score ≥ 5 or total ≥ 25 |
| 🟠 ORANGE | Max score ≥ 12 or total ≥ 60 |
| 🔴 RED | Max score ≥ 25 or total ≥ 120 |

The aggregate behavioral score from pattern detection is added to the total before calculating the threat level.

---

## Behavioral Pattern Detection

The server runs three independent pre-attack behavioral detectors on every collection cycle.

### 1. Proxy Silence (+5 points)
Triggered when `@YemenMilitary_` or `@intelslava` post fewer than **30% of their 24-hour average** over the last 2 hours. A sudden drop in proxy channel activity can indicate a communications blackout ahead of an operation.

### 2. Escalatory Rhetoric (+6 points)
Triggered when **3 or more** Farsi critical or high-tier keyword hits appear across all sources within the last **1 hour**. Tracks the specific terms and times in the Farsi keyword timeline.

### 3. Coordinated Messaging (+7 points)
Triggered when **3 or more** IRGC-linked Telegram channels post content with a **Jaccard similarity ≥ 0.25** within the same **30-minute window**. Coordinated messaging across multiple IRGC accounts can indicate a directed information operation ahead of military activity.

### Pre-Attack Status

| Status | Behavioral Score |
|--------|-----------------|
| NORMAL | 0–4 |
| WATCH | 5–9 |
| ELEVATED | 10–14 |
| CRITICAL | 15+ |

---

## PWA Installation

The dashboard can be installed as a standalone app on any device:

- **Desktop (Chrome/Edge):** Click the install icon in the address bar
- **iPhone/iPad:** Safari → Share → Add to Home Screen
- **Android:** Chrome → menu → Add to Home Screen

Once installed:
- Runs fullscreen with no browser chrome
- Works offline (shows cached dashboard and last-known threat level)
- Receives push notifications when threat level escalates (if enabled)

### Icons required for full PWA support

Create and place these files in `frontend/`:

| File | Size | Usage |
|------|------|-------|
| `icon-72.png` | 72×72 | Push notification badge |
| `icon-192.png` | 192×192 | Home screen icon |
| `icon-512.png` | 512×512 | Splash screen / store listing |

Use a dark background (`#050d1a`) with the EWS logo centred in the middle 80% of the canvas so the maskable safe zone is not clipped on Android.

---

## Deployment

The server can be deployed anywhere Node.js runs. Set the environment variables on the host rather than uploading `.env`.

### Recommended: systemd service (Linux VPS)

```ini
[Unit]
Description=Qatar EWS Backend
After=network.target

[Service]
WorkingDirectory=/opt/ews-app/backend
ExecStart=/usr/bin/node server.js
Restart=always
Environment=NODE_ENV=production
EnvironmentFile=/opt/ews-app/backend/.env

[Install]
WantedBy=multi-user.target
```

### Quick options

| Platform | Notes |
|----------|-------|
| **Railway** | Connect GitHub repo, set env vars in dashboard, auto-deploys on push |
| **Render** | Free tier, set env vars in dashboard, connect repo |
| **DigitalOcean App Platform** | Connect repo, set env vars, scales easily |
| **VPS (any)** | Run with `pm2 start server.js` for auto-restart |

### Reverse proxy (nginx example)

```nginx
server {
    listen 80;
    server_name yourdomain.com;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Add SSL with `certbot --nginx -d yourdomain.com` for HTTPS (required for push notifications and PWA installation).

---

## Security Notes

- Keep `.env` out of version control — it is in `.gitignore` by default
- Rotate your Telegram bot token if it is ever exposed
- VAPID private key should be treated like a password — regenerate if compromised (`npm run generate-vapid-keys`)
- FAA credentials can be regenerated at api.faa.gov if needed
- For production, run behind HTTPS — push notifications and service workers require a secure origin
