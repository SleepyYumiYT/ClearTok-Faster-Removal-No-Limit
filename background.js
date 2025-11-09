/* ========== Background Script - 简化架构 ========== */

const META_URL = 'https://api.tiktokrepostremover.com/cdn/selectors';
const CONTENT_SCRIPTS = [
  "modules/config.js",
  "modules/state-store.js",
  "modules/message-bus.js",
  "modules/ui.js",
  "modules/workflow.js",
  "main.js"
];

/**
 * 中央状态管理 - Background 作为单一数据源
 */
class StateManager {
  constructor() {
    // 内存中的主状态（实时）
    this.state = {
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

    // 启动时从 storage 恢复
    this.loadFromStorage();

    // 定期持久化到 storage（每 30 秒）
    setInterval(() => this.saveToStorage(), 30000);
  }

  async loadFromStorage() {
    try {
      const result = await chrome.storage.local.get('cleartokState');
      if (result.cleartokState) {
        // 合并存储的状态，但不覆盖运行时状态
        Object.assign(this.state, result.cleartokState);
        // 重置运行时标志
        this.state.process.isRunning = false;
        this.state.process.isPaused = false;
        this.state.process.tabId = null;
      }
    } catch (error) {
      console.error('[ YukiRem BG] Failed to load state:', error);
    }
  }

  async saveToStorage() {
    try {
      // 只持久化统计数据，不保存运行时状态
      await chrome.storage.local.set({
        cleartokState: {
          stats: this.state.stats,
          removedList: this.state.removedList
        }
      });
    } catch (error) {
      console.error('[ YukiRem BG] Failed to save state:', error);
    }
  }

  updateState(updates) {
    this.state = this.deepMerge(this.state, updates);
    this.broadcastState();
  }

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

  broadcastState() {
    const message = {
      type: 'STATE_CHANGED',
      payload: this.state,
      timestamp: Date.now()
    };

    // 广播到 popup
    chrome.runtime.sendMessage(message).catch(() => {});

    // 广播到活动的 content script
    if (this.state.process.tabId) {
      chrome.tabs.sendMessage(this.state.process.tabId, message).catch(() => {});
    }
  }

  resetProcess(keepTabId = false) {
    const updates = {
      process: {
        isRunning: false,
        isPaused: false,
        startTime: null
      },
      currentVideo: {
        index: 0,
        title: '',
        author: '',
        url: ''
      }
    };

    // 只有在明确要求时才清除 tabId
    if (!keepTabId) {
      updates.process.tabId = null;
    }

    this.updateState(updates);
  }

  // 新方法：仅重置运行状态，保留统计数据（用于标签页关闭场景）
  resetProcessKeepStats() {
    const updates = {
      process: {
        isRunning: false,
        isPaused: false,
        tabId: null,
        startTime: this.state.process.startTime // 保留开始时间以计算总耗时
      },
      currentVideo: {
        index: 0,
        title: '',
        author: '',
        url: ''
      }
      // 注意：不重置 stats 和 removedList，让用户可以继续查看和导出
    };

    this.updateState(updates);

    // 立即保存统计数据到 storage
    this.saveToStorage();
  }
}

// 创建状态管理器实例
const stateManager = new StateManager();

/* ========== 辅助函数 ========== */

async function waitForTabComplete(tabId, timeoutMs = 10000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab?.status === 'complete') return true;
    } catch (_) {
      // tab 可能不存在
    }
    await new Promise(r => setTimeout(r, 200));
  }
  return false;
}

async function ensureScriptsInjected(tabId) {
  try {
    // 尝试 Ping
    const response = await chrome.tabs.sendMessage(tabId, {
      type: 'PING',
      timestamp: Date.now()
    });
    // MessageBus 返回 { success: true, result: 'PONG' }
    if (response?.success === true && response?.result === 'PONG') {
      console.log(`[ YukiRem BG] Scripts already exist in tab ${tabId}`);
      return true;
    }
  } catch (e) {
    // Ping 失败，注入脚本
    console.log(`[ YukiRem BG] Injecting scripts into tab ${tabId}`);
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: CONTENT_SCRIPTS,
      });
      await new Promise(r => setTimeout(r, 500));
      console.log(`[ YukiRem BG] Scripts injected successfully`);
      return true;
    } catch (error) {
      console.error(`[ YukiRem BG] Failed to inject scripts:`, error);
      return false;
    }
  }
  return false;
}

async function checkMetaAndUpdate(force = false) {
  const { selectorsMeta } = await chrome.storage.local.get('selectorsMeta');

  if (!force && selectorsMeta && Date.now() - selectorsMeta.fetchedAt < 60_000) {
    return;
  }

  try {
    const res = await fetch(META_URL, { cache: 'no-cache' });
    if (!res.ok) return;
    const meta = await res.json();

    if (!meta?.version || !meta?.selectors) {
      console.warn('[ YukiRem BG] Invalid meta file');
      return;
    }

    if (selectorsMeta?.version === meta.version) {
      console.log('[ YukiRem BG] Selectors up-to-date');
      return;
    }

    await chrome.storage.local.set({
      selectors: meta.selectors,
      selectorsMeta: { version: meta.version, fetchedAt: Date.now() }
    });

    console.log('[ YukiRem BG] Selectors updated to version:', meta.version);

    // 只通知正在处理的标签页（如果有）
    if (stateManager.state.process.tabId) {
      chrome.tabs.sendMessage(stateManager.state.process.tabId, {
        type: 'SELECTORS_UPDATED',
        timestamp: Date.now()
      }).catch(() => {});
    }
  } catch (e) {
    console.warn('[ YukiRem BG] Failed to fetch selectors:', e);
  }
}

