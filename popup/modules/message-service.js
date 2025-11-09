/**
 * 简化的 Popup 端消息服务
 * 直接与 background 和 content script 通信
 */

class MessageService {
  constructor() {
    this.messageHandlers = new Map();
    this.setupListener();
  }

  /**
   * 设置消息监听器
   */
  setupListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      // 只处理新格式的消息
      if (!message.type) return;

      console.log('[ClearTok Popup] Received:', message.type);

      // 查找处理器
      const handler = this.messageHandlers.get(message.type);
      if (handler) {
        try {
          const result = handler(message.payload || {}, sender);
          if (result instanceof Promise) {
            result
              .then(res => sendResponse({ success: true, result: res }))
              .catch(err => sendResponse({ success: false, error: err.message }));
            return true; // 保持通道开放
          } else {
            sendResponse({ success: true, result });
          }
        } catch (error) {
          sendResponse({ success: false, error: error.message });
        }
      }
    });
  }

  /**
   * 发送消息到 background
   */
  async sendToBackground(type, payload = {}) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          type: type.toUpperCase().replace(/-/g, '_'),
          payload,
          timestamp: Date.now()
        },
        response => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else if (response?.success === false) {
            reject(new Error(response.error || 'Message failed'));
          } else {
            resolve(response?.result);
          }
        }
      );
    });
  }

  /**
   * 发送消息到活动的 TikTok 标签页
   */
  async sendToTikTokTab(type, payload = {}) {
    try {
      // 从 background 获取当前处理的 tabId
      const state = await this.sendToBackground('GET_STATE');
      if (!state?.process?.tabId) {
        throw new Error('No active processing tab');
      }

      const tabId = state.process.tabId;

      return new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(
          tabId,
          {
            type: type.toUpperCase().replace(/-/g, '_'),
            payload,
            timestamp: Date.now()
          },
          response => {
            if (chrome.runtime.lastError) {
              reject(chrome.runtime.lastError);
            } else if (response?.success === false) {
              reject(new Error(response.error || 'Message failed'));
            } else {
              resolve(response?.result);
            }
          }
        );
      });
    } catch (error) {
      console.error('[ClearTok Popup] Failed to send to tab:', error);
      throw error;
    }
  }

  /**
   * 检查与 TikTok 标签页的连接
   */
  async checkConnection() {
    try {
      // 从 background 获取当前处理的 tabId
      const state = await this.sendToBackground('GET_STATE');
      if (!state?.process?.tabId) return false;

      return new Promise(resolve => {
        chrome.tabs.sendMessage(
          state.process.tabId,
          { type: 'PING', timestamp: Date.now() },
          response => {
            // MessageBus 返回 { success: true, result: 'PONG' }
            resolve(response?.success === true && response?.result === 'PONG');
          }
        );
      });
    } catch {
      return false;
    }
  }

  /**
   * 注册消息处理器
   */
  on(type, handler) {
    this.messageHandlers.set(type.toUpperCase().replace(/-/g, '_'), handler);
  }

  /**
   * 移除消息处理器
   */
  off(type) {
    this.messageHandlers.delete(type.toUpperCase().replace(/-/g, '_'));
  }

  // === 便捷方法 ===

  async startRemoval() {
    return this.sendToBackground('REMOVE_REPOSTS');
  }

  async pauseRemoval() {
    return this.sendToBackground('PAUSE_REMOVAL');
  }

  async resumeRemoval() {
    return this.sendToBackground('RESUME_REMOVAL');
  }

  async checkLoginStatus() {
    return this.sendToBackground('CHECK_LOGIN_STATUS');
  }

  async navigateToReposts() {
    return this.sendToBackground('NAVIGATE_TO_REPOSTS');
  }

  async getState() {
    return this.sendToBackground('GET_STATE');
  }
}

// 创建全局实例
if (!window.messageService) {
  window.messageService = new MessageService();
}