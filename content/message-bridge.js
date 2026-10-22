/**
 * E10 Helper - Popup fallback message bridge
 * Used only when an existing tab did not receive the static content script.
 */
(function () {
  'use strict';

  if (globalThis.__e10HelperMessageBridgeInstalled) return;
  globalThis.__e10HelperMessageBridgeInstalled = true;

  // 与 lib/utils.js 的 matchesOaUrl 保持一致：按 origin + 路径边界匹配，
  // 避免相似域名（oa.example.com.evil.com）或子路径（/oa 命中 /oabc）误匹配
  function matchesOaUrl(href, baseUrl) {
    let target;
    let base;
    try {
      target = new URL(href);
      base = new URL(baseUrl);
    } catch {
      return false;
    }
    if (target.origin !== base.origin) return false;
    const basePath = base.pathname.replace(/\/+$/, '');
    const targetPath = target.pathname.replace(/\/+$/, '');
    return basePath === '' || targetPath === basePath || targetPath.startsWith(`${basePath}/`);
  }

  async function buildOaUrl(path) {
    const result = await chrome.storage.local.get('oaBaseUrls');
    const urls = result.oaBaseUrls || [];
    const currentUrl = window.location.href;
    const matched = urls
      .filter((item) => item && item.url && matchesOaUrl(currentUrl, item.url))
      .sort((a, b) => b.url.length - a.url.length)[0];

    if (!matched) throw new Error('当前页面未匹配 OA 地址');
    return `${matched.url.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
  }

  async function oaGet(path) {
    const url = await buildOaUrl(path);
    const separator = url.includes('?') ? '&' : '?';
    const randomKey = `randomkey_${Date.now().toString(36)}=${Math.random().toString(36).slice(2, 8)}`;
    const response = await fetch(`${url}${separator}${randomKey}`, { credentials: 'include' });
    if (!response.ok) throw new Error(`请求失败（HTTP ${response.status}）`);
    return response.json();
  }

  async function oaPost(path, body) {
    const url = await buildOaUrl(path);
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error(`请求失败（HTTP ${response.status}）`);
    return response.json();
  }

  async function getPersonnelRecords(targetId) {
    const filterConditions = JSON.stringify([{
      connectCondition: 'AND', columIndex: 'targetid', type: '=', value: String(targetId)
    }]);
    const listResp = await oaPost('/api/bs/hrm/employeeAndOrg/logger/table/getLogs', {
      module: 'hrm', function: 'employeeAndOrg', dataset: 'dataset',
      pageNum: 1, pageSize: 100, showColums: '[]', filterConditions,
      transMethod: 'employeeAndOrgMethod', searchMap: {}, authParams: {},
      moduleCustomParams: '', preQueryCustomParams: '', secondModule: ''
    });

    const logs = (listResp.data && listResp.data.data) || [];
    const meta = logs.map((it) => ({
      uuid: it.uuid,
      createTime: it.createdate || '',
      targetName: it.targetname || '',
      interfacename: it.interfacename || ''
    }));

    const results = new Array(meta.length);
    let cursor = 0;
    const worker = async () => {
      while (cursor < meta.length) {
        const i = cursor++;
        const log = meta[i];
        let detail = { groups: [], error: '' };
        if (log.uuid) {
          try {
            const path = `/api/bs/hrm/employeeAndOrg/logger/table/getDetailChanges?mainid=${encodeURIComponent(log.uuid)}&detailTransMethod=employeeAndOrgDetailMethod`;
            const resp = await oaGet(path);
            detail = { groups: Array.isArray(resp.data) ? resp.data : [], error: '' };
          } catch (err) {
            detail = { groups: [], error: err.message };
          }
        }
        results[i] = { meta: log, detail };
      }
    };
    await Promise.all(Array.from({ length: Math.min(6, meta.length || 1) }, () => worker()));

    function buildEvents(groups, time, operator) {
      const events = [];
      for (const group of groups) {
        const values = group.valueschanges;
        if (Array.isArray(values) && values.length) {
          values.forEach((line) => {
            const text = String(line);
            const m = text.match(/^【([^】]*)】：\s*由 \[(.*?)\] 改为 \[([\s\S]*)\]$/);
            if (m) events.push({ field: m[1] || '其他', time, operator, old: m[2], new: m[3] });
            else events.push({ field: '', time, operator, old: '', new: text });
          });
        } else {
          (group.detailcontexts || []).forEach((c) => {
            const newVal = c.newrealvalue || c.newvalue;
            const oldVal = c.oldrealvalue || c.oldvalue;
            events.push({
              field: c.fielddesc || c.fieldname || '',
              time,
              operator,
              old: oldVal == null ? '' : String(oldVal),
              new: newVal == null ? '' : String(newVal)
            });
          });
        }
      }
      return events;
    }

    const events = [];
    let targetName = '';
    let totalRecords = 0;
    for (const r of results) {
      if (!r || !r.meta || !r.meta.uuid) continue;
      totalRecords++;
      if (!targetName) targetName = r.meta.targetName || '';
      const main = (r.detail.groups[0] && r.detail.groups[0].maininfo) || {};
      events.push(...buildEvents(r.detail.groups, r.meta.createTime, (main.operatorname || '')));
    }

    return { targetName, totalRecords, events };
  }

  // --- 查看实例日志（与 content.js 保持一致） ---
  const INSTANCE_LOG_BUTTON_LABELS = ['执行实例', '更换实例'];
  const INSTANCE_LOG_SCOPE_SELECTOR = '.weapp-esb-setting-efdesigner-header-rightside';

  function findInstanceLogButton() {
    const scopes = [document.querySelector(INSTANCE_LOG_SCOPE_SELECTOR), document];
    for (const scope of scopes) {
      if (!scope) continue;
      for (const label of INSTANCE_LOG_BUTTON_LABELS) {
        const btn = Array.from(scope.querySelectorAll('button, .ui-btn')).find((el) => {
          if ((el.innerText || '').trim() !== label) return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
        if (btn) return btn;
      }
    }
    return null;
  }

  async function openInstanceLogDialog() {
    for (let i = 0; i < 24; i++) {
      const btn = findInstanceLogButton();
      if (btn) {
        btn.click();
        return { ok: true };
      }
      await new Promise((r) => setTimeout(r, 125));
    }
    throw new Error('未找到「执行实例 / 更换实例」入口，请确认当前在动作流设计器或动作流执行日志页');
  }

  // --- 人员信息记录：页面内弹窗（覆盖式，与 content.js 保持一致） ---
  const RECORDS_MODAL_ID = 'e10-records-modal';
  const RECORDS_STYLE_ID = 'e10-records-style';

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = (s == null ? '' : String(s));
    return d.innerHTML;
  }

  function escapeAttr(s) {
    return (s == null ? '' : String(s)).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function injectRecordsStyle() {
    if (document.getElementById(RECORDS_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = RECORDS_STYLE_ID;
    style.textContent = `
      #e10-records-modal {
        position: fixed; inset: 0; z-index: 2147483646; display: flex; align-items: center; justify-content: center;
        background: rgba(15, 23, 42, 0.45);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
        font-size: 13px; color: #2b3242;
      }
      #e10-records-modal * { box-sizing: border-box; }
      #e10-records-modal .e10rm-box { display: flex; flex-direction: column; width: min(96vw, 1024px); height: min(92vh, 860px); background: #fff; border-radius: 12px; box-shadow: 0 24px 60px rgba(0,0,0,.3); overflow: hidden; }
      #e10-records-modal .e10rm-head { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-bottom: 1px solid #e8ebf0; flex-shrink: 0; }
      #e10-records-modal .e10rm-title { font-size: 15px; font-weight: 600; color: #1f2d3d; white-space: nowrap; }
      #e10-records-modal .e10rm-target { color: #7a8499; font-size: 12px; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      #e10-records-modal .e10rm-search input { width: 240px; padding: 6px 10px; border: 1px solid #d6dbe3; border-radius: 8px; font-size: 13px; outline: none; }
      #e10-records-modal .e10rm-stats { margin-left: auto; display: flex; gap: 8px; }
      #e10-records-modal .e10rm-stats span { padding: 3px 9px; border-radius: 999px; background: #f0f3f8; font-size: 12px; color: #5b6472; white-space: nowrap; }
      #e10-records-modal .e10rm-close { flex-shrink: 0; border: none; background: #f1f3f7; border-radius: 8px; width: 30px; height: 30px; cursor: pointer; font-size: 17px; line-height: 1; color: #5b6472; }
      #e10-records-modal .e10rm-body { flex: 1; overflow: auto; padding: 14px 16px; display: flex; flex-direction: column; gap: 12px; }
      #e10-records-modal .e10rm-empty { text-align: center; color: #9aa5b1; padding: 50px 20px; }
      #e10-records-modal .e10rm-group { background: #fafbfd; border: 1px solid #e8ebf0; border-radius: 10px; overflow: hidden; flex-shrink: 0; }
      #e10-records-modal .e10rm-group > header { display: flex; align-items: center; padding: 8px 12px; gap: 8px; cursor: pointer; user-select: none; background: #f0f3f8; border-bottom: 1px solid #eef1f5; }
      #e10-records-modal .e10rm-group > header:hover { background: #e9edf5; }
      #e10-records-modal .e10rm-chevron { color: #98a2b3; font-size: 13px; transition: transform 0.16s; flex-shrink: 0; }
      #e10-records-modal .e10rm-group.open .e10rm-chevron { transform: rotate(90deg); }
      #e10-records-modal .e10rm-fname { font-weight: 600; color: #1f2d3d; font-size: 14px; }
      #e10-records-modal .e10rm-fcount { font-size: 11px; padding: 2px 9px; border-radius: 999px; background: #e3f2fd; color: #1976d2; font-weight: 600; margin-left: auto; white-space: nowrap; }
      #e10-records-modal .e10rm-events { min-width: 620px; display: none; }
      #e10-records-modal .e10rm-group.open .e10rm-events { display: block; }
      #e10-records-modal .e10rm-row { display: grid; grid-template-columns: minmax(150px,170px) minmax(110px,140px) minmax(130px,1fr) 22px minmax(130px,1fr); gap: 8px; align-items: start; min-height: 22px; padding: 6px 12px; border-bottom: 1px solid #f2f4f7; font-size: 12.5px; line-height: 1.5; }
      #e10-records-modal .e10rm-row:last-child { border-bottom: none; }
      #e10-records-modal .e10rm-time { color: #8a94a6; white-space: nowrap; font-variant-numeric: tabular-nums; }
      #e10-records-modal .e10rm-op { color: #556177; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      #e10-records-modal .e10rm-old { color: #c0392b; word-break: break-word; }
      #e10-records-modal .e10rm-arrow { color: #b8bfc9; text-align: center; }
      #e10-records-modal .e10rm-new { color: #1e8449; word-break: break-word; font-weight: 500; }
    `;
    document.documentElement.appendChild(style);
  }

  function groupRecordsEvents(events) {
    const map = new Map();
    for (const ev of events) {
      const f = (ev.field && String(ev.field).trim()) ? String(ev.field).trim() : '未命名字段';
      if (!map.has(f)) map.set(f, []);
      map.get(f).push(ev);
    }
    const groups = Array.from(map.entries()).map(([field, list]) => ({ field, list }));
    groups.sort((a, b) => b.list.length - a.list.length || (a.field < b.field ? -1 : a.field > b.field ? 1 : 0));
    return groups;
  }

  function renderRecordsGroups(data, box) {
    const searchInput = box.querySelector('.e10rm-search-input');
    const q = (searchInput && searchInput.value || '').trim().toLowerCase();
    let events = data.events;
    if (q) {
      events = events.filter((ev) =>
        String(ev.field || '').toLowerCase().includes(q) ||
        String(ev.old || '').toLowerCase().includes(q) ||
        String(ev.new || '').toLowerCase().includes(q) ||
        String(ev.operator || '').toLowerCase().includes(q)
      );
    }
    const groups = groupRecordsEvents(events);
    const labels = [`记录 ${data.totalRecords || 0} 条`, `变更 ${events.length} 次`, `字段 ${groups.length} 个`];
    box.querySelectorAll('.e10rm-stat').forEach((el, i) => { if (labels[i] != null) el.textContent = labels[i]; });

    const body = box.querySelector('.e10rm-body');
    if (!body) return;
    if (events.length === 0) { body.innerHTML = '<div class="e10rm-empty">没有匹配到任何变更记录。</div>'; return; }
    body.innerHTML = groups.map((g) => {
      const rows = g.list.slice().sort((a, b) => String(a.time || '').localeCompare(String(b.time || ''))).map((ev) => {
        const oldTxt = (ev.old === '' || ev.old == null) ? '(空)' : String(ev.old);
        const newTxt = (ev.new === '' || ev.new == null) ? '(空)' : String(ev.new);
        return '<div class="e10rm-row">' +
          `<span class="e10rm-time">${escapeHtml(ev.time || '')}</span>` +
          `<span class="e10rm-op" title="${escapeAttr(ev.operator || '')}">${escapeHtml(ev.operator || '—')}</span>` +
          `<span class="e10rm-old" title="${escapeAttr(oldTxt)}">${escapeHtml(oldTxt)}</span>` +
          '<span class="e10rm-arrow">→</span>' +
          `<span class="e10rm-new" title="${escapeAttr(newTxt)}">${escapeHtml(newTxt)}</span>` +
          '</div>';
      }).join('');
      return '<section class="e10rm-group">' +
        '<header><span class="e10rm-chevron">›</span>' +
        `<span class="e10rm-fname">${escapeHtml(g.field)}</span>` +
        `<span class="e10rm-fcount">${g.list.length} 次</span>` +
        '</header>' +
        `<div class="e10rm-events">${rows}</div></section>`;
    }).join('');

    body.querySelectorAll('.e10rm-group > header').forEach((head) => {
      head.addEventListener('click', () => head.closest('.e10rm-group').classList.toggle('open'));
    });
  }

  function showPersonnelRecordsModal(data) {
    injectRecordsStyle();
    removePersonnelRecordsModal();
    const overlay = document.createElement('div');
    overlay.id = RECORDS_MODAL_ID;
    overlay.innerHTML = '<div class="e10rm-box">' +
      '<div class="e10rm-head">' +
      '<span class="e10rm-title">人员信息记录</span>' +
      `<span class="e10rm-target">${escapeHtml((data && data.targetName) || '')}</span>` +
      '<div class="e10rm-search"><input class="e10rm-search-input" placeholder="按字段 / 值 / 操作人搜索…" autocomplete="off"></div>' +
      '<div class="e10rm-stats"><span class="e10rm-stat"></span><span class="e10rm-stat"></span><span class="e10rm-stat"></span></div>' +
      '<button class="e10rm-close" title="关闭" type="button">&times;</button>' +
      '</div><div class="e10rm-body"></div>' +
      '</div>';
    document.documentElement.appendChild(overlay);
    const box = overlay.querySelector('.e10rm-box') || overlay;
    overlay.querySelector('.e10rm-search-input').addEventListener('input', () => renderRecordsGroups(data, box));
    overlay.querySelector('.e10rm-close').addEventListener('click', removePersonnelRecordsModal);
    document.addEventListener('keydown', onRecordsEsc);
    renderRecordsGroups(data, box);
  }

  function removePersonnelRecordsModal() {
    const m = document.getElementById(RECORDS_MODAL_ID);
    if (m) m.remove();
  }

  function onRecordsEsc(e) {
    if (e.key === 'Escape') {
      const m = document.getElementById(RECORDS_MODAL_ID);
      if (m) { removePersonnelRecordsModal(); if (e.preventDefault) e.preventDefault(); }
    }
  }

  // --- 人员查询（通讯录快捷搜索） ---
  // 与 content.js 中的实现保持一致：关键词匹配 姓名 / 工号 / 邮箱 / 手机 / 办公电话
  const PERSON_SEARCH_FIELDS = ['username', 'job_num', 'email', 'mobile', 'telephone'];
  const PERSON_SEARCH_PAGE_SIZE = 50;

  async function searchPersons(keyword) {
    const kw = (keyword == null ? '' : String(keyword)).trim();
    // 空关键词会退化成「返回全部通讯录」，因此直接返回空结果。
    if (!kw) return { status: true, total: 0, list: [] };

    const resp = await oaPost('/api/bs/hrm/contact/main/table', {
      moduleType: 'organizationAddressBook',
      tabKey: 'resource',
      searchCount: true,
      formEnable: true,
      containDls: false,
      init: false,
      virtualId: '1',
      colSortList: [],
      orgContainChild: true,
      saCondition: {
        username: [{ username_condition: 'in' }],
        job_num: [{ job_num_condition: 'in' }],
        sex: [{ sex: 'all' }],
        personnel_status: [{ personnel_status: ['normal'] }],
        range: [{ range: ['containExtra'] }]
      },
      keyword: kw,
      keywordMatchFieldList: PERSON_SEARCH_FIELDS,
      saMatchType: 'and',
      isSearch: true,
      pageNum: 1,
      pageSize: PERSON_SEARCH_PAGE_SIZE
    });

    const data = (resp && resp.data) || {};

    // 部分列（部门 / 岗位 / 部门全称）的 dataIndex 是环境相关的自定义字段 ID，
    // 从响应自带的 columns 里按标题反查，避免不同环境字段 ID 不一致。
    const colIndex = {};
    (Array.isArray(data.columns) ? data.columns : []).forEach((c) => {
      if (c && c.title && c.dataIndex) colIndex[c.title] = c.dataIndex;
    });
    const pick = (item, title, fallbackKey) => {
      const key = colIndex[title];
      if (key && item[key] != null && item[key] !== '') return item[key];
      return fallbackKey ? (item[fallbackKey] || '') : '';
    };

    const list = (Array.isArray(data.data) ? data.data : [])
      .map((item) => ({
        id: String(item.id || ''),
        name: item.username || (item.avatar && item.avatar.name) || '',
        department: pick(item, 'Department'),
        section: pick(item, 'Section', 'department'),
        jobTitle: pick(item, 'Job Title'),
        departmentName: pick(item, 'Department Name'),
        email: item.email || '',
        account: item.account || '',
        status: item.lastnameDesc || ''
      }))
      .filter((p) => p.id);

    return {
      status: true,
      total: data.total != null ? data.total : list.length,
      list
    };
  }

  // --- SQL 查询（数据中心 · 直连数据源） ---
  // 与 content.js 中的实现保持一致
  const SQL_CONN_ID_DEFAULT = '4';

  async function executeSql(connId, sql) {
    const id = (connId == null || String(connId).trim() === '')
      ? SQL_CONN_ID_DEFAULT
      : String(connId).trim();
    const statement = (sql == null ? '' : String(sql)).trim();
    if (!statement) return { status: false, error: '请输入 SQL 语句' };

    const resp = await oaPost('/api/dw/directConn/executeSqlPreviewAndReturnAllData', {
      dataSetConn: { id },
      dataset: {
        sqlQuery: {
          sql: statement,
          fieldAlias: []
        }
      }
    });

    return normalizeSqlResponse(resp);
  }

  // 归一化为 { status, error, columns, rows, total, runTime }，便于弹窗统一渲染
  function normalizeSqlResponse(resp) {
    const actionMsg = resp && resp.actionMsg;
    if (actionMsg && Number(actionMsg.code) !== 0) {
      return {
        status: false,
        error: actionMsg.msg || actionMsg.message || actionMsg.codeMsg || 'SQL 执行失败'
      };
    }

    const payload = resp && resp.data;
    if (!payload) {
      const fallback = resp && (resp.msg || resp.errmsg || resp.message);
      return { status: false, error: fallback || (actionMsg && actionMsg.msg) || '接口未返回数据' };
    }
    if (!payload.data) {
      const message = typeof payload === 'string'
        ? payload
        : (payload.msg || payload.errmsg || payload.message || payload.errorMsg);
      return { status: false, error: message || '接口未返回结果集' };
    }

    const page = payload.data;
    const rows = Array.isArray(page.records) ? page.records : [];
    let columns = Array.isArray(payload.column)
      ? payload.column.filter((c) => c != null).map(String)
      : [];
    if (columns.length === 0 && rows.length > 0 && rows[0] && typeof rows[0] === 'object') {
      columns = Object.keys(rows[0]);
    }

    return {
      status: true,
      columns,
      rows,
      total: page.total != null ? page.total : rows.length,
      runTime: payload.runTime != null ? payload.runTime : null
    };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    let request;

    switch (message.action) {
      case 'getLanguage':
        request = oaGet('/api/bs/i18n/userlanguagemanage/getUserlanguage');
        break;

      case 'switchLanguage':
        request = oaGet(`/api/bs/i18n/userlanguagemanage/updateUserlanguage?langid=${message.langid}&langtype=${message.langtype}&langdesc=${encodeURIComponent(message.langdesc)}`);
        break;

      case 'ldapSearch':
        request = oaPost('/api/bs/intcenterldap/web/base_setting/ldapTool/search', {
          ldapId: message.ldapId,
          filter: message.filter
        });
        break;

      case 'ldapAttribute':
        request = oaPost('/api/bs/intcenterldap/web/base_setting/ldapTool/attribute', {
          ldapId: message.ldapId,
          rdn: message.rdn
        });
        break;

      case 'getLoginToken':
        request = oaPost('/papi/openapi/oauth2/get_logintoken', {
          app_key: message.appKey,
          app_security: message.appSecurity,
          account: message.account,
          authType: 'id'
        });
        break;

      case 'searchPerson':
        request = searchPersons(message.keyword);
        break;

      case 'executeSql':
        request = executeSql(message.connId, message.sql);
        break;

      case 'getPersonnelRecords':
        request = getPersonnelRecords(message.targetId);
        break;

      case 'openPersonnelRecords':
        request = getPersonnelRecords(message.targetId).then((data) => {
          showPersonnelRecordsModal(data);
          return { ok: true };
        });
        break;

      case 'closePersonnelRecords':
        request = Promise.resolve().then(() => {
          removePersonnelRecordsModal();
          return { ok: true };
        });
        break;

      case 'openInstanceLog':
        request = openInstanceLogDialog();
        break;

      default:
        return false;
    }

    request.then(sendResponse).catch((err) => sendResponse({ status: false, error: err.message }));
    return true;
  });
})();
