/**
 * E10 Helper - MAIN World Inject Script
 * 运行在页面上下文中，可直接访问 weappUtils、React fiber 等页面内部对象
 */
(function () {
  'use strict';

  const MATRIX_PATH_RE = /\/info\/org\/(?:matrixSetting|conditionMatrix)(?:\/|$)/i;
  const BADGE_CLASS = 'e10-helper-matrix-id';
  const COPIED_CLASS = 'e10-helper-copied';
  const TITLE_BADGE_CLASS = 'e10-helper-matrix-id--title';
  const CELL_BADGE_CLASS = 'e10-helper-matrix-id--cell';
  const NUMERIC_ID_RE = /^\d{6,}$/;

  // 两类矩阵卡片的 DOM 结构不同，名称节点是插入 ID 标签的位置
  const MATRIX_CARD_SELECTORS = [
    {
      card: '.weapp-hrm-matrix-setting-content-list-item',
      name: '.weapp-hrm-matrix-setting-content-list-item-info-name'
    },
    {
      card: '.weapp-hrm-condition-matrix-content-matrix-list-item',
      name: '.weapp-hrm-condition-matrix-content-matrix-list-item-title-name'
    }
  ];

  // 详情页标题：取带 title 的最后一个节点，即当前矩阵名称
  const MATRIX_TITLE_SELECTORS = [
    '.weapp-hrm-matrix-setting-title',
    '.weapp-hrm-condition-matrix-custom-title'
  ];

  let matrixObserver = null;
  let matrixScanTimer = null;
  let warnedNoFiber = false;
  // 列表页扫描时缓存「矩阵名 → 矩阵 ID」，详情页与 SPA 切换后复用
  const matrixIdByName = new Map();

  // 监听来自 content.js 的消息
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data) return;

    if (data.type === 'E10_HELPER_INJECT') {
      if (data.action === 'unlockEsbLoggerCheckbox') {
        unlockEsbLoggerCheckbox();
      }
      if (data.action === 'showMatrixIds') {
        if (data.enabled) {
          startMatrixIdBadges();
        } else {
          stopMatrixIdBadges();
        }
      }
    }
  });

  // 内容脚本读取 storage 是异步的，可能晚于本脚本加载；主动握手请求一次授权。
  window.postMessage({ type: 'E10_HELPER_MATRIX_READY' }, '*');

  function unlockEsbLoggerCheckbox() {
    if (typeof weappUtils === 'undefined' || !weappUtils.regOvProps) {
      console.warn('[E10 Helper] weappUtils.regOvProps not available');
      return;
    }

    weappUtils.regOvProps('weappUi', 'Table', function (props) {
      if (props.className && props.className.includes('weapp-esb-setting-app-logger-table') && props.selection) {
        const sel = props.selection;
        const origGetSelectionProps = sel.getSelectionProps;
        sel.getSelectionProps = function (rowInfo) {
          const result = origGetSelectionProps.call(this, rowInfo);
          result.disabled = false;
          return result;
        };
      }
      return props;
    }, 0);

    console.log('[E10 Helper] ESB Logger checkbox unlock injected');
  }

  // --- 矩阵 ID 显示（自动生效，不依赖任何开关） ---

  function startMatrixIdBadges() {
    if (matrixObserver) return;

    matrixObserver = new MutationObserver(scheduleMatrixScan);
    matrixObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true
    });
    window.addEventListener('popstate', scheduleMatrixScan);

    scanMatrixIds();
    console.log('[E10 Helper] 矩阵 ID 显示已启用');
  }

  function stopMatrixIdBadges() {
    if (matrixObserver) {
      matrixObserver.disconnect();
      matrixObserver = null;
    }
    window.removeEventListener('popstate', scheduleMatrixScan);
    if (matrixScanTimer) {
      clearTimeout(matrixScanTimer);
      matrixScanTimer = null;
    }
    removeMatrixBadges();
  }

  function scheduleMatrixScan() {
    if (matrixScanTimer) return;
    matrixScanTimer = setTimeout(() => {
      matrixScanTimer = null;
      scanMatrixIds();
    }, 120);
  }

  function isMatrixPage() {
    return MATRIX_PATH_RE.test(window.location.pathname);
  }

  function scanMatrixIds() {
    if (!isMatrixPage()) {
      removeMatrixBadges();
      return;
    }

    scanMatrixCards();   // 列表：矩阵 ID
    scanMatrixTitle();   // 详情：顶部当前矩阵 ID
    scanMatrixTable();   // 详情数据表格：列 ID / 行 ID
    scanMatrixFields();  // 字段维护：字段 ID（等同于列 ID）
  }

  function scanMatrixCards() {
    for (const cfg of MATRIX_CARD_SELECTORS) {
      const cards = document.querySelectorAll(cfg.card);
      for (const card of cards) {
        const nameEl = card.querySelector(cfg.name);
        if (!nameEl) continue;

        const name = nameEl.getAttribute('title') || nameEl.textContent.trim();
        const badge = nameEl.querySelector(':scope > .' + BADGE_CLASS);
        if (badge && badge.dataset.matrixId) {
          // 卡片已打标时也要补缓存：SPA 切换后标题栏要靠它显示当前矩阵 ID
          if (name) matrixIdByName.set(name, badge.dataset.matrixId);
          continue;
        }

        const id = findMatrixId(card);
        if (!id) {
          if (!warnedNoFiber) {
            warnedNoFiber = true;
            console.warn('[E10 Helper] 未能读取矩阵 ID（页面结构可能已变化）');
          }
          continue;
        }
        if (name) matrixIdByName.set(name, id);
        renderIdBadge(nameEl, id, 'ID: ', '');
      }
    }
  }

  /** 详情页顶部：显示当前矩阵 ID */
  function scanMatrixTitle() {
    for (const selector of MATRIX_TITLE_SELECTORS) {
      const title = document.querySelector(selector);
      if (!title) continue;

      const named = [...title.querySelectorAll('span[title]')];
      const nameEl = named[named.length - 1];
      const name = nameEl && nameEl.getAttribute('title');
      const id = name && matrixIdByName.get(name);
      if (!id) continue;

      renderIdBadge(title, id, '矩阵 ID: ', TITLE_BADGE_CLASS);
    }
  }

  /**
   * 数据维护表格：
   * - 列 ID 在 <th data-index>，跳过 selection-column / table-index 等伪列
   * - 行 ID 在 <tr data-id>，标签放在该行最宽的数据单元格里
   */
  function scanMatrixTable() {
    for (const table of document.querySelectorAll('table.ui-table-grid-table')) {
      for (const th of table.querySelectorAll('th[data-index]')) {
        const id = th.getAttribute('data-index');
        if (id && NUMERIC_ID_RE.test(id)) {
          renderIdBadge(th, id, '列 ID: ', CELL_BADGE_CLASS);
        }
      }

      for (const tr of table.querySelectorAll('tr[data-id]')) {
        const id = tr.getAttribute('data-id');
        const cell = pickRowCell(tr);
        if (id && cell) {
          renderIdBadge(cell, id, '行 ID: ', CELL_BADGE_CLASS);
        }
      }
    }
  }

  function pickRowCell(tr) {
    const cells = [...tr.querySelectorAll(':scope > td')];
    return cells.find((td) =>
      !td.classList.contains('ui-table-grid-td-selection') &&
      td.getBoundingClientRect().width >= 150
    ) || cells[0];
  }

  /** 字段维护：人员矩阵字段行的 data-id；条件矩阵字段弹窗从 fiber 取字段 ID */
  function scanMatrixFields() {
    for (const item of document.querySelectorAll('.weapp-hrm-matrix-setting-content-data-maintain-data-field-item')) {
      const holder = item.closest('[data-id]');
      const id = holder && holder.getAttribute('data-id');
      if (id && NUMERIC_ID_RE.test(id)) {
        renderIdBadge(item, id, '字段 ID: ', CELL_BADGE_CLASS);
      }
    }

    for (const item of document.querySelectorAll('.weapp-hrm-condition-matrix-field-setting-content-list-item')) {
      const header = item.querySelector('.weapp-hrm-condition-matrix-field-setting-content-list-item-header');
      if (!header) continue;
      const id = findMatrixId(header);
      if (id) renderIdBadge(header, id, 'ID: ', CELL_BADGE_CLASS);
    }
  }

  /**
   * 从卡片 / 字段项 DOM 对应的 React fiber 往上找到列表项的 data.id。
   * 比按名称匹配接口数据可靠：矩阵重名、分页、筛选都不会串号。
   */
  function findMatrixId(el) {
    const fiberKey = Object.keys(el).find((k) =>
      k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')
    );
    if (!fiberKey) return null;

    let fiber = el[fiberKey];
    for (let i = 0; fiber && i < 15; i++, fiber = fiber.return) {
      const props = fiber.memoizedProps;
      const data = props && props.data;
      if (data && typeof data === 'object' && !Array.isArray(data) &&
          data.id != null && typeof data.name === 'string') {
        return String(data.id);
      }
    }
    return null;
  }

  /** 统一的 ID 标签：可点击复制，重复扫描不会重复写入 */
  function renderIdBadge(container, id, label, variant) {
    let badge = container.querySelector(':scope > .' + BADGE_CLASS);
    if (!badge) {
      badge = document.createElement('span');
      badge.className = BADGE_CLASS + (variant ? ' ' + variant : '');
      badge.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        copyMatrixId(badge, id);
      });
      container.appendChild(badge);
    }

    if (badge.dataset.matrixId === id) return;
    badge.dataset.matrixId = id;
    badge.textContent = label + id;
    badge.title = '点击复制：' + id;
    container.setAttribute('data-e10-matrix-id', id);

    // 表格 / 字段项里的标签用绝对定位，不参与文档流，不改表格行高
    if (variant === CELL_BADGE_CLASS && getComputedStyle(container).position === 'static') {
      container.style.position = 'relative';
    }
  }

  function copyMatrixId(badge, id) {
    const done = () => {
      badge.classList.add(COPIED_CLASS);
      clearTimeout(badge._e10CopiedTimer);
      badge._e10CopiedTimer = setTimeout(() => badge.classList.remove(COPIED_CLASS), 1200);
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(id).then(done).catch(() => {
        fallbackCopy(id);
        done();
      });
    } else {
      fallbackCopy(id);
      done();
    }
  }

  function fallbackCopy(text) {
    const input = document.createElement('textarea');
    input.value = text;
    input.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
    document.body.appendChild(input);
    input.select();
    try {
      document.execCommand('copy');
    } catch (err) {
      // 忽略：用户仍可手动选中 ID 文本
    }
    input.remove();
  }

  function removeMatrixBadges() {
    document.querySelectorAll('.' + BADGE_CLASS).forEach((el) => el.remove());
    document.querySelectorAll('[data-e10-matrix-id]').forEach((el) => {
      el.removeAttribute('data-e10-matrix-id');
    });
  }
})();
