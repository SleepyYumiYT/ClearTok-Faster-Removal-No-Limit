/**
 * 工具函数和常量模块
 */

// 常量定义
const CONSTANTS = {
  SESSION_EXPIRY_TIME: 60 * 60 * 1000 * 24, // 24小时过期
  SESSION_STORAGE_KEY: 'clearTokSessionData',
  LOGIN_PORTAL_URL: 'https://tiktokrepostremover.com/login?source=extension',
  MAX_ACCOUNT_POLLING_ATTEMPTS: 24, // 2 minutes @ 5s interval
  MAX_LOG_ENTRIES: 150,
  TYPEWRITER_SPEED: 25, // 打字机速度
  NOTIFICATION_DURATION: 3000 // 通知显示时间
};

/**
 * ClearTokUtils - 工具函数类
 */
class ClearTokUtils {

  /**
   * 获取翻译文本并进行替换
   * @param {string} key - 翻译键
   * @param {Object} substitutions - 替换变量
   * @returns {string} 翻译后的文本
   */
  static getText(key, substitutions = {}) {
    if (window.i18n && window.i18n.getMessage) {
      return window.i18n.getMessage(key, substitutions);
    }
    if (chrome && chrome.i18n && chrome.i18n.getMessage) {
      let message = chrome.i18n.getMessage(key);
      if (message) {
        Object.keys(substitutions).forEach(placeholder => {
          message = message.replace(new RegExp(`{${placeholder}}`, 'g'), substitutions[placeholder]);
        });
        return message;
      }
    }
    return key;
  }

  /**
   * HTML转义
   * @param {string} text - 待转义文本
   * @returns {string} 转义后的文本
   */
  static escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * 睡眠函数
   * @param {number} ms - 毫秒数
   * @returns {Promise}
   */
  static sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 格式化时间戳
   * @returns {string} MM:SS 格式时间
   */
  static formatTimestamp() {
    const now = new Date();
    return `${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
  }

  /**
   * 获取日志图标
   * @param {string} type - 日志类型
   * @returns {string} 图标emoji
   */
  static getLogIcon(type) {
    switch (type) {
      case 'success': return '✅';
      case 'error': return '❌';
      case 'warning': return '⚠️';
      case 'waiting': return '🔄';
      default: return 'ℹ️';
    }
  }

  /**
   * 检测浏览器类型
   * @returns {string} 浏览器类型
   */
  static detectBrowser() {
    const userAgent = navigator.userAgent.toLowerCase();
    if (userAgent.includes('edg/') || userAgent.includes('edge/')) {
      return 'edge';
    } else if (userAgent.includes('chrome/') || userAgent.includes('chromium/')) {
      return 'chrome';
    }
    return 'chrome'; // 默认返回chrome
  }

  /**
   * 获取应用商店URL
   * @returns {string} 商店URL
   */
  static getStoreUrl() {
    const browser = this.detectBrowser();
    if (browser === 'edge') {
      return 'https://microsoftedge.microsoft.com/addons/login?ru=/addons/detail/cleartok-tiktok-repost-/bgbcmapbnbdmmjibajjagnlbbdhcenoc';
    } else {
      return 'https://chromewebstore.google.com/detail/cleartok-repost-remover/kmellgkfemijicfcpndnndiebmkdginb/reviews/my-review';
    }
  }

  /**
   * 显示通知
   * @param {string} message - 通知消息
   * @param {string} type - 通知类型
   */
  static showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = message;
    notification.style.cssText = `
      position: fixed; top: 20px; right: 20px;
      background: var(--color-surface);
      border: 1px solid ${type === 'error' ? 'var(--color-warning)' : type === 'success' ? 'var(--color-success)' : 'var(--color-accent-alt)'};
      border-radius: 8px; padding: 12px 16px; color: var(--color-text);
      z-index: 1000; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      max-width: 300px; animation: slideInRight 0.3s ease;
    `;
    document.body.appendChild(notification);
    setTimeout(() => {
      notification.style.animation = 'slideOutRight 0.3s ease';
      setTimeout(() => {
        if (notification.parentNode) notification.parentNode.removeChild(notification);
      }, 300);
    }, CONSTANTS.NOTIFICATION_DURATION);
  }

  /**
   * 复制文本到剪贴板
   * @param {string} text - 要复制的文本
   * @param {Function} onSuccess - 成功回调
   * @param {Function} onError - 失败回调
   */
  static copyToClipboard(text, onSuccess, onError) {
    navigator.clipboard.writeText(text).then(() => {
      if (onSuccess) onSuccess();
    }).catch(() => {
      // 回退方法
      const textArea = document.createElement('textarea');
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
        if (onSuccess) onSuccess();
      } catch (err) {
        if (onError) onError(err);
      }
      document.body.removeChild(textArea);
    });
  }

  /**
   * 生成CSV导出文件名
   * @param {string} prefix - 文件名前缀
   * @returns {string} 文件名
   */
  static generateExportFileName(prefix = 'cleartok') {
    const date = new Date();
    const ts = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}_${String(date.getHours()).padStart(2,'0')}${String(date.getMinutes()).padStart(2,'0')}`;
    return `${prefix}_${ts}.csv`;
  }

  /**
   * CSV字符串转义
   * @param {string} str - 待转义字符串
   * @returns {string} 转义后的字符串
   */
  static escapeCSV(str) {
    return String(str ?? '').replace(/"/g, '""');
  }

  /**
   * 创建并下载文件
   * @param {string} content - 文件内容
   * @param {string} filename - 文件名
   * @param {string} type - MIME类型
   */
  static downloadFile(content, filename, type = 'text/csv;charset=utf-8') {
    try {
      const bom = "\uFEFF"; // BOM for Excel UTF-8
      const blob = new Blob([bom + content], { type });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return true;
    } catch (error) {
      console.warn('Failed to download file:', error);
      return false;
    }
  }

  /**
   * 深拷贝对象
   * @param {Object} obj - 源对象
   * @returns {Object} 拷贝后的对象
   */
  static deepClone(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (obj instanceof Date) return new Date(obj);
    if (obj instanceof Array) return obj.map(item => this.deepClone(item));
    if (typeof obj === 'object') {
      const cloned = {};
      Object.keys(obj).forEach(key => {
        cloned[key] = this.deepClone(obj[key]);
      });
      return cloned;
    }
  }
}

// 导出常量和工具类
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CONSTANTS, ClearTokUtils };
} else {
  window.CONSTANTS = CONSTANTS;
  window.ClearTokUtils = ClearTokUtils;
}