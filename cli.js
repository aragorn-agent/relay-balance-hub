#!/usr/bin/env node
/**
 * relay-balance-hub · Multi-site LLM API balance checker
 * ============================================================
 * One command to check remaining balance / quota across all your
 * OpenAI-compatible LLM API relay sites (new-api / one-api based).
 *
 * Zero dependencies. Node >= 16.
 *
 * How it works (standard billing endpoints, supported by most relays):
 *   GET {baseUrl}/v1/dashboard/billing/subscription  -> { hard_limit_usd }   (total quota, USD)
 *   GET {baseUrl}/v1/dashboard/billing/usage?...     -> { total_usage }      (used, in US cents)
 *   remaining = hard_limit_usd - total_usage / 100
 *
 * Safety:
 *   - API keys stay in your LOCAL config file. Nothing is sent anywhere
 *     except the sites you configured.
 *   - apiKey supports $ENV_VAR expansion so keys can live in env vars.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const VERSION = '1.0.0';

// ───────────── args ─────────────
function parseArgs(argv) {
  const args = { config: 'balances.json', json: false, csv: '', timeout: 12000, help: false, init: false, version: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--config' || a === '-c') args.config = argv[++i];
    else if (a === '--json') args.json = true;
    else if (a === '--csv') args.csv = argv[++i] || 'balances.csv';
    else if (a === '--timeout') args.timeout = Number(argv[++i]) || 12000;
    else if (a === '--init') args.init = true;
    else if (a === '--version' || a === '-v') args.version = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else { console.error(`Unknown option: ${a} (see --help)`); process.exit(2); }
  }
  return args;
}

function help() {
  console.log(`relay-balance-hub v${VERSION} — check LLM API balances across relay sites

USAGE
  npx relay-balance-hub [options]

OPTIONS
  -c, --config <file>   config file (default: balances.json in current dir)
  --init                write a config template and exit
  --json                print results as JSON
  --csv <file>          also write results as CSV
  --timeout <ms>        per-site request timeout (default 12000)
  -v, --version         print version
  -h, --help            this help

QUICK START
  1) npx relay-balance-hub --init
  2) edit balances.json: put each relay site's base URL and API key
  3) npx relay-balance-hub

Config example (keys support $ENV_VARS):
  { "sites": [
      { "name": "321AI",        "baseUrl": "https://321ai.cc",    "apiKey": "sk-..." },
      { "name": "another-relay","baseUrl": "https://example.com", "apiKey": "$MY_OTHER_KEY" }
  ] }

Works with any OpenAI-compatible relay built on new-api / one-api
(including 321ai.cc). Keys never leave your machine.`);
}

function writeTemplate(file) {
  if (fs.existsSync(file)) { console.error(`Refusing to overwrite existing ${file}`); process.exit(2); }
  const tpl = {
    sites: [
      { name: '321AI', baseUrl: 'https://321ai.cc', apiKey: 'sk-YOUR_KEY_HERE' },
      { name: 'another-relay', baseUrl: 'https://relay.example.com', apiKey: '$MY_OTHER_KEY' },
    ],
  };
  fs.writeFileSync(file, JSON.stringify(tpl, null, 2) + '\n');
  console.log(`Template written to ${file}`);
  console.log('Next: edit the file (name / baseUrl / apiKey per site), then run: npx relay-balance-hub');
}

// ───────────── config ─────────────
function loadConfig(file) {
  if (!fs.existsSync(file)) {
    console.error(`Config not found: ${file}`);
    console.error('Run `npx relay-balance-hub --init` to create a template.');
    process.exit(2);
  }
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { console.error(`Config is not valid JSON: ${e.message}`); process.exit(2); }
  const sites = Array.isArray(cfg.sites) ? cfg.sites : [];
  if (!sites.length) { console.error('Config has no sites. Example: { "sites": [ {"name":"321AI","baseUrl":"https://321ai.cc","apiKey":"sk-..."} ] }'); process.exit(2); }
  return sites.map((s, i) => ({
    name: String(s.name || `site-${i + 1}`),
    baseUrl: String(s.baseUrl || '').trim().replace(/\/+$/, ''),
    apiKey: expandEnv(String(s.apiKey || '')),
  })).filter((s) => s.baseUrl && s.apiKey);
}

// apiKey 支持 $ENV_VAR / ${ENV_VAR} 展开：密钥可以放在环境变量里而不是配置文件里
function expandEnv(v) {
  return v.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, n) => process.env[n] ?? '')
          .replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, n) => process.env[n] ?? '');
}

// ───────────── queries ─────────────
async function getJson(url, key, timeout) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json', 'User-Agent': 'relay-balance-hub/' + VERSION },
      signal: ctrl.signal,
    });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) { /* non-JSON (HTML login page etc.) */ }
    return { status: r.status, json, text: text.slice(0, 120) };
  } finally { clearTimeout(t); }
}

