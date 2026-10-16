import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'feed.xml');

const BOARD_URL = 'https://www.fmkorea.com/index.php?mid=mystery';
const FEED_TITLE = '에펨코리아 - 미스터리/공포';
const FEED_DESC = '에펨코리아 미스터리/공포 게시판 새 글';
const SITE_BASE = 'https://www.fmkorea.com';
const INCLUDE_NOTICE = process.env.INCLUDE_NOTICE === '1';
const FORCE_BROWSER = process.env.FORCE_BROWSER === '1';
const HEADED = process.argv.includes('--headed');
const FM_COOKIES = (process.env.FM_COOKIES || '').trim();

function cookieHeaderPairs() {
  // "a=b; c=d" → [{name, value}]
  return FM_COOKIES.split(';').map((p) => p.trim()).filter(Boolean).map((p) => {
    const i = p.indexOf('=');
    if (i <= 0) return null;
    return { name: p.slice(0, i).trim(), value: p.slice(i + 1).trim() };
  }).filter(Boolean);
}
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

const FETCH_HEADERS = {
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
  'Referer': SITE_BASE + '/',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'same-origin',
  'Upgrade-Insecure-Requests': '1',
};

function isBoardHtml(html) {
  return typeof html === 'string' && html.indexOf('bd_lst') !== -1;
}

async function tryFetch() {
  const headers = { 'User-Agent': UA, ...FETCH_HEADERS };
  if (FM_COOKIES) headers['Cookie'] = FM_COOKIES;
  const res = await fetch(BOARD_URL, {
    headers,
    signal: AbortSignal.timeout(25000),
    redirect: 'follow',
  });
  const html = await res.text();
  console.log('[fetch] status=', res.status, 'bytes=', html.length, 'board=', isBoardHtml(html),
    'cookies=', FM_COOKIES ? 'yes' : 'no');
  return isBoardHtml(html) ? html : null;
}

async function tryBrowser() {
  const { chromium } = await import('playwright');
  console.log('[browser] launching headless=' + (!HEADED));
  const browser = await chromium.launch({
    headless: !HEADED,
    // Turnstile 자동 통과 필수 옵션: 자동화 흔적 제거
    ignoreDefaultArgs: ['--enable-automation'],
    args: ['--disable-blink-features=AutomationControlled'],
  });
  try {
    const ctx = await browser.newContext({
      userAgent: UA,
      locale: 'ko-KR',
      timezoneId: 'Asia/Seoul',
      viewport: { width: 1280, height: 800 },
      extraHTTPHeaders: FETCH_HEADERS,
    });
    if (FM_COOKIES) {
      const cookies = cookieHeaderPairs().map((c) => ({
        name: c.name, value: c.value,
        domain: '.fmkorea.com', path: '/',
      }));
      await ctx.addCookies(cookies);
    }
    const page = await ctx.newPage();
    await page.goto(BOARD_URL, { waitUntil: 'domcontentloaded', timeout: 40000 });

    // 보안 시스템(Turnstile) 페이지면 자동 통과 후 reload 최대 150초 대기
    const deadline = Date.now() + 150000;
    let poll = 0;
    while (Date.now() < deadline) {
      const html = await page.content();
      if (isBoardHtml(html)) {
        console.log('[browser] board visible after tries');
        return html;
      }
      poll += 1;
      // 진단: 토큰 상태 / js_info / 위젯 오류 문구 (10초마다)
      if (poll % 4 === 1) {
        const diag = await page.evaluate(() => {
          const i = document.querySelector("input[name='cf-turnstile-response']");
          const info = document.getElementById('js_info');
          const bodyTxt = document.body ? document.body.innerText.replace(/\s+/g, ' ').slice(0, 200) : '';
          return {
            title: document.title,
            token: i ? (i.value ? 'SET(len=' + i.value.length + ')' : 'empty') : 'noinput',
            info: info ? info.textContent.trim().slice(0, 100) : '',
            bodyTxt,
          };
        });
        console.log('[diag]', JSON.stringify(diag));
      }
      await page.waitForTimeout(2000);
    }
    const last = await page.content();
    fs.mkdirSync(path.join(ROOT, 'artifacts'), { recursive: true });
    fs.writeFileSync(path.join(ROOT, 'artifacts', 'challenge.html'), last, 'utf8');
    await page.screenshot({ path: path.join(ROOT, 'artifacts', 'challenge.png'), fullPage: true }).catch(() => {});
    console.log('[browser] timeout: challenge not resolved. bytes=', last.length);
    return null;
  } finally {
    await browser.close();
  }
}

// cheerio는 CJS라 동적 import로 받는다
async function loadCheerio() {
  const mod = await import('cheerio');
  return mod.default ?? mod;
}

function atomToTs(str) {
  // 'YY.MM.DD' 또는 'HH:MM'(오늘, KST)
  const s = String(str || '').trim();
  let m = s.match(/^(\d{2})\.(\d{2})\.(\d{2})\.?$/);
  if (m) {
    let yy = parseInt(m[1], 10);
    yy = yy >= 50 ? yy + 1900 : yy + 2000;
    return Date.UTC(yy, parseInt(m[2], 10) - 1, parseInt(m[3], 10), 0, 0, 0) - 9 * 3600 * 1000; // KST 09:00
  }
  m = s.match(/^(\d{1,2}):(\d{2})/);
  if (m) {
    const k = new Date(Date.now() + 9 * 3600 * 1000); // KST wall clock
    const ts = Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate(),
      parseInt(m[1], 10), parseInt(m[2], 10), 0) - 9 * 3600 * 1000;
    if (ts > Date.now() + 120000) return ts - 24 * 3600 * 1000; // 약간의 시차 보정
    return ts;
  }
  return 0;
}

