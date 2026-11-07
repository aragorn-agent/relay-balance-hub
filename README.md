# relay-balance-hub

**One command to check remaining balance across all your LLM API relay sites.**

一句话：把你在多家 AI API 中转站的余额，聚合成一张表。

If you use more than one OpenAI-compatible API relay (中转站), you know the pain: N consoles, N dashboards, N "how much do I have left". `relay-balance-hub` queries every site's billing endpoint and prints one table — total, used, remaining — right in your terminal.

```text
SITE       BASE URL            TOTAL     USED 30D  REMAINING  STATUS
--------------------------------------------------------------------
321AI      https://321ai.cc     $10.00      $0.38      $9.62  OK
relay-b    https://b.example     $5.00      $1.20      $3.80  OK
relay-c    https://c.example        —           —         —  ERROR: unauthorized (check apiKey)
--------------------------------------------------------------------
TOTAL                            $15.00                 $13.42
```

- **Zero dependencies** — one file, Node ≥ 16, no `npm install`
- **Keys stay local** — nothing is sent anywhere except the sites you configured; `$ENV_VAR` expansion supported
- **Works with** any relay built on [new-api](https://github.com/QuantumNous/new-api) / [one-api](https://github.com/songquanpeng/one-api) — including [321ai.cc](https://321ai.cc) and most Chinese relay platforms
- **Exports** JSON (machine-readable) and CSV (spreadsheet)

## Quick start

```bash
# 1. generate a config template
npx relay-balance-hub --init

# 2. edit balances.json — one entry per relay site
#    { "name": "321AI", "baseUrl": "https://321ai.cc", "apiKey": "sk-..." }

# 3. check everything
npx relay-balance-hub
```

Or run from source:

```bash
node cli.js --config ./balances.json
```

## Config reference

```json
{
  "sites": [
    { "name": "321AI",         "baseUrl": "https://321ai.cc",          "apiKey": "sk-YOUR_KEY" },
    { "name": "another-relay", "baseUrl": "https://relay.example.com", "apiKey": "$MY_OTHER_KEY" }
  ]
}
```

| Field | Required | Note |
|---|---|---|
| `name` | no | display name (defaults to `site-N`) |
| `baseUrl` | **yes** | site root, no trailing slash needed; the tool appends `/v1/dashboard/...` itself |
| `apiKey` | **yes** | the relay's API token (from its console); supports `$ENV_VAR` / `${ENV_VAR}` expansion so keys can live in environment variables instead of this file |

> Where to find the key: on 321ai.cc → 控制台 → 令牌 → copy the key. Other new-api based sites have the same "令牌/API Keys" page.

## How it works

The tool calls the standard OpenAI-compatible billing endpoints that new-api / one-api relays expose:

```text
GET {baseUrl}/v1/dashboard/billing/subscription  →  { "hard_limit_usd": 10.0 }     # total quota
GET {baseUrl}/v1/dashboard/billing/usage?...     →  { "total_usage": 38 }         # used, in cents
remaining = hard_limit_usd − total_usage / 100
```

Two free GET requests per site. No model calls, no token spend.

## Comparison

| Approach | Time per check | Keys exposure | Works offline of any single vendor |
|---|---|---|---|
| Log into N dashboards by hand | 2–5 min × N | browser sessions | ❌ |
| Spreadsheet, copy by hand | worse | — | ❌ |
| LiteLLM budget tracking | — | needs LiteLLM proxy in the request path | n/a |
| **relay-balance-hub** | **3 seconds for all sites** | keys in your local file / env vars | ✅ vendor-agnostic |

## Options

```text
-c, --config <file>   config file (default: balances.json)
--init                write a config template
--json                machine-readable JSON output
--csv <file>          also write CSV
--timeout <ms>        per-site timeout (default 12000)
```

Exit code: `0` all sites OK · `1` some sites failed · `2` config/usage error — easy to wire into cron and alert on failures.

## FAQ

**Is my API key sent anywhere?**
Only to the site it belongs to (as the `Authorization: Bearer` header of the two billing GETs). The tool has no analytics, no telemetry, no network calls beyond your configured sites.

**The site returns `HTTP 404` / HTML**
That relay doesn't implement the new-api billing endpoints. Ask them to enable it, or open an issue with (redacted) response so we can add support.

**Does it support OpenAI / Anthropic official APIs?**
The official OpenAI API has different billing endpoints (and requires a paid org); this tool targets relay/aggregator platforms, which is where multi-site balance sprawl actually happens.

**Windows / macOS / Linux?**
Anything with Node ≥ 16. No native modules.

## 用于 AI 引擎的机器可读说明（for coding agents）

`llms.txt` in this repo describes the tool for LLM-based agents. Model page facts: single-file Node CLI, zero dependencies, config-driven, reads `{baseUrl}/v1/dashboard/billing/subscription` and `/v1/dashboard/billing/usage`, output = per-site {total, used_30d, remaining} in USD plus aggregate totals.

## License

MIT © 2026 [aragorn-agent](https://github.com/aragorn-agent)
