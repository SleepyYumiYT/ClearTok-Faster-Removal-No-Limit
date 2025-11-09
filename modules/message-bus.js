// /modules/message-bus.js

/**
 * 消息通信管理器
 */
class MessageBus {
  constructor(workflow, stateStore) {
    this.workflow = workflow;
    this.stateStore = stateStore || window.clearTokStateStore;
    this.messageHandlers = new Map();

    // 组件标识
    this.componentId = this.generateComponentId();
    this.componentType = this.getComponentType();

    // 初始化
    this.init();
  }

  init() {
    // 设置消息监听器
    this.setupMessageListener();
  }

  /**
   * 设置消息监听器
   */
  setupMessageListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      // 过滤非本扩展消息
      if (sender.id !== chrome.runtime.id) return;

      // 只处理新格式消息
      if (!message.type) return;

      // 处理消息
      this.handleMessage(message, sender, sendResponse);
      return true; // 保持通道开放用于异步响应
    });
  }

  /**
   * 处理接收到的消息
   */
  async handleMessage(message, sender, sendResponse) {
    // 查找并执行处理器
    const handler = this.messageHandlers.get(message.type) || this.getDefaultHandler(message.type);

    if (handler) {
      try {
        const result = await handler(message.payload || {}, sender);
        sendResponse({ success: true, result });
      } catch (error) {
        console.error(`[ClearTok MessageBus] Handler error:`, error);
        sendResponse({ success: false, error: error.message });
      }
    } else {
      sendResponse({ success: false, error: `Unknown message type: ${message.type}` });
    }
  }

  /**
   * 发送消息
   */
  async send(targetId, type, payload = {}) {
    const message = {
      id: this.generateMessageId(),
      type: type.toUpperCase().replace(/-/g, '_'),
      payload,
      timestamp: Date.now(),
      sender: this.componentId,
      componentType: this.componentType
    };

    return new Promise((resolve, reject) => {
      const sendMessage = (target, msg) => {
        if (target === 'popup' || target === 'background') {
          // 发送到 extension runtime
          chrome.runtime.sendMessage(msg, response => {
            if (chrome.runtime.lastError) {
              reject(chrome.runtime.lastError);
            } else if (response?.success === false) {
              reject(new Error(response.error || 'Message failed'));
            } else {
              resolve(response?.result);
            }
          });
        } else if (typeof target === 'number') {
          // 发送到特定标签页
          chrome.tabs.sendMessage(target, msg, response => {
            if (chrome.runtime.lastError) {
              reject(chrome.runtime.lastError);
            } else if (response?.success === false) {
              reject(new Error(response.error || 'Message failed'));
            } else {
              resolve(response?.result);
            }
          });
        } else {
          reject(new Error('Invalid target'));
        }
      };

      try {
        sendMessage(targetId, message);
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * 广播消息到所有组件
   */
  async broadcast(type, payload = {}) {
    const message = {
      id: this.generateMessageId(),
      type: type.toUpperCase().replace(/-/g, '_'),
      payload,
      timestamp: Date.now(),
      sender: this.componentId,
      componentType: this.componentType
    };

    // 发送到 runtime（popup 和 background）
    chrome.runtime.sendMessage(message).catch(() => {});

    // 如果在 background，发送到所有 TikTok 标签页
    if (this.componentType === 'background') {
      try {
        const tabs = await chrome.tabs.query({ url: '*://*.tiktok.com/*' });
        tabs.forEach(tab => {
          chrome.tabs.sendMessage(tab.id, message).catch(() => {});
        });
      } catch (error) {
        console.error('[ClearTok MessageBus] Failed to broadcast to tabs:', error);
      }
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

  /**
   * 获取默认消息处理器
   */
  getDefaultHandler(type) {
    // 状态更新相关消息的默认处理
    const stateHandlers = {
      'UPDATE_PROGRESS': async (payload) => {
        if (this.stateStore) {
          await this.stateStore.update({
            stats: {
              processedVideos: payload.current,
              totalReposts: payload.total
            }
          });
        }
      },

      'VIDEO_REMOVED': async (payload) => {
        if (this.stateStore) {
          await this.stateStore.incrementRemoved(payload);
        }
      },

      'STATUS_UPDATE': async (payload) => {
        console.log('[ClearTok] Status:', payload.status);
      },

      'ERROR': async (payload) => {
        if (this.stateStore) {
          await this.stateStore.update({
            lastError: payload.error
          });
        }
      },

      'PING': () => {
        return 'PONG';
      },

      'RESTORE_STATE': async (payload) => {
        // 恢复状态（当标签页刷新后）
        if (this.stateStore) {
          this.stateStore.state = payload;
          console.log('[ClearTok] State restored after page reload');
        }
      }
    };

    return stateHandlers[type];
  }

  /**
   * 生成组件ID
   */
  generateComponentId() {
    return `${this.getComponentType()}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 获取组件类型
   */
  getComponentType() {
    // 检测运行环境
    if (typeof chrome.runtime.getBackgroundPage !== 'undefined') {
      try {
        // 尝试获取 background page，如果成功则是 background
        const bg = chrome.runtime.getBackgroundPage();
        if (bg === window) return 'background';
      } catch (e) {
        // 不是 background
      }
    }

    // 检查是否是 popup
    if (window.location.protocol === 'chrome-extension:' &&
        window.location.pathname.includes('popup')) {
      return 'popup';
    }

    // 默认是 content script
    return 'content';
  }

  /**
   * 生成消息ID
   */
  generateMessageId() {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

// 导出
if (typeof window !== 'undefined') {
  window.MessageBus = MessageBus;
}