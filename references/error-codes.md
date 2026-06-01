# Error Codes

All scripts return either success JSON or:

```json
{ "error": "CODE", "message": "...", "next_steps": ["...", "..."] }
```

The `next_steps` array is pre-translated to user-friendly Chinese. Relay it to the user verbatim; do not paraphrase to add jargon.

## AK_NOT_CONFIGURED

The user has never set an API key. Returned by all scripts when key is missing.

- Action: Ask the user for their ideaLAB key, then call `config.js` with `{api_key: "..."}`.
- Sample message to user: "第一次用先告诉我你的 ideaLAB API key (格式 sk-xxxxx),我帮你保存"

## INVALID_ARGS

The caller (you, the LLM) passed wrong / missing arguments. This is a developer error, not a user error.

- Action: Re-read the relevant script's input schema in `manifest`-equivalent comments at top of the script. Fix and retry.

## FILE_NOT_FOUND

A path passed in (template, folder, excel) does not exist on disk.

- Action: Confirm the path with the user, or fix the path you constructed.

## INVALID_FORMAT

File exists but is not a supported image / excel.

- Action: Tell the user which file and what extension is supported.

## NO_PRODUCTS

`parse_products` returned 0 paths. The source had no usable images / URLs.

- Action: Ask the user to confirm the folder has images, or that the Excel has a column with `image / img / url / 链接` keywords containing http(s) URLs.

## DEPENDENCY_MISSING

Node modules not installed.

- Action: Run `cd ~/.claude/skills/bannermorph && npm install`.

## DOWNLOAD_FAILED

URL download failed (SSRF block, timeout, HTTP error). Returned when **all** URLs from the source failed to download.

- Action: Show the user the underlying reason (in `next_steps`); usually a bad URL or a non-public host.

## PARTIAL_DOWNLOAD_FAILED

`parse_products` found N image URLs in the source but only M downloaded successfully (M < N, M > 0). Default behavior is to refuse and surface the missing ones, so the user knows the batch is incomplete before generation starts.

- The `next_steps` includes a JSON-formatted failure list (URL → reason).
- Action: Tell the user N images expected, M downloaded, the failed URL list. Ask whether to:
  1. **Retry the failed URLs** (often network blips — second attempt usually succeeds)
  2. **Proceed with the M downloaded** (call `parse_products` again with `"allow_partial": true`)
  3. **Fix the source** (some URLs are dead → user updates Excel / link list)

This was added after a real incident: a 5-URL Excel silently became a 4-image batch because of one transient network hiccup, and the user didn't realize until comparing the final report to the original product list.

## QUOTA_EXCEEDED

User asked for >10 products on the default ideaLAB key (per-batch cap).

- Action: Present the 3 options to the user (do first 10, switch to own key, reduce count). See `next_steps` for exact wording.

## QUOTA_PRECHECK

Returned by `generate_batch.js` **before any API call** when the local `.quota-log` says the default AK has fewer remaining slots this hour than the requested batch size. Different from `QUOTA_EXCEEDED` (per-batch hard cap of 10) and `QUOTA_EXHAUSTED` (server-side 429 mid-batch).

- Action: Relay `next_steps` verbatim. The script reports how many slots remain and proposes (1) running only `remaining` images now, (2) switching to user's own key, or (3) waiting 30-60 min.
- Tip: `node scripts/quota_status.js` shows the same usage anytime, no API call needed.

## QUOTA_EXHAUSTED

Hourly quota on default key is used up (the API returned 429 mid-batch).

- Action: Tell the user to wait ~30 minutes or switch to their own paid key. Surface any `partial_results` (successful images before the limit hit).

## RETRY_FAILED

`retry_batch.js` could not spawn `generate_batch.js` subprocess. Internal bug.

- Action: Check the next_steps for the underlying stderr / stdout. If reproducible, file an issue.

## Network / unknown errors

When the script crashes (panic, exit code 1), stderr contains a stack trace. The skill should surface this once to the user as "internal error" and suggest retrying. Do not loop blindly.

## Recovery decision tree

```
error received
├── AK_NOT_CONFIGURED   → ask user for key → config.js → retry
├── INVALID_ARGS        → fix arguments → retry (do not bother user)
├── FILE_NOT_FOUND      → confirm path with user → retry
├── NO_PRODUCTS         → ask user to verify source → retry
├── DEPENDENCY_MISSING  → npm install → retry
├── DOWNLOAD_FAILED     → surface reason → ask user
├── QUOTA_EXCEEDED      → present 3 options to user
├── QUOTA_EXHAUSTED     → wait / switch key → user decides
└── unknown / panic     → surface once → suggest retry, do not loop
```
