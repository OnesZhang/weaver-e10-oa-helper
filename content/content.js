/**
 * E10 Helper - Content Script
 * 注入到网页中，用于与E10 OA页面交互
 */
(function () {
  'use strict';

  // --- Show Console: 全局开关，自动为匹配的 OA 页面添加参数 ---
  const CONSOLE_PARAM = 'wea_link_keep_show_console';

  function hasConsoleParam() {
    return new URL(window.location.href).searchParams.has(CONSOLE_PARAM);
  }

  function hookHistory() {
    const origPush = history.pushState;
    const origReplace = history.replaceState;

    history.pushState = function (state, title, url) {
      if (url) {
        const u = new URL(url, window.location.origin);
        if (u.origin === window.location.origin && !u.searchParams.has(CONSOLE_PARAM)) {
          u.searchParams.set(CONSOLE_PARAM, '1');
          url = u.pathname + u.search + u.hash;
        }
      }
      return origPush.call(this, state, title, url);
    };

    history.replaceState = function (state, title, url) {
      if (url) {
        const u = new URL(url, window.location.origin);
        if (u.origin === window.location.origin && !u.searchParams.has(CONSOLE_PARAM)) {
          u.searchParams.set(CONSOLE_PARAM, '1');
          url = u.pathname + u.search + u.hash;
        }
      }
      return origReplace.call(this, state, title, url);
    };

    window.addEventListener('popstate', () => {
      if (!hasConsoleParam()) {
        const url = new URL(window.location.href);
        url.searchParams.set(CONSOLE_PARAM, '1');
        window.location.replace(url.toString());
      }
    });
  }

  /**
   * 解除 e-builder 动作流日志表格中 checkbox 的禁用状态
   * 通过 window.postMessage 发送给 inject.js (MAIN world)
   */
  function injectEsbLoggerCheckboxUnlock() {
    window.postMessage({
      type: 'E10_HELPER_INJECT',
      action: 'unlockEsbLoggerCheckbox'
    }, '*');
  }

  // --- 非生产环境全屏柔光边框 ---
  const ENV_COLORS = {
    dev:     { border: 'rgba(255, 152, 0, 0.55)',  label: '开发环境', labelBg: '#FF9800' },
    test:    { border: 'rgba(255, 152, 0, 0.55)',  label: '测试环境', labelBg: '#FF9800' },
    staging: { border: 'rgba(156, 39, 176, 0.55)',  label: '预发布环境', labelBg: '#9C27B0' }
  };

  function injectEnvironmentBorder(env) {
    if (document.getElementById('e10-helper-env-border')) return;

    const cfg = ENV_COLORS[env];
    if (!cfg) return;

    // 创建全屏边框
    const border = document.createElement('div');
    border.id = 'e10-helper-env-border';
    border.setAttribute('aria-hidden', 'true');

    // 创建顶部环境标签
    const label = document.createElement('div');
    label.id = 'e10-helper-env-label';
    label.textContent = cfg.label;
    border.appendChild(label);

    // 写入样式
    const style = document.createElement('style');
    style.textContent = `
      #e10-helper-env-border {
        position: fixed;
        inset: 0;
        z-index: 2147483646;
        pointer-events: none;
        border: 4px solid ${cfg.border};
        border-radius: 0;
        transition: opacity 0.3s;
      }
      #e10-helper-env-label {
        position: fixed;
        top: 8px;
        right: 8px;
        z-index: 2147483647;
        pointer-events: none;
        padding: 3px 10px;
        border-radius: 4px;
        background: ${cfg.labelBg};
        color: #fff;
        font-size: 11px;
        font-weight: 600;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        letter-spacing: 0.5px;
        line-height: 1.4;
        white-space: nowrap;
      }
      #e10-helper-env-border.e10-hidden {
        opacity: 0;
      }
    `;
    document.documentElement.appendChild(style);
    document.documentElement.appendChild(border);
  }


  function removeEnvironmentBorder() {
    const border = document.getElementById('e10-helper-env-border');
    if (border) border.remove();
    // 也移除对应的 style
    document.querySelectorAll('style').forEach(s => {
      if (s.textContent.includes('e10-helper-env-border')) s.remove();
    });
  }

  async function refreshEnvironmentBorder() {
    const [envStorage, borderStorage] = await Promise.all([
      new Promise((r) => chrome.storage.local.get('oaBaseUrls', r)),
      new Promise((r) => chrome.storage.local.get('showEnvironmentBorder', r))
    ]);

    const showBorder = !!borderStorage.showEnvironmentBorder;
    const oaUrls = envStorage.oaBaseUrls || [];
    const matched = E10Utils.findOaEntry(oaUrls, window.location.href);
    const isNonProd = matched && matched.env !== 'prod';

    if (showBorder && isNonProd) {
      injectEnvironmentBorder(matched.env);
    } else {
      removeEnvironmentBorder();
    }
  }

  // --- 查看实例日志 ---
  // 直接复用页面原生的「实例日志」弹窗：
  //   动作流设计器（/sp/workflow/pathset/actionDesigner）入口文案为「执行实例」
  //   动作流执行日志页（/sp/esb/efdesigner?showType=logger）入口文案为「更换实例」
  // 原生弹窗已经包含时间范围、操作者、执行方式、状态、版本号等筛选与分页，无需重新实现。
  const INSTANCE_LOG_BUTTON_LABELS = ['执行实例', '更换实例'];
  // 两个页面的头部操作区共用同一个 class，优先在其中查找，避免误命中页面其他按钮。
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
    // SPA 页面头部按钮可能稍晚渲染，最多等待约 3 秒。
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

  // --- 人员查询（通讯录快捷搜索） ---
  // 复用通讯录部门页的快捷搜索接口，关键词匹配 姓名 / 工号 / 邮箱 / 手机 / 办公电话。
  // 返回的人员 id 可直接拼成人员详情页 /sp/hrm/profileInfo/{id}。
  const PERSON_SEARCH_FIELDS = ['username', 'job_num', 'email', 'mobile', 'telephone'];
  const PERSON_SEARCH_PAGE_SIZE = 50;

  async function searchPersons(keyword) {
    const kw = (keyword == null ? '' : String(keyword)).trim();
    // 空关键词会退化成「返回全部通讯录」，因此直接返回空结果。
    if (!kw) return { status: true, total: 0, list: [] };

    const resp = await E10Utils.oaPost('/api/bs/hrm/contact/main/table', {
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
  // 复用数据中心「SQL 预览」接口，对直连数据源执行 SQL 并返回全部数据。
  // 响应结构（取自 dw 前端 lib.js）：
  //   { actionMsg: { code: 0 }, data: { column: [...], data: { records: [...], total, current, size }, runTime } }
  const SQL_CONN_ID_DEFAULT = '4';

  async function executeSql(connId, sql) {
    const id = (connId == null || String(connId).trim() === '')
      ? SQL_CONN_ID_DEFAULT
      : String(connId).trim();
    const statement = (sql == null ? '' : String(sql)).trim();
    if (!statement) return { status: false, error: '请输入 SQL 语句' };

    const resp = await E10Utils.oaPost('/api/dw/directConn/executeSqlPreviewAndReturnAllData', {
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
    // 没有结果集时，data 通常直接承载错误/提示信息
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
    // 兜底：接口未给 column 时，用第一条记录的键
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

  // --- 人员信息记录 ---
  // 与 SSO 一致：通过 personnel id 拉取员工的变更日志，并逐个拉取详细变更后汇总返回
  async function getPersonnelRecords(targetId) {
    const filterConditions = JSON.stringify([{
      connectCondition: 'AND',
      columIndex: 'targetid',
      type: '=',
      value: String(targetId)
    }]);

    const listResp = await E10Utils.oaPost('/api/bs/hrm/employeeAndOrg/logger/table/getLogs', {
      module: 'hrm',
      function: 'employeeAndOrg',
      dataset: 'dataset',
      pageNum: 1,
      pageSize: 100,
      showColums: '[]',
      filterConditions,
      transMethod: 'employeeAndOrgMethod',
      searchMap: {},
      authParams: {},
      moduleCustomParams: '',
      preQueryCustomParams: '',
      secondModule: ''
    });

    const logs = (listResp.data && listResp.data.data) || [];
    const meta = logs.map((it) => ({
      uuid: it.uuid,
      createTime: it.createdate || '',
      targetName: it.targetname || '',
      interfacename: it.interfacename || ''
    }));

    // 带并发限制地逐个拉取每条日志的详细变更（mainid = uuid）
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
            const resp = await E10Utils.oaGet(path);
            detail = { groups: Array.isArray(resp.data) ? resp.data : [], error: '' };
          } catch (err) {
            detail = { groups: [], error: err.message };
          }
        }
        results[i] = { meta: log, detail };
      }
    };
    const MAX_CONCURRENCY = 6;
    await Promise.all(
      Array.from({ length: Math.min(MAX_CONCURRENCY, meta.length || 1) }, () => worker())
    );

    // 汇总：优先使用 OA 已格式化好的 valueschanges；没有则退化为 detailcontexts 原始字段
    function buildEvents(groups, time, operator) {
      const events = [];
      for (const group of groups) {
        const values = group.valueschanges;
        if (Array.isArray(values) && values.length) {
          values.forEach((line) => {
            const text = String(line);
            const m = text.match(/^【([^】]*)】：\s*由 \[(.*?)\] 改为 \[([\s\S]*)\]$/);
            if (m) {
              events.push({ field: m[1] || '其他', time, operator, old: m[2], new: m[3] });
            } else {
              events.push({ field: '', time, operator, old: '', new: text });
            }
          });
        } else {
          (group.detailcontexts || []).forEach((c) => {
            const newVal = c.newrealvalue || c.newvalue;
            const oldVal = c.oldrealvalue || c.oldvalue;
            events.push({
              field: c.fielddesc || c.fieldname || '',
              time,
              operator,
              old: oldVal == null ? '' : (Array.isArray(oldVal) ? JSON.stringify(oldVal) : String(oldVal)),
              new: newVal == null ? '' : (Array.isArray(newVal) ? JSON.stringify(newVal) : String(newVal))
            });
          });
        }
      }
      return events;
    }

    const valid = [];
    const events = [];
    let targetName = '';
    for (const r of results) {
      if (!r || !r.meta || !r.meta.uuid) continue;
      if (!targetName) targetName = r.meta.targetName || '';
      const main = (r.detail.groups[0] && r.detail.groups[0].maininfo) || {};
      const operator = main.operatorname || '';
      events.push(...buildEvents(r.detail.groups, r.meta.createTime, operator));
      valid.push(r);
    }

    return {
      targetName,
      totalRecords: valid.length,
      events
    };
  }

  // --- 人员信息记录：页面内弹窗（覆盖式） ---
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
        position: fixed;
        inset: 0;
        z-index: 2147483646;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(15, 23, 42, 0.45);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
        font-size: 13px;
        color: #2b3242;
      }
      #e10-records-modal * { box-sizing: border-box; }
      #e10-records-modal .e10rm-box {
        display: flex;
        flex-direction: column;
        width: min(96vw, 1024px);
        height: min(92vh, 860px);
        background: #fff;
        border-radius: 12px;
        box-shadow: 0 24px 60px rgba(0, 0, 0, 0.3);
        overflow: hidden;
      }
      #e10-records-modal .e10rm-head {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px 16px;
        border-bottom: 1px solid #e8ebf0;
        flex-shrink: 0;
      }
      #e10-records-modal .e10rm-title { font-size: 15px; font-weight: 600; color: #1f2d3d; white-space: nowrap; }
      #e10-records-modal .e10rm-target { color: #7a8499; font-size: 12px; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      #e10-records-modal .e10rm-search input {
        width: 240px; padding: 6px 10px; border: 1px solid #d6dbe3; border-radius: 8px; font-size: 13px; outline: none;
      }
      #e10-records-modal .e10rm-search input:focus { border-color: #2196f3; box-shadow: 0 0 0 2px rgba(33,150,243,.12); }
      #e10-records-modal .e10rm-stats { margin-left: auto; display: flex; gap: 8px; }
      #e10-records-modal .e10rm-stats span { padding: 3px 9px; border-radius: 999px; background: #f0f3f8; font-size: 12px; color: #5b6472; white-space: nowrap; }
      #e10-records-modal .e10rm-close {
        flex-shrink: 0; border: none; background: #f1f3f7; border-radius: 8px; width: 30px; height: 30px; cursor: pointer;
        font-size: 17px; line-height: 1; color: #5b6472;
      }
      #e10-records-modal .e10rm-close:hover { background: #e6e9ef; }
      #e10-records-modal .e10rm-body {
        flex: 1; overflow: auto; padding: 14px 16px; display: flex; flex-direction: column; gap: 12px;
      }
      #e10-records-modal .e10rm-empty { text-align: center; color: #9aa5b1; padding: 50px 20px; }
      #e10-records-modal .e10rm-group { background: #fafbfd; border: 1px solid #e8ebf0; border-radius: 10px; overflow: hidden; flex-shrink: 0; }
      #e10-records-modal .e10rm-group > header {
        display: flex; align-items: center; padding: 8px 12px; gap: 8px; cursor: pointer; user-select: none;
        background: #f0f3f8; border-bottom: 1px solid #eef1f5;
      }
      #e10-records-modal .e10rm-group > header:hover { background: #e9edf5; }
      #e10-records-modal .e10rm-chevron { color: #98a2b3; font-size: 13px; transition: transform 0.16s; flex-shrink: 0; }
      #e10-records-modal .e10rm-group.open .e10rm-chevron { transform: rotate(90deg); }
      #e10-records-modal .e10rm-fname { font-weight: 600; color: #1f2d3d; font-size: 14px; }
      #e10-records-modal .e10rm-fcount { font-size: 11px; padding: 2px 9px; border-radius: 999px; background: #e3f2fd; color: #1976d2; font-weight: 600; margin-left: auto; white-space: nowrap; }
      #e10-records-modal .e10rm-events { min-width: 620px; display: none; }
      #e10-records-modal .e10rm-group.open .e10rm-events { display: block; }
      #e10-records-modal .e10rm-row {
        display: grid;
        grid-template-columns: minmax(150px, 170px) minmax(110px, 140px) minmax(130px, 1fr) 22px minmax(130px, 1fr);
        gap: 8px;
        align-items: start;
        min-height: 22px;
        padding: 6px 12px;
        border-bottom: 1px solid #f2f4f7;
        font-size: 12.5px;
        line-height: 1.5;
      }
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
    groups.sort((a, b) =>
      b.list.length - a.list.length || (a.field < b.field ? -1 : a.field > b.field ? 1 : 0)
    );
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

    const statsEls = box.querySelectorAll('.e10rm-stat');
    if (statsEls.length) {
      const labels = [`记录 ${data.totalRecords || 0} 条`, `变更 ${events.length} 次`, `字段 ${groups.length} 个`];
      statsEls.forEach((el, i) => { if (labels[i] != null) el.textContent = labels[i]; });
    }

    const body = box.querySelector('.e10rm-body');
    if (!body) return;
    if (events.length === 0) {
      body.innerHTML = '<div class="e10rm-empty">没有匹配到任何变更记录。</div>';
      return;
    }
    body.innerHTML = groups.map((g) => {
      const rows = g.list
        .slice()
        .sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')))
        .map((ev) => {
          const oldTxt = (ev.old === '' || ev.old == null) ? '(空)' : String(ev.old);
          const newTxt = (ev.new === '' || ev.new == null) ? '(空)' : String(ev.new);
          return '' +
            '<div class="e10rm-row">' +
            `<span class="e10rm-time">${escapeHtml(ev.time || '')}</span>` +
            `<span class="e10rm-op" title="${escapeAttr(ev.operator || '')}">${escapeHtml(ev.operator || '—')}</span>` +
            `<span class="e10rm-old" title="${escapeAttr(oldTxt)}">${escapeHtml(oldTxt)}</span>` +
            '<span class="e10rm-arrow">→</span>' +
            `<span class="e10rm-new" title="${escapeAttr(newTxt)}">${escapeHtml(newTxt)}</span>` +
            '</div>';
        })
        .join('');
      return '' +
        '<section class="e10rm-group">' +
        '<header>' +
        '<span class="e10rm-chevron">›</span>' +
        `<span class="e10rm-fname">${escapeHtml(g.field)}</span>` +
        `<span class="e10rm-fcount">${g.list.length} 次</span>` +
        '</header>' +
        `<div class="e10rm-events">${rows}</div>` +
        '</section>';
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
    overlay.innerHTML = '' +
      '<div class="e10rm-box">' +
      '<div class="e10rm-head">' +
      '<span class="e10rm-title">人员信息记录</span>' +
      `<span class="e10rm-target">${escapeHtml((data && data.targetName) || '')}</span>` +
      '<div class="e10rm-search"><input class="e10rm-search-input" placeholder="按字段 / 值 / 操作人搜索…" autocomplete="off"></div>' +
      '<div class="e10rm-stats"><span class="e10rm-stat"></span><span class="e10rm-stat"></span><span class="e10rm-stat"></span></div>' +
      '<button class="e10rm-close" title="关闭" type="button">&times;</button>' +
      '</div>' +
      '<div class="e10rm-body"></div>' +
      '</div>';
    document.documentElement.appendChild(overlay);

    overlay.querySelector('.e10rm-search-input').addEventListener('input', () => renderRecordsGroups(data, boxEl(overlay)));
    overlay.querySelector('.e10rm-close').addEventListener('click', removePersonnelRecordsModal);
    document.addEventListener('keydown', onRecordsEsc);
    renderRecordsGroups(data, boxEl(overlay));
  }

  function boxEl(overlay) {
    return overlay.querySelector('.e10rm-box') || overlay;
  }

  function removePersonnelRecordsModal() {
    const m = document.getElementById(RECORDS_MODAL_ID);
    if (m) m.remove();
  }

  function onRecordsEsc(e) {
    if (e.key === 'Escape') {
      const m = document.getElementById(RECORDS_MODAL_ID);
      if (m) {
        removePersonnelRecordsModal();
        if (e.preventDefault) e.preventDefault();
      }
    }
  }

  // --- 消息监听 ---
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.action) {
      case 'getLanguage':
        E10Utils.oaGet('/api/bs/i18n/userlanguagemanage/getUserlanguage')
          .then(sendResponse)
          .catch((err) => sendResponse({ status: false, error: err.message }));
        return true;

      case 'switchLanguage':
        E10Utils.oaGet(`/api/bs/i18n/userlanguagemanage/updateUserlanguage?langid=${message.langid}&langtype=${message.langtype}&langdesc=${encodeURIComponent(message.langdesc)}`)
          .then(sendResponse)
          .catch((err) => sendResponse({ status: false, error: err.message }));
        return true;

      case 'ldapSearch':
        E10Utils.oaPost('/api/bs/intcenterldap/web/base_setting/ldapTool/search', {
          ldapId: message.ldapId,
          filter: message.filter
        })
          .then(sendResponse)
          .catch((err) => sendResponse({ status: false, error: err.message }));
        return true;

      case 'ldapAttribute':
        E10Utils.oaPost('/api/bs/intcenterldap/web/base_setting/ldapTool/attribute', {
          ldapId: message.ldapId,
          rdn: message.rdn
        })
          .then(sendResponse)
          .catch((err) => sendResponse({ status: false, error: err.message }));
        return true;

      case 'getLoginToken':
        E10Utils.oaPost('/papi/openapi/oauth2/get_logintoken', {
          app_key: message.appKey,
          app_security: message.appSecurity,
          account: message.account,
          authType: 'id'
        })
          .then(sendResponse)
          .catch((err) => sendResponse({ status: false, error: err.message }));
        return true;

      case 'refreshEnvironmentBorder':
        refreshEnvironmentBorder().then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
        return true;

      case 'searchPerson':
        searchPersons(message.keyword)
          .then(sendResponse)
          .catch((err) => sendResponse({ status: false, error: err.message }));
        return true;

      case 'executeSql':
        executeSql(message.connId, message.sql)
          .then(sendResponse)
          .catch((err) => sendResponse({ status: false, error: err.message }));
        return true;

      case 'getPersonnelRecords':
        getPersonnelRecords(message.targetId)
          .then(sendResponse)
          .catch((err) => sendResponse({ status: false, error: err.message }));
        return true;

      case 'openPersonnelRecords':
        getPersonnelRecords(message.targetId)
          .then((data) => {
            showPersonnelRecordsModal(data);
            sendResponse({ ok: true });
          })
          .catch((err) => sendResponse({ status: false, error: err.message }));
        return true;

      case 'closePersonnelRecords':
        removePersonnelRecordsModal();
        sendResponse({ ok: true });
        return true;

      case 'openInstanceLog':
        openInstanceLogDialog()
          .then(sendResponse)
          .catch((err) => sendResponse({ ok: false, error: err.message }));
        return true;
    }
    return false;
  });

  // --- 监听存储变化，实时更新边框 ---
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.showEnvironmentBorder || changes.oaBaseUrls)) {
      refreshEnvironmentBorder().catch((err) => E10Utils.log('刷新环境边框失败', err));
    }
  });

  // 初始化不应阻塞消息监听，避免存储或页面初始化异常导致所有弹窗功能不可用。
  initialize().catch((err) => E10Utils.log('内容脚本初始化失败', err));

  async function initialize() {
    const [consoleStorage, urlStorage] = await Promise.all([
      new Promise((r) => chrome.storage.local.get('showConsole', r)),
      new Promise((r) => chrome.storage.local.get('oaBaseUrls', r))
    ]);
    const showConsole = !!consoleStorage.showConsole;
    const oaUrls = urlStorage.oaBaseUrls || [];
    const isOaPage = !!E10Utils.findOaEntry(oaUrls, window.location.href);

    await refreshEnvironmentBorder();

    if (showConsole && isOaPage) {
      if (!hasConsoleParam()) {
        const url = new URL(window.location.href);
        url.searchParams.set(CONSOLE_PARAM, '1');
        window.location.replace(url.toString());
        return;
      }
      hookHistory();
      injectEsbLoggerCheckboxUnlock();
    }
  }
})();
