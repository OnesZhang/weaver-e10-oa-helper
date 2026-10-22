/**
 * E10 Helper - Background Service Worker
 */

// 安装/更新时初始化
chrome.runtime.onInstalled.addListener(() => {
  refreshAllTabs();
});

// 浏览器启动时刷新
chrome.runtime.onStartup.addListener(() => {
  refreshAllTabs();
});

// 监听标签页 URL 变化，自动更新角标
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // SPA 路由变化（pushState/replaceState）只触发 url 变化，不一定有 status = complete
  if ((changeInfo.status === 'complete' || changeInfo.url) && tab.url) {
    updateBadge(tabId, tab.url);
  }
});

// 配置变化后刷新所有标签页角标
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.oaBaseUrls) {
    refreshAllTabs();
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.action.setBadgeText({ text: '', tabId });
});

// 按 origin + 路径边界匹配 OA 地址（与 lib/utils.js 保持一致），
// 避免 https://oa.example.com 误命中 https://oa.example.com.evil.com
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

// 检查所有现有标签页
async function refreshAllTabs() {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.url) {
      updateBadge(tab.id, tab.url);
    }
  }
}

// 根据 URL 是否匹配已配置的 OA 地址来设置图标绿点
async function updateBadge(tabId, url) {
  const result = await chrome.storage.local.get('oaBaseUrls');
  const oaUrls = result.oaBaseUrls || [];
  const matched = oaUrls.some((u) => u && u.url && matchesOaUrl(url, u.url));

  if (matched) {
    const icon = await generateDotIcon();
    chrome.action.setIcon({ imageData: icon, tabId });
  } else {
    chrome.action.setIcon({ path: 'icons/icon32.png', tabId });
  }
}

// 生成带绿色小圆点的图标
async function generateDotIcon() {
  const size = 32;
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // 绘制原始图标
  const resp = await fetch(chrome.runtime.getURL('icons/icon32.png'));
  const blob = await resp.blob();
  const bmp = await createImageBitmap(blob);
  ctx.drawImage(bmp, 0, 0, size, size);

  // 右下角绿色小圆点
  const dotR = size * 0.18;
  const cx = size - dotR - 1;
  const cy = size - dotR - 1;
  ctx.beginPath();
  ctx.arc(cx, cy, dotR, 0, Math.PI * 2);
  ctx.fillStyle = '#4caf50';
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#fff';
  ctx.stroke();

  return { 32: ctx.getImageData(0, 0, size, size) };
}
