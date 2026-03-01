require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const axios   = require('axios');
const RSSParser = require('rss-parser');
const cron    = require('node-cron');
const webpush = require('web-push');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3001;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// ─── Web Push ─────────────────────────────────────────────────────────────────
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    `mailto:${process.env.VAPID_EMAIL || 'admin@ews.local'}`,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
} else {
  console.warn('VAPID keys not set — push notifications disabled.');
}

// ═══════════════════════════════════════════════════════════════
// RSS SOURCES
// ═══════════════════════════════════════════════════════════════
const RSS_FEEDS = [
  // English-language mainstream
  { name: 'Al Jazeera',         url: 'https://www.aljazeera.com/xml/rss/all.xml',                              lang: 'en' },
  { name: 'BBC Middle East',    url: 'https://feeds.bbci.co.uk/news/world/middle_east/rss.xml',                lang: 'en' },
  // Iranian state / IRGC-linked English
  { name: 'Tasnim News (EN)',   url: 'https://tasnimnews.ir/en/rss/feed/0/0/0/0/AllStories',                   lang: 'en' },
  { name: 'PressTV',            url: 'https://www.presstv.ir/rss.xml',                                         lang: 'en' },
  { name: 'Iran International', url: 'https://www.iranintl.com/feed',                                          lang: 'fa' },
  // Iranian state / IRGC-linked Farsi
  { name: 'Tasnim News (FA)',   url: 'https://tasnimnews.ir/fa/rss/feed/0/0/0/0/AllStories',                   lang: 'fa', irgc: true },
  { name: 'Defapress (FA)',     url: 'https://defapress.ir/fa/rss/allnews',                                    lang: 'fa', irgc: true },
  { name: 'Farda News (FA)',    url: 'https://www.fardanews.com/feeds',                                        lang: 'fa', irgc: true },
  // Gulf / Qatar — feed omits version="2.0", use fixXml flag to patch before parsing
  { name: 'Qatar News Agency',  url: 'https://qna.org.qa/en/Pages/RSS-Feeds/Qatar',                           lang: 'en', fixXml: true },
];

// ═══════════════════════════════════════════════════════════════
// TELEGRAM CHANNEL GROUPS
// ═══════════════════════════════════════════════════════════════
// Channels configured via .env (general monitoring)
const ENV_CHANNELS = (process.env.TELEGRAM_CHANNELS || '')
  .split(',').map(c => c.trim()).filter(Boolean);

// IRGC-linked and Iranian hardliner channels (hardcoded — always monitored)
const IRGC_CHANNELS = [
  '@IRGCoperations',
  '@sepah_news',
  '@farsna',
  '@jamnews',
  '@rajanews',
  '@mashreghnews',
  '@tasnim_military',
  '@defapress',
];

// Proxy / militia channels to watch for silence
const PROXY_CHANNELS = new Set([
  '@YemenMilitary_',
  '@intelslava',       // also tracks Iraqi militia
]);

// All unique channels to monitor
const ALL_CHANNELS = [...new Set([...ENV_CHANNELS, ...IRGC_CHANNELS])];

// ═══════════════════════════════════════════════════════════════
// FAA NOTAM
// ═══════════════════════════════════════════════════════════════
// OIIX = Tehran FIR, OIKK = Kerman FIR, OIGG = Isfahan FIR, OTBD = Doha
const NOTAM_REGIONS  = ['OIIX', 'OIKK', 'OIGG', 'OTBD'];
const FAA_CONFIGURED = !!(process.env.FAA_CLIENT_ID && process.env.FAA_CLIENT_SECRET);

