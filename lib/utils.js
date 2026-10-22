/**
 * E10 Helper - 工具函数库
 */
const E10Utils = {
  /**
   * 判断当前页面是否为E10 OA系统（基于用户配置的URL）
   */
  async isE10Page() {
    return this.isConfiguredOaUrl(window.location.href);
  },

  /**
   * 向background发送消息
   */
  sendMessage(action, data = {}) {
    return chrome.runtime.sendMessage({ action, ...data });
  },

  /**
   * 存储数据
   */
  async saveData(key, value) {
    await chrome.storage.local.set({ [key]: value });
  },

  /**
   * 读取数据
   */
  async loadData(key) {
    const result = await chrome.storage.local.get(key);
    return result[key];
  },

  /**
   * 获取已配置的 OA Base URL 列表
   * 返回 [{ url: string, env: string }]
   */
  async getOaBaseUrls() {
    const result = await chrome.storage.local.get('oaBaseUrls');
    return result.oaBaseUrls || [];
  },

  /**
   * 获取指定环境的 OA Base URL
   */
  async getOaBaseUrl(env) {
    const urls = await this.getOaBaseUrls();
    const found = urls.find((u) => u.env === env);
    return found ? found.url : null;
  },

  /**
   * 判断 href 是否属于某个已配置的 OA 地址。
   * 按 origin + 路径边界匹配，避免 `https://oa.example.com` 误命中
   * `https://oa.example.com.evil.com`，也避免 `/oa` 误命中 `/oabc`。
   */
  matchesOaUrl(href, baseUrl) {
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
  },

  /**
   * 从已配置的 OA 地址中选出与 href 匹配且路径最长的一项。
   * 同一 host 下配置了多个子路径环境时，优先使用最精确的那一项。
   */
  findOaEntry(urls, href) {
    const matched = (urls || [])
      .filter((item) => item && item.url && this.matchesOaUrl(href, item.url))
      .sort((a, b) => b.url.length - a.url.length);
    return matched[0] || null;
  },

  /**
   * 判断给定URL是否匹配已配置的OA地址
   */
  async isConfiguredOaUrl(href) {
    const urls = await this.getOaBaseUrls();
    return !!this.findOaEntry(urls, href);
  },

  /**
   * 拼接 OA API URL
   */
  async buildOaUrl(path) {
    const urls = await this.getOaBaseUrls();
    if (urls.length === 0) return null;
    // 内容脚本运行在当前 OA 页面中，使用与该页面对应的环境地址。
    // 未匹配时不回退到其它环境，避免把请求（及凭证）发到错误的环境。
    const currentUrl = typeof window === 'undefined' ? '' : window.location.href;
    const matched = this.findOaEntry(urls, currentUrl);
    if (!matched) throw new Error('当前页面未匹配已配置的 OA 地址');
    const base = matched.url.replace(/\/+$/, '');
    const cleanPath = path.replace(/^\/+/, '');
    return `${base}/${cleanPath}`;
  },

  /**
   * 向 OA 系统发起 GET 请求（Content Script 环境，自动携带 Cookie）
   */
  async oaGet(path) {
    const url = await this.buildOaUrl(path);
    if (!url) throw new Error('未配置 OA 地址');
    const separator = url.includes('?') ? '&' : '?';
    const fullUrl = `${url}${separator}randomkey_${Date.now().toString(36)}=${Math.random().toString(36).slice(2, 8)}`;
    const resp = await fetch(fullUrl, { credentials: 'include' });
    if (!resp.ok) throw new Error(`请求失败（HTTP ${resp.status}）`);
    return resp.json();
  },

  /**
   * 向 OA 系统发起 POST 请求（Content Script 环境，自动携带 Cookie）
   */
  async oaPost(path, body) {
    const url = await this.buildOaUrl(path);
    if (!url) throw new Error('未配置 OA 地址');
    const resp = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!resp.ok) throw new Error(`请求失败（HTTP ${resp.status}）`);
    return resp.json();
  },

  /**
   * 日志输出（带前缀）
   */
  log(...args) {
    console.log('[E10 Helper]', ...args);
  }
};