/* ========== 生命周期事件 ========== */

chrome.runtime.onStartup?.addListener(() => checkMetaAndUpdate(true));

chrome.runtime.onInstalled.addListener(() => {
  console.log("[ YukiRem BG] Extension installed");
  checkMetaAndUpdate(true);
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

// 监听标签页事件
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // 如果是正在处理的标签页且页面刷新了或导航了
  if (tabId === stateManager.state.process.tabId) {
    if (changeInfo.status === 'complete') {
      console.log(`[YukiRem BG] Processing tab ${tabId} reloaded/navigated`);

      // 检查是否还在 TikTok 域名
      if (tab.url && tab.url.includes('tiktok.com')) {
        // 重新注入脚本
        ensureScriptsInjected(tabId).then(success => {
          if (success && stateManager.state.process.isRunning) {
            // 如果正在处理中，通知脚本恢复状态
            chrome.tabs.sendMessage(tabId, {
              type: 'RESTORE_STATE',
              payload: stateManager.state,
              timestamp: Date.now()
            }).catch(() => {});
          }
        });
      } else {
        // 离开了 TikTok，完全重置处理状态
        console.log(`[ YukiRem BG] Tab ${tabId} left TikTok`);
        stateManager.resetProcess(false); // 清除 tabId
      }
    }
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === stateManager.state.process.tabId) {
    console.log(`[ YukiRem BG] Processing tab ${tabId} was closed`);

    // 使用新方法：保留统计数据，只重置运行状态
    stateManager.resetProcessKeepStats();

    // 通知 popup，包含当前统计信息
    chrome.runtime.sendMessage({
      type: 'TAB_CLOSED',
      payload: {
        tabId,
        stats: stateManager.state.stats,
        hasRemovedVideos: stateManager.state.stats.removedVideos > 0
      },
      timestamp: Date.now()
    }).catch(() => {});
  }
});

/* ========== 消息处理 ========== */

// 定义需要异步处理的消息类型
const asyncMessages = ['ENSURE_SELECTORS', 'REMOVE_REPOSTS', 'CHECK_LOGIN_TAB'];