// ═══════════════════════════════════════════════════════════════
// ENGLISH KEYWORD SCORING
// ═══════════════════════════════════════════════════════════════
const EN_KEYWORDS = {
  critical: {
    score: 10,
    terms: [
      'missile', 'ballistic', 'airstrike', 'air strike', 'bomb', 'bombing',
      'explosion', 'nuclear', 'attack', 'war declared', 'invasion', 'evacuation',
    ],
  },
  high: {
    score: 5,
    terms: [
      'military strike', 'airspace closure', 'airspace closed', 'intercept',
      'warship', 'fighter jet', 'drone attack', 'troops deployed', 'conflict',
      'armed forces', 'offensive', 'retaliation', 'threat level',
    ],
  },
  medium: {
    score: 2,
    terms: [
      'military exercise', 'drill', 'warning', 'alert', 'tension', 'protest',
      'sanctions', 'embargo', 'detained', 'arrested', 'demonstration', 'unrest',
    ],
  },
  low: {
    score: 1,
    terms: [
      'iran', 'qatar', 'doha', 'gulf', 'persian gulf', 'strait of hormuz',
      'irgc', 'revolutionary guard', 'hamas', 'hezbollah', 'houthi', 'proxy',
    ],
  },
};

// ═══════════════════════════════════════════════════════════════
// FARSI KEYWORD SCORING ENGINE
// ═══════════════════════════════════════════════════════════════
const FA_KEYWORDS = {
  critical: {
    score: 15,
    terms: [
      'پاسخ قاطع',      // decisive response
      'عملیات مرگ',     // death operation
      'موشک بالستیک',   // ballistic missile
      'حمله به قطر',    // attack on Qatar
      'العدید',         // Al Udeid (US airbase in Qatar — Arabic loanword used in Farsi media)
      'الأمريكي',       // the American (Arabic form used in IRGC communiqués)
    ],
  },
  high: {
    score: 8,
    terms: [
      'آماده‌باش',       // on alert / ready
      'عملیات',         // operation
      'پاسخ سخت',       // hard response
      'بدون محدودیت',   // without limits / gloves off
      'لحظه مناسب',     // the right moment
      'گزینه‌های روی میز', // options on the table
      'در زمان مناسب', // at the appropriate time
      'موشک',           // missile
    ],
  },
  medium: {
    score: 4,
    terms: [
      'پاسخ',           // response / answer
      'تهدید',          // threat
      'اقدام نظامی',    // military action
      'سپاه',           // IRGC (Corps)
      'خامنه‌ای',        // Khamenei
      'مقاومت',         // resistance (axis of)
      'محور',           // axis (of resistance)
    ],
  },
  low: {
    score: 2,
    terms: [
      'آمریکا',         // America
      'اسرائیل',        // Israel
      'صهیونیست',       // Zionist
      'خلیج فارس',      // Persian Gulf
      'منطقه',          // the region
    ],
  },
};

function scoreEnglish(text) {
  if (!text) return 0;
  const lower = text.toLowerCase();
  let score   = 0;
  for (const { score: pts, terms } of Object.values(EN_KEYWORDS)) {
    for (const term of terms) {
      if (lower.includes(term)) score += pts;
    }
  }
  return score;
}

function scoreFarsi(text) {
  if (!text) return { score: 0, hits: [] };
  let score = 0;
  const hits = [];
  for (const [tier, { score: pts, terms }] of Object.entries(FA_KEYWORDS)) {
    for (const term of terms) {
      if (text.includes(term)) {
        score += pts;
        hits.push({ term, tier, pts });
      }
    }
  }
  return { score, hits };
}

function scoreText(text, lang = 'en', isIrgc = false) {
  const enScore = scoreEnglish(text);
  const { score: faScore } = scoreFarsi(text);
  // IRGC-sourced content gets a baseline +2 regardless of keywords
  return enScore + faScore + (isIrgc ? 2 : 0);
}

// ═══════════════════════════════════════════════════════════════
// BEHAVIORAL BASELINE TRACKER
// ═══════════════════════════════════════════════════════════════
// channelTimestamps: Map<channelName, number[]> — unix ms timestamps of posts
const channelTimestamps = new Map();

// farsiCriticalHits: array of { term, timestamp } — rolling window
const farsiCriticalHits = [];

// recentIrgcPosts: array of { channel, text, timestamp } — for coordination detection
const recentIrgcPosts   = [];

const MS_1H  = 60 * 60 * 1000;
const MS_2H  = 2  * MS_1H;
const MS_24H = 24 * MS_1H;
const MS_30M = 30 * 60 * 1000;

