# AGENTS.md — Weaver E10 OA Helper

## What this is

Unofficial Chrome Extension (Manifest V3) for Weaver E10 OA. Not affiliated with, endorsed by, or supported by Weaver Network Technology Co., Ltd. No build step, no bundler, no package.json — plain JS/HTML/CSS loaded directly by Chrome.

## Structure

```
manifest.json          — MV3 manifest, single source of truth for permissions and entry points
background/service-worker.js  — service worker: badge management, OA URL matching
content/content.js     — content script injected into all pages; handles Show Console, i18n switch, LDAP, SSO token, personnel records, SQL, instance log
content/message-bridge.js  — fallback bridge, injected on demand by the popup when a tab lacks the content script; duplicates every message handler
content/inject.js      — MAIN world script; unlocks the ESB action-flow log table checkboxes
content/content.css    — injected styles for OA page overlays
lib/utils.js           — shared utility object (E10Utils): OA API calls, storage helpers
popup/                 — popup UI (HTML/CSS/JS); loads utils.js via <script> tag
options/               — options page; manages OA base URLs per environment (dev/test/staging/prod)
icons/                 — extension icons (16/32/48/128 png)
README.md              — user-facing docs, feature list, compliance/privacy notes
LICENSE                — MIT
```

## Key architecture facts

- **No build pipeline.** Edit files directly and reload the extension in `chrome://extensions`.
- **Content script load order matters:** `manifest.json` loads `lib/utils.js` before `content/content.js` — the content script depends on the global `E10Utils` object.
- **Popup also loads utils.js** via a `<script>` tag in `popup/popup.html`.
- **All OA communication goes through content script messaging:** popup sends `chrome.runtime.sendMessage` → content script makes the actual `fetch()` with `credentials: 'include'` (user's OA session cookies). The popup cannot call OA APIs directly.
- **Storage keys** in `chrome.storage.local`: `oaBaseUrls` (array of `{url, env, ldapId, appKey, appSecurity}`), `showConsole` (boolean), `showEnvironmentBorder` (boolean), `sqlConnId` (string, popup-level, global across environments).
- **OA URL matching must stay consistent:** `E10Utils.matchesOaUrl` / `findOaEntry` compare origin plus path boundary and pick the longest match. Duplicated matchers live in `content/message-bridge.js` and `background/service-worker.js` — update all copies together; never fall back to `startsWith` or to another environment's URL.
- **Show Console feature** hooks `history.pushState`/`replaceState` to inject `wea_link_keep_show_console` param into all OA navigation URLs.

## Editing guidelines

- All UI text is in Chinese (zh-CN). Keep it consistent.
- **Never commit real customer data or credentials:** OA base URLs of customer environments, LDAP IDs, `app_key` / `app_security` values, employee data, or screenshots of live systems. Use generic placeholders such as `https://oa.example.com`.
- Experimental features (`SQL 查询`, `单点登录`, `重新执行动作流`, ESB 日志 checkbox 解锁) are documented as experimental in `README.md`; keep that labeling in sync when behavior changes.
- OA API paths are hardcoded strings in `content/content.js` message handlers — update the content script handler, the matching handler in `content/message-bridge.js` (the on-demand fallback duplicates them), and the popup caller when adding new APIs.
- The extension matches `<all_urls>` for content scripts but only activates features on configured OA base URLs.
- `escapeHtml` / `escapeAttr` are duplicated in popup.js and options.js (no shared module for popup/options pages). Keep both in sync if you change one.
- Service worker uses `OffscreenCanvas` for badge icon generation — this is MV3-specific.

## Testing

No automated functional tests. `npm`-free static checks run in CI (`.github/workflows/syntax-check.yml`): `node --check` on every JS file, manifest validation, and a scan for hardcoded internal addresses / credentials.

Manual testing flow:
1. `chrome://extensions` → Load unpacked → select this directory
2. Configure an OA base URL in the options page
3. Navigate to that OA URL and verify badge green dot appears
4. Open popup and verify each menu item works: 环境边框, Show Console, 系统语言, 人员查询, LDAP 人员查询, SQL 查询, 人员信息记录, 查看实例日志, 重新执行动作流, 单点登录
5. Open a dev/test page and verify the environment border and the ESB log checkbox unlock (with Show Console on)