// 定义需要转发到 content script 的消息类型
const forwardMessages = ['PAUSE_REMOVAL', 'RESUME_REMOVAL', 'NAVIGATE_TO_REPOSTS'];

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 只处理新格式消息
  if (!message.type) return;

  // 简单直接的消息处理 - 暂停/恢复直接转发到 content script
  if (message.type === 'PAUSE_REMOVAL' || message.type === 'RESUME_REMOVAL') {
    if (stateManager.state.process.tabId) {
      // 有活动标签页，转发消息
      chrome.tabs.sendMessage(stateManager.state.process.tabId, message, (response) => {
        if (chrome.runtime.lastError) {
          // 转发失败，但至少尝试了
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
        } else {
          // 转发成功
          sendResponse(response || { success: true });
        }
      });
    } else {
      // 没有活动标签页，返回错误但不阻止其他操作
      sendResponse({ success: false, error: 'No active tab' });
    }
    return true; // 保持通道开放
  }

  // NAVIGATE_TO_REPOSTS 也是转发消息
  if (message.type === 'NAVIGATE_TO_REPOSTS') {
    if (stateManager.state.process.tabId) {
      chrome.tabs.sendMessage(stateManager.state.process.tabId, message, sendResponse);
    } else {
      sendResponse({ success: false, error: 'No active tab' });
    }
    return true;
  }

  // 处理同步消息
  switch (message.type) {
    case 'PING':
      sendResponse('PONG');
      break;

    case 'GET_STATE':
      sendResponse({ success: true, result: stateManager.state });
      break;

    case 'UPDATE_STATE':
      stateManager.updateState(message.payload);
      sendResponse({ success: true });
      break;

    case 'RESET_STATE':
      stateManager.resetProcess(false); // 显式重置，清除所有状态
      sendResponse({ success: true });
      break;

    // 来自 content script 的状态更新
    case 'UPDATE_PROGRESS':
    case 'VIDEO_REMOVED':
    case 'VIDEO_SKIPPED':
    case 'STATUS_UPDATE':
    case 'ERROR':
    case 'COMPLETE':
    case 'NO_REPOSTS_FOUND':
      // 只从 content script 接收时才处理（避免重复）
      if (sender.tab) {
        // 更新内部状态
        handleContentMessage(message.type, message.payload);
      }
      sendResponse({ success: true });
      break;

    default:
      // 其他未处理的消息类型
      break;
  }

  // 异步处理
  if (asyncMessages.includes(message.type)) {
    (async () => {
      try {
        switch (message.type) {
        case 'ENSURE_SELECTORS':
          await checkMetaAndUpdate();
          sendResponse({ success: true });
          break;

        case 'REMOVE_REPOSTS':
          const removeResult = await handleRemoveReposts();
          sendResponse({ success: true, result: removeResult });
          break;

        case 'CHECK_LOGIN_TAB':
          const checkResult = await handleCheckLoginTab(message.payload);
          sendResponse({ success: true, result: checkResult });
          break;

        default:
          sendResponse({ success: false, error: `Unknown async message type: ${message.type}` });
          break;
        }
      } catch (error) {
        console.error('[YukiRem BG] Error handling message:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true; // 保持通道开放
  }
});

/* ========== 业务逻辑处理 ========== */

async function handleRemoveReposts() {
  console.log('[YukiRem BG] Starting repost removal');

  try {
    // 如果已有活动处理标签页，复用它
    let tab;
    if (stateManager.state.process.tabId) {
      try {
        tab = await chrome.tabs.get(stateManager.state.process.tabId);
        await chrome.tabs.update(tab.id, { active: true });
        console.log(`[YukiRem BG] Reusing active tab: ${tab.id}`);
      } catch (e) {
        // 标签页已关闭，需要创建新的
        stateManager.resetProcess(false); // 标签页不存在，清除 tabId
      }
    }

    // 如果没有活动标签页，查找或创建
    if (!tab) {
      const tabs = await chrome.tabs.query({ url: '*://*.tiktok.com/*' });
      if (tabs.length === 0) {
        tab = await chrome.tabs.create({ url: 'https://www.tiktok.com/', active: true });
        console.log(`[YukiRem BG] Created new tab: ${tab.id}`);
      } else {
        // 使用最后一个找到的 TikTok 标签页（通常是最近活动的）
        // 注意：一旦选定并保存到 state.process.tabId，
        // 后续所有操作（暂停、恢复、ping等）都会使用这个保存的 tabId
        tab = tabs[tabs.length - 1];
        await chrome.tabs.update(tab.id, { active: true });
        console.log(`[YukiRem BG] Using existing tab: ${tab.id}`);
      }
    }

    // 更新状态 - 只设置 tabId，不设置 isRunning
    // isRunning 应该由 content script 在真正开始时设置
    stateManager.updateState({
      process: {
        isRunning: false, // 让 content script 自己设置
        isPaused: false,
        tabId: tab.id,
        startTime: Date.now()
      },
      stats: {
        totalReposts: 0,
        processedVideos: 0,
        removedVideos: 0,
        skippedVideos: 0
      },
      removedList: []
    });

    // 等待页面加载
    await waitForTabComplete(tab.id, 15000);

    // 注入脚本
    const isReady = await ensureScriptsInjected(tab.id);
    if (!isReady) {
      throw new Error('Failed to inject scripts');
    }

    await new Promise(r => setTimeout(r, 500));

    // 发送开始命令（使用 catch 处理可能的错误）
    await chrome.tabs.sendMessage(tab.id, {
      type: 'START_REMOVAL',
      timestamp: Date.now()
    }).catch(error => {
      // 如果标签页已关闭或无响应，记录错误但不抛出
      console.warn('[YukiRem BG] Failed to send START_REMOVAL:', error);
    });

    return { tabId: tab.id, status: 'started' };

  } catch (error) {
    console.error('[YukiRem BG] Failed to start removal:', error);

    // 判断是否是标签页关闭导致的错误
    if (error.message?.includes('message channel closed')) {
      // 标签页关闭，保留统计数据
      stateManager.resetProcessKeepStats();
    } else {
      // 其他错误，完全重置
      stateManager.resetProcess(false);
    }

    throw error;
  }
}

async function handleCheckLoginTab(payload) {
  const { tabId } = payload;
  const isReady = await ensureScriptsInjected(tabId);

  if (isReady) {
    await chrome.tabs.sendMessage(tabId, {
      type: 'CHECK_LOGIN_STATUS',
      timestamp: Date.now()
    });
    return { status: 'checked' };
  }

  return { status: 'failed' };
}

function handleContentMessage(type, payload) {
  switch (type) {
    case 'UPDATE_PROGRESS':
      stateManager.updateState({
        stats: {
          processedVideos: payload.current,
          totalReposts: payload.total
        }
      });
      break;

    case 'VIDEO_REMOVED':
      const currentStats = stateManager.state.stats;
      stateManager.updateState({
        stats: {
          removedVideos: currentStats.removedVideos + 1
        },
        removedList: [
          ...stateManager.state.removedList,
          {
            ...payload,
            removedAt: Date.now()
          }
        ]
      });
      break;

    case 'COMPLETE':
    case 'ERROR':
    case 'NO_REPOSTS_FOUND':
      // 处理完成，重置运行状态
      stateManager.updateState({
        process: {
          isRunning: false,
          isPaused: false
        }
      });
      // 保存最终状态
      stateManager.saveToStorage();
      break;
  }
}

console.log('[YukiRem BG] Background script loaded with simplified architecture');