function recordChannelPost(channel, timestampMs, text = '') {
  // Update timestamps ring
  if (!channelTimestamps.has(channel)) channelTimestamps.set(channel, []);
  const times = channelTimestamps.get(channel);
  times.push(timestampMs);
  // Prune to 24 h window
  const cutoff = Date.now() - MS_24H;
  channelTimestamps.set(channel, times.filter(t => t > cutoff));

  // Record Farsi critical hits
  const { hits } = scoreFarsi(text);
  for (const hit of hits) {
    if (hit.tier === 'critical' || hit.tier === 'high') {
      farsiCriticalHits.push({ term: hit.term, pts: hit.pts, timestamp: timestampMs });
    }
  }

  // Record IRGC post for coordination detection
  if (IRGC_CHANNELS.includes(channel)) {
    recentIrgcPosts.push({ channel, text, timestamp: timestampMs });
  }
}

function pruneOldData() {
  const now = Date.now();
  // Prune Farsi hits older than 1 h
  const h1 = now - MS_1H;
  while (farsiCriticalHits.length && farsiCriticalHits[0].timestamp < h1) {
    farsiCriticalHits.shift();
  }
  // Prune IRGC coordination window to 30 min
  const m30 = now - MS_30M;
  while (recentIrgcPosts.length && recentIrgcPosts[0].timestamp < m30) {
    recentIrgcPosts.shift();
  }
}

// 24-h post rate (posts per hour) for a channel
function get24hRate(channel) {
  const times = channelTimestamps.get(channel) || [];
  const cutoff = Date.now() - MS_24H;
  const recent = times.filter(t => t > cutoff);
  return recent.length / 24; // posts per hour
}

// Posts in last N ms
function getRecentCount(channel, windowMs) {
  const times = channelTimestamps.get(channel) || [];
  const cutoff = Date.now() - windowMs;
  return times.filter(t => t > cutoff).length;
}

// Simple word-set Jaccard similarity [0-1]
function textSimilarity(a, b) {
  if (!a || !b) return 0;
  const setA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  const setB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  if (!setA.size || !setB.size) return 0;
  const intersection = [...setA].filter(w => setB.has(w)).length;
  const union = new Set([...setA, ...setB]).size;
  return intersection / union;
}

