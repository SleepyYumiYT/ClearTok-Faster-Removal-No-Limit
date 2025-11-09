// /modules/state-store.js

/**
 * Content Script 端状态管理器
 *
 * 架构说明：
 * - Background Script 的 StateManager 是唯一的状态真实来源（Single Source of Truth）
 * - 本类仅作为 Content Script 的状态访问代理
 * - 通过消息传递与 Background 同步状态
 * - 本地缓存仅用于减少消息传递延迟，不做持久化
 *
 * 数据流：
 * 1. 状态更新：Content Script → Background (UPDATE_STATE) → 广播到所有组件
 * 2. 状态读取：优先使用本地缓存，需要时从 Background 获取最新状态
 * 3. 状态同步：Background 通过 STATE_CHANGED 消息广播状态变化
 */
class StateStore {
  constructor() {
    // 默认状态结构
    this.defaultState = {
      process: {
        isRunning: false,
        isPaused: false,
        tabId: null,
        startTime: null
      },
      stats: {
        totalReposts: 0,
        processedVideos: 0,
        removedVideos: 0,
        skippedVideos: 0
      },
      currentVideo: {
        index: 0,
        title: '',
        author: '',
        url: ''
      },
      removedList: []
    };

    // 当前状态缓存
    this.state = { ...this.defaultState };

    // 设置监听器（同步）
    this.setupListeners();

    // 初始化（异步）
    this.init();
  }

  setupListeners() {
    // 监听状态变化消息（来自 background）- 同步设置
    chrome.runtime.onMessage.addListener((message, sender) => {
      if (sender.id !== chrome.runtime.id) return;

      if (message.type === 'STATE_CHANGED') {
        this.state = message.payload || this.state;
        console.log('[ClearTok StateStore] State updated from background');
      }
    });
  }

  async init() {
    // Content Script 启动时从 Background 获取初始状态
    // 不直接访问 storage，保证 Background 是唯一的数据源
    try {
      const response = await this.sendToBackground('GET_STATE');
      if (response) {
        this.state = response;
        console.log('[ClearTok StateStore] Initialized with state from background');
      } else {
        console.log('[ClearTok StateStore] Initialized with default state');
      }
    } catch (error) {
      console.log('[ClearTok StateStore] Failed to get initial state from background, using defaults');
    }
  }

  /**
   * 获取当前状态
   * 对于关键操作，可以传入 forceRefresh=true 强制从 Background 获取最新状态
   */
  async getState(forceRefresh = false) {
    // 如果强制刷新或者是关键时刻，从 Background 获取最新状态
    if (forceRefresh && this.isContentScript()) {
      try {
        const response = await this.sendToBackground('GET_STATE');
        if (response) {
          this.state = response;
        }
      } catch (error) {
        console.log('[ClearTok StateStore] Failed to refresh state, using cache');
      }
    }
    // 返回本地缓存的状态副本
    return { ...this.state };
  }

  /**
   * 获取状态的特定部分
   */
  async get(path) {
    const state = await this.getState();
    const keys = path.split('.');
    return keys.reduce((obj, key) => obj?.[key], state);
  }

  /**
   * 更新状态（发送到 background）
   */
  async update(updates) {
    // 合并本地状态
    this.state = this.deepMerge(this.state, updates);

    // 通知 background 更新状态
    await this.sendToBackground('UPDATE_STATE', updates);
  }

  /**
   * 更新特定路径的值
   */
  async set(path, value) {
    const keys = path.split('.');
    const lastKey = keys.pop();

    const updates = keys.reduceRight((acc, key) => {
      return { [key]: acc };
    }, { [lastKey]: value });

    await this.update(updates);
  }

  /**
   * 开始处理流程
   */
  async startProcess(tabId) {
    const updates = {
      process: {
        isRunning: true,
        isPaused: false,
        startTime: Date.now()
      },
      stats: {
        totalReposts: 0,
        processedVideos: 0,
        removedVideos: 0,
        skippedVideos: 0
      },
      removedList: []
    };

    // 只有在明确提供 tabId 时才更新它
    if (tabId !== undefined) {
      updates.process.tabId = tabId;
    }

    await this.update(updates);
  }

  /**
   * 停止处理流程
   */
  async stopProcess() {
    await this.update({
      process: {
        isRunning: false,
        isPaused: false,
        tabId: null,
        startTime: null
      }
    });
  }

  /**
   * 暂停/恢复处理
   */
  async setPaused(isPaused) {
    await this.set('process.isPaused', isPaused);
  }

  /**
   * 增加已删除计数
   */
  async incrementRemoved(videoInfo = null) {
    const state = await this.getState();
    const updates = {
      stats: {
        removedVideos: state.stats.removedVideos + 1
      }
    };

    if (videoInfo) {
      updates.removedList = [
        ...state.removedList,
        {
          ...videoInfo,
          removedAt: Date.now()
        }
      ];
    }

    await this.update(updates);
  }

  /**
   * 增加已处理计数
   */
  async incrementProcessed() {
    const state = await this.getState();
    await this.set('stats.processedVideos', state.stats.processedVideos + 1);
  }

  /**
   * 设置总数
   */
  async setTotal(count) {
    await this.set('stats.totalReposts', count);
  }

  /**
   * 设置当前视频信息
   */
  async setCurrentVideo(videoInfo) {
    await this.update({
      currentVideo: {
        index: videoInfo.index || 0,
        title: videoInfo.title || '',
        author: videoInfo.author || '',
        url: videoInfo.url || ''
      }
    });
  }

  /**
   * 重置状态
   */
  async reset() {
    this.state = { ...this.defaultState };
    await this.sendToBackground('RESET_STATE');
  }

  /**
   * 获取处理持续时间
   */
  async getDuration() {
    const state = await this.getState();
    if (!state.process.startTime) {
      return { total: 0, minutes: 0, seconds: 0 };
    }

    const totalDuration = Date.now() - state.process.startTime;
    const minutes = Math.floor(totalDuration / 60000);
    const seconds = Math.floor((totalDuration % 60000) / 1000);

    return { total: totalDuration, minutes, seconds };
  }

  /**
   * 检查是否正在处理
   */
  async isProcessing() {
    const state = await this.getState();
    return state.process.isRunning;
  }

  /**
   * 检查是否暂停
   */
  async isPaused() {
    const state = await this.getState();
    return state.process.isRunning && state.process.isPaused;
  }

  /**
   * 深度合并对象
   */
  deepMerge(target, source) {
    const result = { ...target };

    for (const key in source) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = this.deepMerge(result[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }

    return result;
  }

  /**
   * 发送消息到 background
   */
  async sendToBackground(type, payload = {}) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        {
          type,
          payload,
          timestamp: Date.now()
        },
        response => {
          if (chrome.runtime.lastError) {
            console.error('[ClearTok StateStore] Message failed:', chrome.runtime.lastError);
            resolve(null);
          } else {
            resolve(response?.result);
          }
        }
      );
    });
  }

  /**
   * 检查是否在 content script 环境
   */
  isContentScript() {
    return window.location.protocol !== 'chrome-extension:';
  }
}

// 导出单例实例
if (typeof window !== 'undefined') {
  if (!window.clearTokStateStore) {
    window.clearTokStateStore = new StateStore();
  }
}