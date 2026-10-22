/**
 * E10 Helper - Popup 逻辑
 */
document.addEventListener('DOMContentLoaded', async () => {
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');

  // 检测当前标签页是否为已配置的 E10 页面
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const urlStorage = await chrome.storage.local.get('oaBaseUrls');
  const oaUrls = (urlStorage.oaBaseUrls || []);
  const matchedEntry = tab.url ? E10Utils.findOaEntry(oaUrls, tab.url) : null;
  const connected = !!matchedEntry;

  async function sendToContentScript(message) {
    try {
      return await chrome.tabs.sendMessage(tab.id, message);
    } catch (err) {
      if (!/Receiving end does not exist/i.test(err.message || '')) throw err;

      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content/message-bridge.js']
      });
      return chrome.tabs.sendMessage(tab.id, message);
    }
  }

  if (connected) {
    statusDot.classList.add('active');
    statusText.textContent = '已连接';
  } else {
    statusDot.classList.add('inactive');
    statusText.textContent = '未连接';
  }

  // 打开设置页面
  document.getElementById('btnSettings').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  // --- 二级菜单导航 ---
  const mainPanel = document.getElementById('mainPanel');
  const langPanel = document.getElementById('langPanel');
  const menuLang = document.getElementById('menuLang');
  const menuLdap = document.getElementById('menuLdap');
  const menuPerson = document.getElementById('menuPerson');
  const menuSql = document.getElementById('menuSql');
  const langBack = document.getElementById('langBack');
  const langLoading = document.getElementById('langLoading');
  const langContent = document.getElementById('langContent');
  const langCurrent = document.getElementById('langCurrent');
  const langList = document.getElementById('langList');

  // 隐藏菜单项（未连接时）
  const menuConsole = document.getElementById('menuConsole');
  const menuEnvBorder = document.getElementById('menuEnvBorder');
  const envBorderToggle = document.getElementById('envBorderToggle');
  if (!connected) {
    menuLang.style.display = 'none';
    menuLdap.style.display = 'none';
    menuPerson.style.display = 'none';
    menuSql.style.display = 'none';
    menuConsole.style.display = 'none';
    menuEnvBorder.style.display = 'none';
  }

  // --- 环境边框：全局开关 ---
  const envBorderState = await chrome.storage.local.get('showEnvironmentBorder');
  let showEnvBorderOn = !!envBorderState.showEnvironmentBorder;

  function updateEnvBorderUI() {
    envBorderToggle.classList.toggle('on', showEnvBorderOn);
  }
  updateEnvBorderUI();

  menuEnvBorder.addEventListener('click', async () => {
    showEnvBorderOn = !showEnvBorderOn;
    await chrome.storage.local.set({ showEnvironmentBorder: showEnvBorderOn });
    updateEnvBorderUI();
    // 通知 content script 刷新边框
    try {
      await sendToContentScript({ action: 'refreshEnvironmentBorder' });
    } catch {
      // content script 可能未注入，忽略
    }
  });

  // Show Console: 全局开关
  const consoleState = await chrome.storage.local.get('showConsole');
  let showConsoleOn = !!consoleState.showConsole;

  if (showConsoleOn) {
    menuConsole.querySelector('span').textContent = 'Show Console ✓';
  }

  menuConsole.addEventListener('click', async () => {
    showConsoleOn = !showConsoleOn;
    await chrome.storage.local.set({ showConsole: showConsoleOn });
    menuConsole.querySelector('span').textContent = showConsoleOn ? 'Show Console ✓' : 'Show Console';
    // 当前页面刷新使其生效
    chrome.tabs.reload(tab.id);
    window.close();
  });

  // 从已匹配的条目中读取配置
  const currentLdapId = matchedEntry ? matchedEntry.ldapId : '';
  const currentAppKey = matchedEntry ? matchedEntry.appKey : '';
  const currentAppSecurity = matchedEntry ? matchedEntry.appSecurity : '';

  // --- 单点登录：检测人员档案页面 ---
  const ssoMatch = tab.url && tab.url.match(/\/sp\/hrm\/profileInfo\/(\d+)/);
  const menuSso = document.getElementById('menuSso');

  // --- 重新执行动作流 ---
  if (tab.url) {
    const esbUrl = new URL(tab.url);
    const hasEsbPath = esbUrl.pathname.includes('/sp/esb/efdesigner');
    const app = esbUrl.searchParams.get('application');
    const logId = esbUrl.searchParams.get('logId');
    const menuEsb = document.getElementById('menuEsb');

    if (connected && hasEsbPath && app && logId) {
      menuEsb.style.display = '';
      menuEsb.addEventListener('click', () => {
        const target = `${esbUrl.origin}${esbUrl.pathname}?module=esb&application=${encodeURIComponent(app)}&logId=${encodeURIComponent(logId)}&showType=execute`;
        chrome.tabs.update(tab.id, { url: target });
        window.close();
      });
    }
  }

  // --- 查看实例日志 ---
  // 动作流设计器（/sp/workflow/pathset/actionDesigner）与动作流执行日志页（/sp/esb/efdesigner）
  // 都能打开页面原生的「实例日志」弹窗，入口文案分别是「执行实例」和「更换实例」。
  const menuInstanceLog = document.getElementById('menuInstanceLog');
  if (connected && tab.url) {
    const instanceLogUrl = new URL(tab.url);
    const isActionDesigner = instanceLogUrl.pathname.includes('/sp/workflow/pathset/actionDesigner');
    const isEfDesigner = instanceLogUrl.pathname.includes('/sp/esb/efdesigner');

    if (isActionDesigner || isEfDesigner) {
      menuInstanceLog.style.display = '';
      menuInstanceLog.addEventListener('click', async () => {
        menuInstanceLog.style.opacity = '0.5';
        menuInstanceLog.style.pointerEvents = 'none';
        try {
          const resp = await sendToContentScript({ action: 'openInstanceLog' });
          if (resp && resp.ok) {
            window.close();
            return;
          }
          alert('打开实例日志失败：' + ((resp && resp.error) || '页面未找到入口按钮'));
        } catch (err) {
          alert('打开实例日志失败：' + (err.message || '请求失败'));
        }
        menuInstanceLog.style.opacity = '';
        menuInstanceLog.style.pointerEvents = '';
      });
    }
  }

  if (connected && ssoMatch && currentAppKey && currentAppSecurity) {
    const personId = ssoMatch[1];
    menuSso.style.display = '';

    menuSso.addEventListener('click', async () => {
      menuSso.style.opacity = '0.5';
      menuSso.style.pointerEvents = 'none';
      try {
        const resp = await sendToContentScript({
          action: 'getLoginToken',
          appKey: currentAppKey,
          appSecurity: currentAppSecurity,
          account: personId
        });
        if (resp && resp.errcode === '0') {
          const token = resp.etLoginToken;
          if (token) {
            const oaBase = matchedEntry.url;
            const ssoUrl = `${oaBase}/papi/open/singleSignon?singleToken=${encodeURIComponent(token)}&oauthType=singlesign&redirect_uri=/`;
            try {
              await chrome.windows.create({ url: ssoUrl, incognito: true });
              window.close();
            } catch {
              alert('无法打开隐私窗口，请在扩展管理页面开启「允许在隐私模式下使用」');
            }
          } else {
            alert('获取 Token 失败');
          }
        } else {
          alert('获取 Token 失败: ' + (resp && resp.errmsg || '未知错误'));
        }
      } catch (err) {
        alert('请求失败: ' + err.message);
      }
      menuSso.style.opacity = '';
      menuSso.style.pointerEvents = '';
    });
  }

  // --- 人员信息记录 ---
  const recordsTargetId = ssoMatch ? ssoMatch[1] : '';
  const menuRecords = document.getElementById('menuRecords');
  const recordsPanel = document.getElementById('recordsPanel');
  const recordsLoading = document.getElementById('recordsLoading');

  if (connected && ssoMatch && recordsTargetId) {
    menuRecords.style.display = '';
  }

  document.getElementById('recordsBack').addEventListener('click', () => {
    recordsPanel.style.display = 'none';
    mainPanel.style.display = 'block';
  });

  menuRecords.addEventListener('click', async () => {
    mainPanel.style.display = 'none';
    recordsPanel.style.display = 'block';
    recordsLoading.style.display = 'block';
    recordsLoading.textContent = '正在加载记录，请稍候...';

    try {
      const resp = await sendToContentScript({ action: 'openPersonnelRecords', targetId: recordsTargetId });
      if (!resp || resp.ok !== true) {
        throw new Error((resp && resp.error) || '接口返回异常');
      }
      window.close();
    } catch (err) {
      recordsLoading.textContent = '加载失败：' + (err.message || '请求失败');
    }
  });

  // 进入语言面板（点击时才请求接口）
  menuLang.addEventListener('click', async () => {
    if (!connected) return;
    mainPanel.style.display = 'none';
    langPanel.style.display = 'block';
    langLoading.style.display = 'block';
    langLoading.textContent = '加载中...';
    langContent.style.display = 'none';

    try {
      const resp = await sendToContentScript({ action: 'getLanguage' });
      if (resp && resp.status && resp.data) {
        renderLanguages(resp.data);
      } else {
        langLoading.textContent = `获取失败${getRequestError(resp)}`;
      }
    } catch (err) {
      langLoading.textContent = `获取失败${getRequestError(err)}`;
    }
  });

  langBack.addEventListener('click', () => {
    langPanel.style.display = 'none';
    mainPanel.style.display = 'block';
  });

  function renderLanguages(data) {
    const languages = Array.isArray(data.langList) ? data.langList : data.languageList;
    const current = data.currentLanguage || (languages || []).find((lang) => lang.langid === data.activeValue);
    if (!Array.isArray(languages) || !current) {
      throw new Error('接口返回的语言数据格式不正确');
    }

    langLoading.style.display = 'none';
    langContent.style.display = 'block';

    langCurrent.textContent = `当前语言: ${current.langdesc} (${current.langtype})`;

    langList.innerHTML = languages
      .map((lang) => {
        const isCurrent = lang.langid === current.langid
          && (!current.langtype || lang.langtype === current.langtype);
        const beta = lang.activable !== 1 ? ' <span class="lang-tag">Beta</span>' : '';
        return `<div class="lang-item ${isCurrent ? 'current' : ''}" data-langid="${escapeAttr(lang.langid)}" data-langtype="${escapeAttr(lang.langtype)}" data-langdesc="${escapeAttr(lang.langdesc)}">${escapeHtml(lang.langdesc)}${beta}<span class="lang-badge">${escapeHtml(lang.langtype)}</span></div>`;
      })
      .join('');

    langList.querySelectorAll('.lang-item:not(.current)').forEach((el) => {
      el.addEventListener('click', () => switchLanguage(el.dataset));
    });
  }

  async function switchLanguage({ langid, langtype, langdesc }) {
    langCurrent.textContent = '切换中...';
    langList.style.opacity = '0.5';
    langList.style.pointerEvents = 'none';

    try {
      const result = await sendToContentScript({
        action: 'switchLanguage',
        langid,
        langtype,
        langdesc
      });
      if (result && result.status) {
        chrome.tabs.reload(tab.id);
        window.close();
      } else {
        langCurrent.textContent = '切换失败';
        langList.style.opacity = '';
        langList.style.pointerEvents = '';
      }
    } catch {
      langCurrent.textContent = '切换失败';
      langList.style.opacity = '';
      langList.style.pointerEvents = '';
    }
  }

  // --- 人员查询（通讯录快捷搜索） ---
  const personPanel = document.getElementById('personPanel');
  const personBack = document.getElementById('personBack');
  const personKeyword = document.getElementById('personKeyword');
  const personSearchBtn = document.getElementById('personSearchBtn');
  const personResults = document.getElementById('personResults');

  menuPerson.addEventListener('click', () => {
    if (!connected) return;
    mainPanel.style.display = 'none';
    personPanel.style.display = 'block';
    personKeyword.focus();
    personKeyword.select();
  });

  personBack.addEventListener('click', () => {
    personPanel.style.display = 'none';
    mainPanel.style.display = 'block';
  });

  personSearchBtn.addEventListener('click', doPersonSearch);
  personKeyword.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doPersonSearch();
  });

  async function doPersonSearch() {
    const keyword = personKeyword.value.trim();
    if (!keyword) {
      personResults.innerHTML = '<div class="ldap-empty">请输入关键词</div>';
      return;
    }

    personSearchBtn.disabled = true;
    personResults.innerHTML = '<div class="lang-loading">查询中...</div>';

    try {
      const resp = await sendToContentScript({ action: 'searchPerson', keyword });
      if (resp && resp.status !== false && Array.isArray(resp.list)) {
        renderPersonResults(resp);
      } else {
        renderPersonError(`查询失败${getRequestError(resp)}`);
      }
    } catch (err) {
      renderPersonError(`查询失败${getRequestError(err)}`);
    }
    personSearchBtn.disabled = false;
  }

  function renderPersonResults(data) {
    const list = data.list || [];
    if (list.length === 0) {
      personResults.innerHTML = '<div class="ldap-empty">未找到人员</div>';
      return;
    }

    const total = Number(data.total) || list.length;
    const summary = total > list.length
      ? `共 ${total} 人，显示前 ${list.length} 人`
      : `共 ${total} 人`;

    personResults.innerHTML = `<div class="person-summary">${escapeHtml(summary)}</div>`
      + list.map((p) => {
        const dept = [p.department, p.section].filter(Boolean).join(' / ');
        const sub = [dept, p.jobTitle].filter(Boolean).join(' · ');
        const inactive = p.status ? `<span class="person-tag">${escapeHtml(p.status)}</span>` : '';
        return '' +
          `<div class="person-result-item" data-id="${escapeAttr(p.id)}" title="查看人员详情">` +
          `<div class="person-line1"><span class="person-name">${escapeHtml(p.name || p.account)}</span>${inactive}</div>` +
          (sub ? `<div class="person-line2" title="${escapeAttr(sub)}">${escapeHtml(sub)}</div>` : '') +
          (p.email ? `<div class="person-line3">${escapeHtml(p.email)}</div>` : '') +
          '</div>';
      })
      .join('');

    personResults.querySelectorAll('.person-result-item').forEach((el) => {
      el.addEventListener('click', () => openPersonDetail(el.dataset.id));
    });
  }

  function renderPersonError(message) {
    const error = document.createElement('div');
    error.className = 'ldap-empty';
    error.textContent = message;
    personResults.replaceChildren(error);
  }

  // 跳转到人员详情页（/sp/hrm/profileInfo/{id}）
  function openPersonDetail(id) {
    if (!id || !matchedEntry) return;
    const base = matchedEntry.url.replace(/\/+$/, '');
    chrome.tabs.create({
      url: `${base}/sp/hrm/profileInfo/${encodeURIComponent(id)}`,
      active: true
    });
    window.close();
  }

  // --- SQL 查询（数据中心 · 直连数据源） ---
  const sqlPanel = document.getElementById('sqlPanel');
  const sqlBack = document.getElementById('sqlBack');
  const sqlConnId = document.getElementById('sqlConnId');
  const sqlRunBtn = document.getElementById('sqlRunBtn');
  const sqlInput = document.getElementById('sqlInput');
  const sqlStatus = document.getElementById('sqlStatus');
  const sqlResult = document.getElementById('sqlResult');

  const SQL_CONN_ID_DEFAULT = '4';
  // 弹窗表格一次渲染上限，避免超大结果集卡住 popup
  const SQL_MAX_RENDER_ROWS = 200;

  // 连接 ID 为全局配置（不区分环境），修改后记住
  const sqlConnState = await chrome.storage.local.get('sqlConnId');
  sqlConnId.value = sqlConnState.sqlConnId || SQL_CONN_ID_DEFAULT;

  menuSql.addEventListener('click', () => {
    if (!connected) return;
    mainPanel.style.display = 'none';
    sqlPanel.style.display = 'block';
    sqlInput.focus();
  });

  sqlBack.addEventListener('click', () => {
    sqlPanel.style.display = 'none';
    mainPanel.style.display = 'block';
  });

  sqlRunBtn.addEventListener('click', runSql);
  sqlConnId.addEventListener('change', saveSqlConnId);
  sqlConnId.addEventListener('blur', saveSqlConnId);
  sqlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      runSql();
    }
  });

  async function saveSqlConnId() {
    const value = sqlConnId.value.trim() || SQL_CONN_ID_DEFAULT;
    await chrome.storage.local.set({ sqlConnId: value });
  }

  async function runSql() {
    const sql = sqlInput.value.trim();
    if (!sql) {
      showSqlStatus('请输入 SQL 语句', 'error');
      return;
    }

    await saveSqlConnId();

    sqlRunBtn.disabled = true;
    showSqlStatus('执行中...', 'loading');
    sqlResult.innerHTML = '';

    try {
      const resp = await sendToContentScript({
        action: 'executeSql',
        connId: sqlConnId.value.trim() || SQL_CONN_ID_DEFAULT,
        sql
      });
      if (resp && resp.status !== false && Array.isArray(resp.rows)) {
        renderSqlResult(resp);
      } else {
        showSqlStatus(`执行失败${getRequestError(resp)}`, 'error');
      }
    } catch (err) {
      showSqlStatus(`执行失败${getRequestError(err)}`, 'error');
    }
    sqlRunBtn.disabled = false;
  }

  function showSqlStatus(message, kind) {
    sqlStatus.style.display = 'block';
    sqlStatus.className = `sql-status${kind ? ` sql-status-${kind}` : ''}`;
    sqlStatus.textContent = message;
  }

  function renderSqlResult(data) {
    const columns = data.columns || [];
    const rows = data.rows || [];

    if (rows.length === 0 || columns.length === 0) {
      showSqlStatus(`查询成功，但没有返回数据${data.runTime != null ? ` · 耗时 ${data.runTime} ms` : ''}`, 'ok');
      return;
    }

    const shown = Math.min(rows.length, SQL_MAX_RENDER_ROWS);
    const parts = [`${data.total != null ? data.total : rows.length} 行`];
    if (data.runTime != null) parts.push(`耗时 ${data.runTime} ms`);
    if (rows.length > shown) parts.push(`仅显示前 ${shown} 行`);
    showSqlStatus(parts.join(' · '), 'ok');

    // 记录里的键大小写可能与 column 不完全一致，按原样 / 大写 / 小写依次兜底
    const cell = (row, col) => {
      if (row == null) return '';
      let value = row[col];
      if (value === undefined) value = row[String(col).toUpperCase()];
      if (value === undefined) value = row[String(col).toLowerCase()];
      if (value === undefined || value === null) return '';
      if (typeof value === 'object') return JSON.stringify(value);
      return String(value);
    };

    // 单元格内容来自数据库，属于不可信输入：属性值需同时转义引号与尖括号
    const attr = (value) => escapeAttr(escapeHtml(value));

    const head = columns
      .map((c) => `<th title="${attr(c)}">${escapeHtml(c)}</th>`)
      .join('');
    const body = rows.slice(0, shown).map((row) => {
      const tds = columns.map((c) => {
        const text = cell(row, c);
        return text === ''
          ? '<td class="sql-null">NULL</td>'
          : `<td title="${attr(text)}">${escapeHtml(text)}</td>`;
      }).join('');
      return `<tr>${tds}</tr>`;
    }).join('');

    sqlResult.innerHTML = '<div class="sql-table-wrap"><table class="sql-table">'
      + `<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  }

  // --- LDAP 人员查询 ---
  const ldapPanel = document.getElementById('ldapPanel');
  const ldapBack = document.getElementById('ldapBack');
  const ldapFilter = document.getElementById('ldapFilter');
  const ldapSearchBtn = document.getElementById('ldapSearchBtn');
  const ldapResults = document.getElementById('ldapResults');
  const ldapDetailPanel = document.getElementById('ldapDetailPanel');
  const ldapDetailBack = document.getElementById('ldapDetailBack');
  const ldapDetailLoading = document.getElementById('ldapDetailLoading');
  const ldapDetailContent = document.getElementById('ldapDetailContent');

  // 默认 filter
  const DEFAULT_FILTER = 'name=*NAME*';

  menuLdap.addEventListener('click', () => {
    if (!currentLdapId) {
      alert('请先在设置中为当前环境配置 LDAP ID');
      return;
    }
    mainPanel.style.display = 'none';
    ldapPanel.style.display = 'block';
    if (!ldapFilter.value) {
      ldapFilter.value = DEFAULT_FILTER;
    }
    ldapFilter.focus();
    ldapFilter.select();
  });

  ldapBack.addEventListener('click', () => {
    ldapPanel.style.display = 'none';
    mainPanel.style.display = 'block';
  });

  ldapSearchBtn.addEventListener('click', doLdapSearch);
  ldapFilter.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doLdapSearch();
  });

  async function doLdapSearch() {
    const filter = ldapFilter.value.trim();
    if (!filter) return;

    ldapSearchBtn.disabled = true;
    ldapResults.innerHTML = '<div class="lang-loading">查询中...</div>';

    try {
      const resp = await sendToContentScript({
        action: 'ldapSearch',
        ldapId: currentLdapId,
        filter
      });
      if (resp && resp.status && resp.data) {
        renderLdapResults(resp.data.data || []);
      } else {
        renderLdapError(`查询失败${getRequestError(resp)}`);
      }
    } catch (err) {
      renderLdapError(`查询失败${getRequestError(err)}`);
    }
    ldapSearchBtn.disabled = false;
  }

  function renderLdapResults(items) {
    if (items.length === 0) {
      ldapResults.innerHTML = '<div class="ldap-empty">未找到结果</div>';
      return;
    }
    ldapResults.innerHTML = items
      .map((item) => `<div class="ldap-result-item" data-rdn="${escapeAttr(item.rdn)}">${escapeHtml(item.rdn)}</div>`)
      .join('');

    ldapResults.querySelectorAll('.ldap-result-item').forEach((el) => {
      el.addEventListener('click', () => showLdapDetail(el.dataset.rdn));
    });
  }

  function renderLdapError(message) {
    const error = document.createElement('div');
    error.className = 'ldap-empty';
    error.textContent = message;
    ldapResults.replaceChildren(error);
  }

  async function showLdapDetail(rdn) {
    ldapPanel.style.display = 'none';
    ldapDetailPanel.style.display = 'block';
    ldapDetailLoading.style.display = 'block';
    ldapDetailContent.style.display = 'none';

    try {
      const resp = await sendToContentScript({
        action: 'ldapAttribute',
        ldapId: currentLdapId,
        rdn
      });
      if (resp && resp.status && resp.data) {
        renderLdapDetail(resp.data.data || []);
      } else {
        ldapDetailLoading.textContent = `获取失败${getRequestError(resp)}`;
      }
    } catch (err) {
      ldapDetailLoading.textContent = `获取失败${getRequestError(err)}`;
    }
  }

  function renderLdapDetail(attrs) {
    ldapDetailLoading.style.display = 'none';
    ldapDetailContent.style.display = 'block';
    ldapDetailContent.innerHTML = '<div class="ldap-detail">' +
      attrs.map((a) =>
        `<div class="ldap-attr"><span class="ldap-attr-name">${escapeHtml(a.name)}</span><span class="ldap-attr-value" title="${escapeAttr(a.value)}">${escapeHtml(a.value)}</span></div>`
      ).join('') + '</div>';
  }

  ldapDetailBack.addEventListener('click', () => {
    ldapDetailPanel.style.display = 'none';
    ldapPanel.style.display = 'block';
  });

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function escapeAttr(str) {
    return String(str == null ? '' : str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function getRequestError(result) {
    const message = result && (result.error || result.errmsg || result.message);
    return message ? `：${message}` : '';
  }
});
