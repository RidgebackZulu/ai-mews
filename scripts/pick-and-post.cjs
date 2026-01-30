const fs = require('node:fs/promises');
const path = require('node:path');
const { DateTime } = require('luxon');
const fetch = require('node-fetch');
const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');
const OpenAI = require('openai');

const TZ = process.env.SITE_TZ || 'America/Chicago';
const braveKey = process.env.BRAVE_API_KEY;
const openaiKey = process.env.OPENAI_API_KEY;

if (!braveKey) throw new Error('Missing BRAVE_API_KEY');
if (!openaiKey) throw new Error('Missing OPENAI_API_KEY');

const openai = new OpenAI({ apiKey: openaiKey });

const today = DateTime.now().setZone(TZ).toISODate();
const outDir = path.join(process.cwd(), 'src', 'posts');
const outPath = path.join(outDir, `${today}.md`);

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

if (await exists(outPath)) {
  console.log(`Post for ${today} already exists: ${outPath}`);
  process.exit(0);
}

async function braveSearch(q) {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&country=US&search_lang=en&freshness=pd&count=10`;
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
    'openai.com', 'anthropic.com', 'deepmind.google', 'huggingface.co/blog',
    'arxiv.org', 'github.com', 'theverge.com', 'techcrunch.com',
    'theinformation.com', 'semianalysis.com', 'stratechery.com',
    'thehackernews.com', 'bleepingcomputer.com', 'securityweek.com'
  ];
  if (boosts.some(b => u.includes(b))) s += 3;
  if (u.includes('/blog/') || u.includes('/research')) s += 1;
  if (u.includes('twitter.com') || u.includes('x.com')) s -= 2;
  if (u.includes('youtube.com')) s -= 1;
  if (r.age && /hour|minute/i.test(r.age)) s += 1;
  return s;
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
    text: article.textContent.trim().slice(0, 14000)
  };
}

async function generatePost({ sourceUrl, title, text }) {
  const prompt = `Return STRICT JSON with keys: title, dek, bullets (array of 4 short bullets), take (2-3 sentences).\n\nTone for take: realistic/pragmatic, humorous, sometimes snarky/salty, always truthful, no fabrication, no emojis.\n\nSOURCE URL: ${sourceUrl}\n\nARTICLE TITLE: ${title}\n\nARTICLE TEXT:\n${text}`;

  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const resp = await openai.responses.create({
    model,
    input: prompt,
    response_format: { type: 'json_object' }
  });

  const jsonText = resp.output_text;
  let obj;
  try { obj = JSON.parse(jsonText); } catch {
    throw new Error(`OpenAI returned non-JSON: ${String(jsonText).slice(0, 400)}`);
  }
  return obj;
}

function mdEscape(s) {
  return String(s).replace(/"/g, '\\"');
}

const query = process.env.SEARCH_QUERY || 'AI news research launch model safety policy';
const data = await braveSearch(query);
const results = (data && data.web && data.web.results ? data.web.results : []).map(r => ({
  title: r.title,
  url: r.url,
  description: r.description,
  age: r.age
}));

if (!results.length) throw new Error('No Brave results');
results.sort((a, b) => scoreResult(b) - scoreResult(a));
const candidate = results[0];
console.log('Picked:', candidate.url);

const readable = await fetchReadable(candidate.url);
const post = await generatePost({ sourceUrl: candidate.url, title: readable.title, text: readable.text });

await fs.mkdir(outDir, { recursive: true });
const md = `---\nlayout: post.njk\ntitle: "${mdEscape(post.title)}"\ndek: "${mdEscape(post.dek)}"\nsourceUrl: "${candidate.url}"\nbullets:\n${(post.bullets || []).map(b => `  - "${mdEscape(b)}"`).join('\n')}\ntake: "${mdEscape(post.take)}"\n---\n`;

await fs.writeFile(outPath, md, 'utf8');
console.log(`Wrote ${outPath}`);