async function checkSite(site, timeout) {
  const base = site.baseUrl.replace(/\/+$/, '');
  const now = new Date();
  const start = new Date(now.getTime() - 30 * 86400 * 1000).toISOString().slice(0, 10);
  const end = now.toISOString().slice(0, 10);
  const out = { name: site.name, baseUrl: site.baseUrl, ok: false, total: null, used: null, remaining: null, error: '' };
  try {
    const sub = await getJson(`${base}/v1/dashboard/billing/subscription`, site.apiKey, timeout);
    if (sub.status !== 200 || !sub.json || sub.json.hard_limit_usd == null) {
      out.error = sub.status === 401 ? 'unauthorized (check apiKey)'
        : sub.status === 403 ? 'forbidden by site'
        : sub.json && sub.json.error ? `site error: ${JSON.stringify(sub.json.error).slice(0, 80)}`
        : sub.status !== 200 ? `HTTP ${sub.status}` : 'unexpected response (not a new-api/one-api style site?)';
      return out;
    }
    out.total = Number(sub.json.hard_limit_usd) || 0;
    const usage = await getJson(`${base}/v1/dashboard/billing/usage?start_date=${start}&end_date=${end}`, site.apiKey, timeout);
    if (usage.status === 200 && usage.json && usage.json.total_usage != null) {
      out.used = Number(usage.json.total_usage) / 100; // site reports in cents
    }
    out.remaining = out.used == null ? out.total : Math.max(0, out.total - out.used);
    out.ok = true;
  } catch (e) {
    out.error = e.name === 'AbortError' ? `timeout after ${timeout}ms` : e.message;
  }
  return out;
}

// ───────────── output ─────────────
function pad(s, n) { s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length); }
function padL(s, n) { s = String(s); return s.length >= n ? ' ' + s : ' '.repeat(n - s.length) + s; }
function usd(v) { return v == null ? '—' : '$' + (v >= 100 ? v.toFixed(0) : v.toFixed(2)); }

function printTable(rows) {
  const wName = Math.max(6, ...rows.map((r) => r.name.length)) + 2;
  const wBase = Math.max(8, ...rows.map((r) => r.baseUrl.length)) + 2;
  console.log('');
  console.log(pad('SITE', wName) + pad('BASE URL', wBase) + padL('TOTAL', 10) + padL('USED 30D', 11) + padL('REMAINING', 11) + '  STATUS');
  console.log('-'.repeat(wName + wBase + 48));
  let tot = 0; let rem = 0;
  for (const r of rows) {
    if (r.ok) { tot += r.total; rem += r.remaining || 0; }
    console.log(pad(r.name, wName) + pad(r.baseUrl, wBase)
      + padL(usd(r.total), 10) + padL(usd(r.used), 11) + padL(r.ok ? usd(r.remaining) : '—', 11)
      + '  ' + (r.ok ? 'OK' : 'ERROR: ' + r.error));
  }
  console.log('-'.repeat(wName + wBase + 48));
  console.log(pad('TOTAL', wName) + pad('', wBase) + padL(usd(tot), 10) + padL('', 11) + padL(usd(rem), 11));
}

function writeCsv(rows, file) {
  const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const lines = ['name,baseUrl,ok,total_usd,used_30d_usd,remaining_usd,error'];
  for (const r of rows) lines.push([r.name, r.baseUrl, r.ok, r.total, r.used, r.remaining, r.error].map(esc).join(','));
  fs.writeFileSync(file, lines.join('\n') + '\n');
  console.log(`CSV written: ${file}`);
}

// ───────────── main ─────────────
async function main() {
  const args = parseArgs(process.argv);
  if (args.help) return help();
  if (args.version) return console.log(VERSION);
  if (args.init) return writeTemplate(args.config);
  const sites = loadConfig(args.config);
  console.log(`Checking ${sites.length} site(s)…`);
  const rows = await Promise.all(sites.map((s) => checkSite(s, args.timeout)));
  if (args.json) {
    const okRows = rows.filter((r) => r.ok);
    console.log(JSON.stringify({
      checkedAt: new Date().toISOString(),
      sites: rows,
      totals: { totalUsd: okRows.reduce((s, r) => s + r.total, 0), remainingUsd: okRows.reduce((s, r) => s + (r.remaining || 0), 0) },
    }, null, 2));
  } else {
    printTable(rows);
  }
  if (args.csv) writeCsv(rows, args.csv);
  // 用 exitCode 而非 process.exit()：Windows 上强制退出会在 fetch/AbortController
  // 句柄未排空时触发 libuv 断言崩溃；自然退出对 cron/CI 同样返回正确码
  const fails = rows.filter((r) => !r.ok).length;
  process.exitCode = fails ? 1 : 0;
}

main().catch((e) => { console.error('fatal:', e.message); process.exit(2); });