function rfc822Kst(ts) {
  const d = new Date(ts + 9 * 3600 * 1000);
  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const p = (n) => String(n).padStart(2, '0');
  return `${WD[d.getUTCDay()]}, ${p(d.getUTCDate())} ${MO[d.getUTCMonth()]} ${d.getUTCFullYear()} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} +0900`;
}

async function parseItems(html) {
  const cheerio = await loadCheerio();
  const $ = cheerio.load(html);
  const items = [];
  $('table.bd_lst tbody tr').each((_, tr) => {
    const $tr = $(tr);
    const cls = ' ' + ($tr.attr('class') || '').toLowerCase() + ' ';
    const isNotice = cls.indexOf(' notice ') !== -1;
    if (isNotice && !INCLUDE_NOTICE) return;

    const $tdTitle = $tr.find('td.title').first();
    if (!$tdTitle.length) return; // '공지 더 보기' 등 확장 행

    let title = '', link = '', comments = 0;
    $tdTitle.find('a').each((_i, a) => {
      const $a = $(a);
      const aClass = ($a.attr('class') || '').toLowerCase();
      const href = ($a.attr('href') || '').trim();
      if (aClass.indexOf('replynum') !== -1) {
        comments = parseInt($a.text(), 10) || 0;
        return;
      }
      if (!title && href && href.indexOf('document_srl=') === -1) {
        const t = $a.text().replace(/\s+/g, ' ').trim();
        if (!t) return;
        title = t;
        link = /^https?:\/\//i.test(href) ? href : (href[0] === '/' ? SITE_BASE + href : SITE_BASE + '/' + href);
      }
    });
    if (!title || !link) return;

    const author = $tr.find('td.author').first().text().replace(/\s+/g, ' ').trim();
    const timeStr = $tr.find('td.time').first().text().trim();
    const ts = atomToTs(timeStr);

    let guid;
    const gm = link.match(/(?:document_srl=|\/)(\d{6,})/);
    guid = gm ? gm[1] : link;

    items.push({ title, link, author, comments, ts: ts || 0, notice: isNotice ? 1 : 0, guid });
  });
  return items;
}

function xmlEsc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
function cdata(s) {
  return '<![CDATA[' + String(s).replace(/\]\]>/g, ']]>]]><![CDATA[') + ']]>';
}

function buildRss(items) {
  const parts = [];
  parts.push('<?xml version="1.0" encoding="UTF-8"?>');
  parts.push('<rss version="2.0"><channel>');
  parts.push('<title>' + cdata(FEED_TITLE) + '</title>');
  parts.push('<link>' + xmlEsc(BOARD_URL) + '</link>');
  parts.push('<description>' + cdata(FEED_DESC) + '</description>');
  parts.push('<language>ko</language>');
  parts.push('<ttl>30</ttl>');
  for (const it of items) {
    const dateStr = it.ts ? new Date(it.ts + 9 * 3600 * 1000).toISOString().slice(0, 10) : ''; // KST 기준일
    const desc = '작성자: ' + (it.author || '알수없음') + ' | 작성일: ' + dateStr + ' | 댓글: ' + it.comments;
    parts.push('<item>');
    parts.push('<title>' + cdata(it.title + (it.comments > 0 ? ' [' + it.comments + ']' : '')) + '</title>');
    parts.push('<link>' + xmlEsc(it.link) + '</link>');
    parts.push('<comments>' + xmlEsc(it.link + '#comment') + '</comments>');
    parts.push('<guid isPermaLink="false">' + xmlEsc(it.guid) + '</guid>');
    if (it.ts) parts.push('<pubDate>' + rfc822Kst(it.ts) + '</pubDate>');
    if (it.author) parts.push('<author>' + cdata(it.author) + '</author>');
    parts.push('<description>' + cdata(desc) + '</description>');
    parts.push('</item>');
  }
  parts.push('</channel></rss>');
  return parts.join('');
}

async function main() {
  let html = null;
  let mode = 'fetch';
  if (!FORCE_BROWSER) {
    try { html = await tryFetch(); } catch (e) { console.log('[fetch] error: ' + (e && e.message)); }
  }
  if (!html) {
    mode = 'browser';
    html = await tryBrowser();
  }
  if (!html || !isBoardHtml(html)) {
    console.error('FAILED: blocked by security system (all methods)');
    process.exit(2);
  }
  const items = await parseItems(html);
  if (!items.length) {
    console.error('FAILED: no items parsed from board html');
    process.exit(3);
  }
  const xml = buildRss(items);
  fs.writeFileSync(OUT, xml, 'utf8');
  console.log('OK mode=' + mode + ' items=' + items.length + ' out=' + OUT + ' bytes=' + xml.length);
}

main().catch((e) => {
  console.error('UNEXPECTED: ' + (e && (e.stack || e.message)));
  process.exit(1);
});