// ═══════════════════════════════════════════════════════════════
// PRE-ATTACK BEHAVIORAL PATTERN DETECTOR
// ═══════════════════════════════════════════════════════════════
function detectBehavioralPatterns() {
  pruneOldData();
  const now = Date.now();

  // ── 1. Proxy Silence Score ──────────────────────────────────
  // If Houthi/Iraqi proxy channels drop 70%+ vs 24h average → +5
  let proxySilenceScore = 0;
  const proxySilenceDetails = [];

  for (const channel of PROXY_CHANNELS) {
    const rate24h   = get24hRate(channel);          // posts/hr avg
    const last2h    = getRecentCount(channel, MS_2H); // actual last 2h
    const expected  = rate24h * 2;                  // expected in 2h

    if (expected >= 1 && last2h < expected * 0.3) { // silence = <30% of expected
      proxySilenceScore += 5;
      proxySilenceDetails.push({
        channel,
        expected: parseFloat(expected.toFixed(1)),
        actual: last2h,
        dropPct: Math.round((1 - last2h / expected) * 100),
      });
    }
  }

  // ── 2. Escalatory Rhetoric Score ───────────────────────────
  // 3+ Farsi critical/high keyword hits in last 1 hour → +6
  let escalatoryRhetoricScore = 0;
  const recentFarsiHits = farsiCriticalHits.filter(h => h.timestamp > now - MS_1H);
  if (recentFarsiHits.length >= 3) escalatoryRhetoricScore = 6;

  // ── 3. Coordinated Messaging Score ─────────────────────────
  // 3+ IRGC channels with similar content in last 30 min → +7
  let coordinatedMessagingScore = 0;
  const coordinationDetails = [];

  // Group recent IRGC posts by channel (dedup per channel)
  const byChannel = {};
  for (const post of recentIrgcPosts) {
    if (!byChannel[post.channel]) byChannel[post.channel] = post.text;
  }
  const channelList  = Object.keys(byChannel);
  const channelTexts = Object.values(byChannel);

  if (channelList.length >= 3) {
    // Check if any 3+ channels share similar content (Jaccard ≥ 0.25)
    let coordinated = 0;
    for (let i = 0; i < channelTexts.length; i++) {
      let similar = 1;
      for (let j = i + 1; j < channelTexts.length; j++) {
        if (textSimilarity(channelTexts[i], channelTexts[j]) >= 0.25) similar++;
      }
      if (similar >= 3) {
        coordinated = similar;
        break;
      }
    }
    if (coordinated >= 3) {
      coordinatedMessagingScore = 7;
      coordinationDetails.push({
        channelsInvolved: channelList,
        matchCount: coordinated,
        windowMinutes: 30,
      });
    }
  }

  const totalBehavioralScore = proxySilenceScore + escalatoryRhetoricScore + coordinatedMessagingScore;

  return {
    totalBehavioralScore,
    proxySilence: {
      score:     proxySilenceScore,
      triggered: proxySilenceScore > 0,
      details:   proxySilenceDetails,
    },
    escalatoryRhetoric: {
      score:            escalatoryRhetoricScore,
      triggered:        escalatoryRhetoricScore > 0,
      keywordHitsLastHour: recentFarsiHits.length,
      topTerms:         [...new Set(recentFarsiHits.map(h => h.term))].slice(0, 8),
    },
    coordinatedMessaging: {
      score:     coordinatedMessagingScore,
      triggered: coordinatedMessagingScore > 0,
      details:   coordinationDetails,
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// THREAT LEVEL CALCULATION (includes behavioral bonus)
// ═══════════════════════════════════════════════════════════════
function calculateThreatLevel(items, behavioralScore = 0) {
  if (!items.length && behavioralScore === 0) return 'GREEN';
  const scores = items.map(i => i.score || 0);
  const total  = scores.reduce((a, b) => a + b, 0) + behavioralScore;
  const max    = scores.length ? Math.max(...scores) : 0;

  if (max >= 25 || total >= 120) return 'RED';
  if (max >= 12 || total >= 60)  return 'ORANGE';
  if (max >= 5  || total >= 25)  return 'YELLOW';
  return 'GREEN';
}

// ═══════════════════════════════════════════════════════════════
// IN-MEMORY STATE
// ═══════════════════════════════════════════════════════════════
const state = {
  feeds:             [],
  notams:            [],
  signals:           [],
  threatLevel:       'GREEN',
  lastUpdated:       null,
  subscribers:       [],
  errors:            [],
  behavioralPatterns: null,
  channelActivityMap: {},
  farsiKeywordTimeline: [],
};

// ═══════════════════════════════════════════════════════════════
// COLLECTORS
// ═══════════════════════════════════════════════════════════════
const rssParser = new RSSParser({ timeout: 12000 });

async function collectRSSFeeds() {
  const items = [];
  for (const feed of RSS_FEEDS) {
    try {
      let result;
      if (feed.fixXml) {
        // Fetch raw XML, patch missing version attribute, then parse as string
        const raw = await axios.get(feed.url, { timeout: 12000, responseType: 'text' });
        const patched = raw.data.replace(/^<rss(\s)/, '<rss version="2.0"$1');
        result = await rssParser.parseString(patched);
      } else {
        result = await rssParser.parseURL(feed.url);
      }
      for (const item of (result.items || []).slice(0, 25)) {
        const text  = `${item.title || ''} ${item.contentSnippet || item.summary || ''}`;
        const score = scoreText(text, feed.lang, !!feed.irgc);
        items.push({
          id:        item.guid || item.link || `${feed.name}-${item.title}`,
          source:    feed.name,
          type:      'rss',
          lang:      feed.lang || 'en',
          irgc:      !!feed.irgc,
          title:     item.title || '(no title)',
          summary:   item.contentSnippet || item.summary || '',
          url:       item.link || null,
          published: item.pubDate || item.isoDate || new Date().toISOString(),
          score,
          collected: new Date().toISOString(),
        });

        // Feed Farsi hit tracker for IRGC sources
        if (feed.irgc) {
          const { hits } = scoreFarsi(text);
          for (const hit of hits) {
            if (hit.tier === 'critical' || hit.tier === 'high') {
              farsiCriticalHits.push({ term: hit.term, pts: hit.pts, timestamp: Date.now() });
            }
          }
        }
      }
    } catch (err) {
      console.error(`RSS [${feed.name}]: ${err.message}`);
      state.errors.push({ time: new Date().toISOString(), source: feed.name, error: err.message });
    }
  }
  return items;
}

async function collectTelegram() {
  if (!process.env.TELEGRAM_BOT_TOKEN) return [];
  if (!ALL_CHANNELS.length) return [];

  const items = [];
  try {
    const res = await axios.get(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getUpdates`,
      {
        params:  { limit: 100, allowed_updates: JSON.stringify(['channel_post']) },
        timeout: 10000,
      }
    );

    if (res.data.ok) {
      for (const update of res.data.result || []) {
        const msg = update.channel_post;
        if (!msg) continue;

        const text      = msg.text || msg.caption || '';
        const chatName  = msg.chat?.username ? `@${msg.chat.username}` : String(msg.chat?.id || '');
        const isIrgc    = IRGC_CHANNELS.includes(chatName);
        const isProxy   = PROXY_CHANNELS.has(chatName);
        const tsMs      = msg.date * 1000;
        const score     = scoreText(text, 'fa', isIrgc);

        // Record for behavioral tracking
        recordChannelPost(chatName, tsMs, text);

        items.push({
          id:        `tg-${msg.message_id}`,
          source:    chatName || 'Telegram',
          type:      'telegram',
          irgc:      isIrgc,
          proxy:     isProxy,
          title:     text.slice(0, 120),
          summary:   text,
          url:       null,
          published: new Date(tsMs).toISOString(),
          score,
          collected: new Date().toISOString(),
        });
      }
    }
  } catch (err) {
    console.error(`Telegram: ${err.message}`);
    state.errors.push({ time: new Date().toISOString(), source: 'Telegram', error: err.message });
  }
  return items;
}

async function collectNOTAMs() {
  const notams = [];
  if (!FAA_CONFIGURED) return notams;

  const clientId     = process.env.FAA_CLIENT_ID;
  const clientSecret = process.env.FAA_CLIENT_SECRET;

  for (const icao of NOTAM_REGIONS) {
    try {
      const res = await axios.get('https://external-api.faa.gov/notamapi/v1/notams', {
        params:  { icaoLocation: icao, pageSize: 25, pageNum: 0 },
        headers: { client_id: clientId, client_secret: clientSecret },
        timeout: 15000,
      });

      for (const notam of res.data?.items || []) {
        const core = notam.properties?.coreNOTAMData?.notam || {};
        const text = core.text || '';
        notams.push({
          id:             core.id || `notam-${icao}-${Date.now()}`,
          source:         'FAA NOTAM',
          type:           'notam',
          icao,
          title:          `[${icao}] ${text.slice(0, 100)}`,
          summary:        text,
          effectiveStart: core.effectiveStart || null,
          effectiveEnd:   core.effectiveEnd   || null,
          published:      new Date().toISOString(),
          score:          scoreText(text),
          collected:      new Date().toISOString(),
        });
      }
    } catch (err) {
      console.error(`NOTAM [${icao}]: ${err.message}`);
      state.errors.push({ time: new Date().toISOString(), source: `NOTAM ${icao}`, error: err.message });
    }
  }
  return notams;
}

// ═══════════════════════════════════════════════════════════════
// BUILD CHANNEL ACTIVITY MAP (for /api/iran-intel)
// ═══════════════════════════════════════════════════════════════
function buildChannelActivityMap() {
  const now  = Date.now();
  const map  = {};
  for (const channel of [...IRGC_CHANNELS, ...PROXY_CHANNELS]) {
    const times  = channelTimestamps.get(channel) || [];
    const last1h = times.filter(t => t > now - MS_1H).length;
    const last2h = times.filter(t => t > now - MS_2H).length;
    const last24h= times.filter(t => t > now - MS_24H).length;
    const lastTs = times.length ? new Date(Math.max(...times)).toISOString() : null;
    const silentMin = lastTs
      ? Math.round((now - new Date(lastTs).getTime()) / 60000)
      : null;

    map[channel] = {
      postsLast1h:   last1h,
      postsLast2h:   last2h,
      postsLast24h:  last24h,
      avgPerHour:    parseFloat((last24h / 24).toFixed(2)),
      lastSeen:      lastTs,
      silentMinutes: silentMin,
      isIrgc:        IRGC_CHANNELS.includes(channel),
      isProxy:       PROXY_CHANNELS.has(channel),
    };
  }
  return map;
}

// Farsi keyword hit timeline (last 6 hours, bucketed by 30 min)
function buildFarsiTimeline() {
  const now      = Date.now();
  const MS_6H    = 6 * MS_1H;
  const BUCKET   = MS_30M;
  const buckets  = [];

  for (let start = now - MS_6H; start < now; start += BUCKET) {
    const end    = start + BUCKET;
    const hits   = farsiCriticalHits.filter(h => h.timestamp >= start && h.timestamp < end);
    buckets.push({
      windowStart: new Date(start).toISOString(),
      windowEnd:   new Date(end).toISOString(),
      hitCount:    hits.length,
      totalPts:    hits.reduce((s, h) => s + h.pts, 0),
      terms:       [...new Set(hits.map(h => h.term))],
    });
  }
  return buckets;
}

// ═══════════════════════════════════════════════════════════════
// PUSH NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════
const LEVEL_ORDER = ['GREEN', 'YELLOW', 'ORANGE', 'RED'];

async function sendPushNotifications(prevLevel, newLevel) {
  if (!process.env.VAPID_PUBLIC_KEY) return;
  if (LEVEL_ORDER.indexOf(newLevel) <= LEVEL_ORDER.indexOf(prevLevel)) return;

  const payload = JSON.stringify({
    title: `EWS Alert — ${newLevel}`,
    body:  `Threat level escalated from ${prevLevel} to ${newLevel}`,
    icon:  '/icon-192.png',
    badge: '/icon-72.png',
    data:  { level: newLevel, timestamp: new Date().toISOString() },
  });

  const dead = [];
  await Promise.allSettled(
    state.subscribers.map(async (sub) => {
      try {
        await webpush.sendNotification(sub, payload);
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) dead.push(sub.endpoint);
      }
    })
  );
  if (dead.length) {
    state.subscribers = state.subscribers.filter(s => !dead.includes(s.endpoint));
    console.log(`Removed ${dead.length} expired push subscription(s).`);
  }
}

// ═══════════════════════════════════════════════════════════════
// MAIN COLLECTION CYCLE
// ═══════════════════════════════════════════════════════════════
async function collectAll() {
  console.log(`[${new Date().toISOString()}] Collection cycle starting…`);
  state.errors = state.errors.slice(-50);

  const prevLevel = state.threatLevel;

  const [feedsResult, telegramResult, notamsResult] = await Promise.allSettled([
    collectRSSFeeds(),
    collectTelegram(),
    collectNOTAMs(),
  ]);

  const feeds   = feedsResult.status    === 'fulfilled' ? feedsResult.value   : [];
  const telegram= telegramResult.status === 'fulfilled' ? telegramResult.value : [];
  const notams  = notamsResult.status   === 'fulfilled' ? notamsResult.value  : [];

  const signals = [...feeds, ...telegram].sort((a, b) => b.score - a.score);

  // Run behavioral pattern detection
  const patterns = detectBehavioralPatterns();

  state.feeds              = feeds;
  state.notams             = notams;
  state.signals            = signals;
  state.behavioralPatterns = patterns;
  state.channelActivityMap = buildChannelActivityMap();
  state.farsiKeywordTimeline = buildFarsiTimeline();
  state.threatLevel        = calculateThreatLevel(
    [...signals, ...notams],
    patterns.totalBehavioralScore
  );
  state.lastUpdated = new Date().toISOString();

  const behavSummary = patterns.totalBehavioralScore > 0
    ? ` | Behavioral+${patterns.totalBehavioralScore}` : '';

  console.log(
    `[${state.lastUpdated}] Done — Threat: ${state.threatLevel} | ` +
    `Signals: ${signals.length} | NOTAMs: ${notams.length}${behavSummary}`
  );

  await sendPushNotifications(prevLevel, state.threatLevel);
}

// ═══════════════════════════════════════════════════════════════
// API ROUTES
// ═══════════════════════════════════════════════════════════════

app.get('/api/vapid-public-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || null });
});

app.get('/api/status', (req, res) => {
  res.json({
    threatLevel:  state.threatLevel,
    lastUpdated:  state.lastUpdated,
    counts: {
      feeds:       state.feeds.length,
      notams:      state.notams.length,
      signals:     state.signals.length,
      subscribers: state.subscribers.length,
    },
    behavioral: state.behavioralPatterns
      ? { score: state.behavioralPatterns.totalBehavioralScore,
          triggered: state.behavioralPatterns.totalBehavioralScore > 0 }
      : null,
    recentErrors: state.errors.slice(-10),
  });
});

app.get('/api/feeds', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  res.json(state.feeds.slice(0, limit));
});

app.get('/api/notams', (req, res) => {
  res.json(state.notams);
});

app.get('/api/signals', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  res.json(state.signals.slice(0, limit));
});

app.post('/api/subscribe', (req, res) => {
  const sub = req.body;
  if (!sub?.endpoint) return res.status(400).json({ error: 'Invalid subscription object' });
  const exists = state.subscribers.some(s => s.endpoint === sub.endpoint);
  if (!exists) {
    state.subscribers.push(sub);
    console.log(`Push subscriber added. Total: ${state.subscribers.length}`);
  }
  res.status(201).json({ message: 'Subscribed' });
});

app.post('/api/refresh', async (req, res) => {
  res.json({ message: 'Refresh triggered' });
  setImmediate(collectAll);
});

// ─── Iran Intel endpoint ──────────────────────────────────────────────────────
app.get('/api/iran-intel', (req, res) => {
  const patterns = state.behavioralPatterns;

  res.json({
    lastUpdated:    state.lastUpdated,
    threatLevel:    state.threatLevel,

    behavioralPatterns: patterns || {
      totalBehavioralScore:  0,
      proxySilence:          { score: 0, triggered: false, details: [] },
      escalatoryRhetoric:    { score: 0, triggered: false, keywordHitsLastHour: 0, topTerms: [] },
      coordinatedMessaging:  { score: 0, triggered: false, details: [] },
    },

    channelActivityMap:   state.channelActivityMap,
    farsiKeywordTimeline: state.farsiKeywordTimeline,

    monitoredChannels: {
      irgc:  IRGC_CHANNELS,
      proxy: [...PROXY_CHANNELS],
      env:   ENV_CHANNELS,
    },

    preAttackStatus: !patterns ? 'UNKNOWN' : (() => {
      const s = patterns.totalBehavioralScore;
      if (s >= 15) return 'CRITICAL';
      if (s >= 10) return 'ELEVATED';
      if (s >= 5)  return 'WATCH';
      return 'NORMAL';
    })(),
  });
});

// Catch-all — serve frontend SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// ═══════════════════════════════════════════════════════════════
// START
// ═══════════════════════════════════════════════════════════════
app.listen(PORT, () => {
  console.log(`EWS backend listening on http://localhost:${PORT}`);
  console.log(`Serving frontend from ${path.join(__dirname, '../frontend')}`);
  console.log(`Monitoring ${ALL_CHANNELS.length} Telegram channels (${IRGC_CHANNELS.length} IRGC + ${ENV_CHANNELS.length} env)`);
  if (!FAA_CONFIGURED) {
    console.log('FAA credentials not configured, skipping NOTAM collection');
  }
  collectAll();
  cron.schedule('*/5 * * * *', collectAll);
  console.log('Cron scheduled: every 5 minutes');
});
