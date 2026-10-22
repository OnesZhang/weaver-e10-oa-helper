/**
 * E10 Helper - Options 逻辑
 * 管理多个 OA Base URL（每个环境可单独配置 LDAP ID）
 */
const STORAGE_KEY = 'oaBaseUrls';

const ENV_LABELS = {
  dev: '开发',
  test: '测试',
  staging: '预发布',
  prod: '生产'
};

const urlInput = document.getElementById('urlInput');
const envSelect = document.getElementById('envSelect');
const btnAdd = document.getElementById('btnAdd');
const urlList = document.getElementById('urlList');
const addError = document.getElementById('addError');
const toast = document.getElementById('toast');

let urls = [];

// --- 初始化 ---
loadUrls();

btnAdd.addEventListener('click', addUrl);
urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addUrl();
});

// --- 核心逻辑 ---
async function loadUrls() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  urls = result[STORAGE_KEY] || [];
  render();
}

async function saveUrls() {
  await chrome.storage.local.set({ [STORAGE_KEY]: urls });
}

function addUrl() {
  clearError();
  let value = urlInput.value.trim();

  if (!value) {
    showError('请输入URL地址');
    return;
  }

  if (!/^https?:\/\//i.test(value)) {
    value = 'http://' + value;
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    showError('URL格式不正确');
    return;
  }

  if (parsed.username || parsed.password) {
    showError('URL 不能包含用户名或密码');
    return;
  }

  // 规范化为标准 URL 后保存：统一主机大小写、去掉末尾斜杠，避免重复配置或匹配失败
  value = parsed.href.replace(/\/+$/, '');

  if (urls.some((u) => u.url === value)) {
    showError('该地址已存在');
    return;
  }

  const env = envSelect.value;
  urls.push({ url: value, env, ldapId: '', appKey: '', appSecurity: '' });
  saveUrls();
  render();

  urlInput.value = '';
  showToast('已添加');
}

function removeUrl(index) {
  urls.splice(index, 1);
  saveUrls();
  render();
  showToast('已删除');
}

function updateLdapId(index, ldapId) {
  urls[index].ldapId = ldapId;
  saveUrls();
}

function updateField(index, field, value) {
  urls[index][field] = value;
  saveUrls();
}

// --- 渲染 ---
function render() {
  if (urls.length === 0) {
    urlList.innerHTML = '<div class="url-empty">暂无配置，请添加OA系统地址</div>';
    return;
  }

  urlList.innerHTML = urls
    .map(
      (item, i) => `
      <div class="url-item">
        <div class="url-row">
          <span class="url-env ${escapeAttr(item.env)}">${ENV_LABELS[item.env] || item.env}</span>
          <span class="url-text" title="${escapeAttr(item.url)}">${escapeHtml(item.url)}</span>
          <button class="btn-delete" data-index="${i}" title="删除">&times;</button>
        </div>
        <div class="url-extra-row">
          <span class="url-extra-label">LDAP ID</span>
          <input type="text" class="url-extra-input" data-index="${i}" data-field="ldapId" value="${escapeAttr(item.ldapId || '')}" placeholder="未配置" />
        </div>
        <div class="url-extra-row">
          <span class="url-extra-label">app_key</span>
          <input type="text" class="url-extra-input" data-index="${i}" data-field="appKey" value="${escapeAttr(item.appKey || '')}" placeholder="未配置" />
        </div>
        <div class="url-extra-row">
          <span class="url-extra-label">app_security</span>
          <input type="text" class="url-extra-input" data-index="${i}" data-field="appSecurity" value="${escapeAttr(item.appSecurity || '')}" placeholder="未配置" />
        </div>
      </div>`
    )
    .join('');

  urlList.querySelectorAll('.btn-delete').forEach((btn) => {
    btn.addEventListener('click', () => removeUrl(Number(btn.dataset.index)));
  });

  urlList.querySelectorAll('.url-extra-input').forEach((input) => {
    input.addEventListener('change', () => {
      updateField(Number(input.dataset.index), input.dataset.field, input.value.trim());
      showToast('已保存');
    });
  });
}

// --- 辅助 ---
function showError(msg) {
  addError.textContent = msg;
}

function clearError() {
  addError.textContent = '';
}

function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 1500);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return String(str == null ? '' : str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
