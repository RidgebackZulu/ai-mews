const fs = require('node:fs/promises');
const path = require('node:path');
const { DateTime } = require('luxon');
const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');
const OpenAI = require('openai');

// Node 22+ provides global fetch. We avoid node-fetch v3 (ESM-only).
if (typeof fetch !== 'function') {
  throw new Error('Global fetch is not available (need Node 18+).');
}

async function main() {
  const TZ = process.env.SITE_TZ || 'America/Chicago';
  const braveKey = process.env.BRAVE_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const tgToken = process.env.TELEGRAM_BOT_TOKEN;
  const tgChatId = process.env.TELEGRAM_CHAT_ID;

  if (!braveKey) throw new Error('Missing BRAVE_API_KEY');
  if (!openaiKey) throw new Error('Missing OPENAI_API_KEY');

  const openai = new OpenAI({ apiKey: openaiKey });

  // --- Schedule handling ---
  // We run this workflow on a fixed UTC cron schedule (see .github/workflows/daily.yml).
  // Historically we gated on local 08:00 to handle DST, but timezone resolution can be flaky
  // in some CI environments. Instead:
  // - allow the workflow to run whenever triggered
  // - rely on the "post already exists" guard to keep it idempotent
  // Optionally, you can re-enable the local-hour gate by setting ENFORCE_LOCAL_8AM=1.
  const nowLocal = DateTime.now().setZone(TZ);
  if (process.env.ENFORCE_LOCAL_8AM === '1' && nowLocal.hour !== 8 && process.env.FORCE_RUN !== '1') {
    console.log(`ENFORCE_LOCAL_8AM=1 and it's not 08:00 ${TZ} (it is ${nowLocal.toFormat('HH:mm')}); exiting.`);
    return;
  }

  const today = nowLocal.toISODate();
  const outDir = path.join(process.cwd(), 'src', 'posts');
  const outPath = path.join(outDir, `${today}.md`);

  async function exists(p) {
    try { await fs.access(p); return true; } catch { return false; }
  }

  const overwrite = process.env.FORCE_OVERWRITE === '1';
  if (await exists(outPath) && !overwrite) {
    console.log(`Post for ${today} already exists: ${outPath} (set FORCE_OVERWRITE=1 to regenerate)`);
    return;
  }

  async function braveSearch(q) {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&country=US&search_lang=en&freshness=pd&count=20`;
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'X-Subscription-Token': braveKey
      }
    });
    if (!res.ok) throw new Error(`Brave search failed: ${res.status} ${await res.text()}`);
    return res.json();
  }

  function scoreResult(r) {
    const u = (r.url || '').toLowerCase();
    let s = 0;

    const boosts = [
      // big AI companies + primary sources
      'openai.com', 'anthropic.com', 'deepmind.google', 'ai.googleblog.com', 'blog.google',
      'microsoft.com', 'meta.com', 'github.com',

      // popular outlets
      'theverge.com', 'techcrunch.com', 'bloomberg.com', 'reuters.com', 'wsj.com',
      'ft.com', 'arstechnica.com', 'wired.com',

      // community highlights
      'news.ycombinator.com', 'producthunt.com',

      // occasional spice
      'politico.com', 'theguardian.com', 'nytimes.com'
    ];
    if (boosts.some(b => u.includes(b))) s += 3;

    if (/(agent|agents|bot|tool|startup|funding|seed|series|acquir|merger|m&a|launch|release|copilot|vibe)/i.test(u)) s += 2;

    if (u.includes('twitter.com') || u.includes('x.com')) s -= 2;
    if (u.includes('youtube.com') || u.includes('tiktok.com')) s -= 1;

    if (r.age && /minute|hour/i.test(r.age)) s += 1;

    if (u.includes('utm_') || u.includes('amp')) s -= 0.5;

    return s;
  }

  function normHost(u) {
    try {
      const h = new URL(u).hostname.toLowerCase();
      return h.startsWith('www.') ? h.slice(4) : h;
    } catch {
      return '';
    }
  }

  async function fetchReadable(url) {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${url}`);
    const html = await res.text();
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    if (!article || !article.textContent) throw new Error(`Readability failed for ${url}`);
    return {
      title: (article.title || url).trim(),
      text: article.textContent.trim().slice(0, 12000)
    };
  }

  async function summarizeOne({ sourceUrl, title, text }) {
    const prompt = `You are writing one of five daily picks for a site called “AI Mews”.\n\nReturn STRICT JSON with keys: title, dek, bullets (array of 3-5 short bullets), take (2-3 sentences).\n\nSelection vibe: vibe coding, new businesses/ventures, big AI company moves, major acquisitions, new popular tools/agents/bots. Allow a little spicy drama/politics sometimes.\n\nTone for take: realistic/pragmatic, humorous, sometimes snarky/salty, ALWAYS truthful. No fabrication. No emojis.\n\nSOURCE URL: ${sourceUrl}\n\nARTICLE TITLE: ${title}\n\nARTICLE TEXT:\n${text}`;

    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

    // Use Chat Completions JSON mode for compatibility (Responses API changed params).
    const resp = await openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: 'You output only valid JSON.' },
        { role: 'user', content: prompt }
      ],
      response_format: { type: 'json_object' }
    });

    const jsonText = resp.choices?.[0]?.message?.content || '';
    let obj;
    try { obj = JSON.parse(jsonText); } catch {
      throw new Error(`OpenAI returned non-JSON: ${String(jsonText).slice(0, 400)}`);
    }
    return obj;
  }

  function mdEscape(s) {
    return String(s ?? '').replace(/"/g, '\\"');
  }

  function toYamlItems(items) {
    return items.map((it) => {
      const bullets = (it.bullets || []).map(b => `      - "${mdEscape(b)}"`).join('\n');
      return `  - title: "${mdEscape(it.title)}"\n    dek: "${mdEscape(it.dek)}"\n    sourceUrl: "${mdEscape(it.sourceUrl)}"\n    bullets:\n${bullets}\n    take: "${mdEscape(it.take)}"`;
    }).join('\n');
  }

  async function sendTelegramDigest({ date, pageUrl, items }) {
    const wantsTelegram = Boolean(tgToken || tgChatId);
    if (wantsTelegram && (!tgToken || !tgChatId)) {
      throw new Error('Telegram is partially configured. Set both TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID.');
    }
    if (!wantsTelegram) {
      console.log('Telegram not configured; skipping Telegram send.');
      return;
    }

    const lines = [];
    lines.push(`AI Mews — ${date}`);
    lines.push(pageUrl);
    lines.push('');

    items.forEach((it, idx) => {
      lines.push(`${idx + 1}) ${it.title}`);
      lines.push(`- ${it.dek}`);
      (it.bullets || []).slice(0, 4).forEach(b => lines.push(`• ${b}`));
      lines.push(`Take: ${it.take}`);
      lines.push(`Source: ${it.sourceUrl}`);
      lines.push('');
    });

    const text = lines.join('\n').trim();
    const finalText = text.length > 3900 ? (text.slice(0, 3900) + '\n\n(Truncated)') : text;

    const url = `https://api.telegram.org/bot${tgToken}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: tgChatId,
        text: finalText,
        disable_web_page_preview: false
      })
    });

    if (!res.ok) {
      throw new Error(`Telegram sendMessage failed: ${res.status} ${await res.text()}`);
    }

    console.log('Sent Telegram digest.');
  }

  // ---- pick 5 ----
  const query = process.env.SEARCH_QUERY ||
    'AI startup funding OR "AI agent" OR new AI tool OR vibe coding OR AI acquisition OR AI merger OR OpenAI OR Anthropic OR Google DeepMind';

  const data = await braveSearch(query);
  const raw = (data && data.web && data.web.results ? data.web.results : []).map(r => ({
    title: r.title,
    url: r.url,
    description: r.description,
    age: r.age
  }));

  if (!raw.length) throw new Error('No Brave results');
  raw.sort((a, b) => scoreResult(b) - scoreResult(a));

  // De-dupe by hostname (variety). Allow max 2 per host.
  const hostCounts = new Map();
  const seenUrl = new Set();
  const candidates = [];
  for (const r of raw) {
    if (!r.url) continue;
    const host = normHost(r.url);
    if (!host) continue;
    if (seenUrl.has(r.url)) continue;

    const count = hostCounts.get(host) || 0;
    if (count >= 2) continue;

    hostCounts.set(host, count + 1);
    seenUrl.add(r.url);
    candidates.push(r);
    if (candidates.length >= 10) break; // extras in case readability fails
  }

  const picked = [];
  for (const c of candidates) {
    try {
      const readable = await fetchReadable(c.url);
      const sum = await summarizeOne({ sourceUrl: c.url, title: readable.title, text: readable.text });
      picked.push({
        title: sum.title,
        dek: sum.dek,
        bullets: sum.bullets,
        take: sum.take,
        sourceUrl: c.url
      });
    } catch (e) {
      console.log(`Skipping ${c.url}: ${e.message}`);
    }
    if (picked.length >= 5) break;
  }

  if (picked.length < 3) {
    throw new Error(`Only generated ${picked.length} items; aborting so we don't post junk.`);
  }

  await fs.mkdir(outDir, { recursive: true });
  const pageTitle = `AI Mews — ${today}`;
  const dek = 'Five daily picks: vibe coding, ventures, big AI moves, hot new tools, plus occasional spicy politics.';

  const md = `---\nlayout: post.njk\ntitle: "${mdEscape(pageTitle)}"\ndek: "${mdEscape(dek)}"\nitems:\n${toYamlItems(picked)}\n---\n`;

  await fs.writeFile(outPath, md, 'utf8');
  console.log(`Wrote ${outPath}`);

  // Telegram digest: share OUR site link for traffic.
  const pageUrl = `https://ridgebackzulu.github.io/ai-mews/posts/${today}/`;
  await sendTelegramDigest({ date: today, pageUrl, items: picked });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
