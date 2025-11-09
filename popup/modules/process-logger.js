/**
 * 处理流程和日志系统模块
 */

class ProcessLoggerManager {
  constructor() {
    // 处理状态
    this.isProcessing = false;
    this.isPaused = false;
    this.totalVideos = 0;
    this.processedVideos = 0;
    this.removedVideos = 0;

    // 数据存储
    this.actionLog = [];
    this.removedUrls = [];
    this.pendingUrls = [];

    // 日志相关
    this.logQueue = [];
    this.isTyping = false;
    this.currentTypewriterTimeouts = [];
  }

  // === 核心处理流程 ===

  async startRemoval(sessionAuth) {
    if (this.isProcessing) return;

    // 不需要在这里检查标签页和 content script
    // 让 background script 处理所有的标签页管理和脚本注入
    // 直接发送开始命令到 background

    this.isProcessing = true;

    // 追踪 "处理开始" 事件（附带 uid / is_premium / remaining）
    try {
      const uid = sessionAuth && sessionAuth.accountInfo && typeof sessionAuth.accountInfo.id !== 'undefined'
        ? sessionAuth.accountInfo.id
        : null;
      const isPremium = !!(sessionAuth && sessionAuth.quotaInfo && sessionAuth.quotaInfo.is_premium);
      const remaining = Math.max(0, (sessionAuth && sessionAuth.quotaInfo && typeof sessionAuth.quotaInfo.remaining !== 'undefined')
        ? sessionAuth.quotaInfo.remaining
        : 0);
      sessionAuth.trackEvent('process_started', { uid, is_premium: isPremium, remaining });
    } catch (_) {
      // 忽略采集失败，不影响主流程
      sessionAuth.trackEvent('process_started');
    }

    this.clearProcessingData();
    this.setState('processing');
    this.updateStatus(ClearTokUtils.getText('statusInitializing'));
    this.updateProgress(0, 1);
    this.addLogEntry(ClearTokUtils.getText('logStartingProcess'), 'info');

    try {
      // 使用新的消息服务发送消息到 background
      await window.messageService.sendToBackground('REMOVE_REPOSTS', {
        extensionId: chrome.runtime.id
      });
    } catch (error) {
      this.handleError('Failed to start removal process', error);
    }
  }

  clearProcessingData() {
    this.totalVideos = 0;
    this.processedVideos = 0;
    this.removedVideos = 0;
    this.actionLog = [];
    this.removedUrls = [];
    this.pendingUrls = [];

    const actionLog = document.getElementById('actionLog');
    if (actionLog) actionLog.innerHTML = '';

    this.updateRemovedVideosList('removedVideosList', 'removedCount');
    this.updateRemovedVideosList('removedVideosListComplete', 'removedCountComplete');

    const progressFill = document.getElementById('progressFill');
    if (progressFill) progressFill.style.width = '0%';

    const progressText = document.getElementById('progressText');
    if (progressText) progressText.textContent = '0 / 0';
  }

  async togglePause() {
    // 简化版本 - 直接切换状态并发送消息
    this.isPaused = !this.isPaused;
    const pauseButton = document.getElementById('pauseButton');

    if (this.isPaused) {
      pauseButton.textContent = ClearTokUtils.getText('resumeButton');
      pauseButton.className = 'control-button resume';
      this.addLogEntry(ClearTokUtils.getText('logProcessPaused'), 'info');
      // 发送暂停消息，忽略错误
      window.messageService.sendToBackground('PAUSE_REMOVAL').catch(() => {});
    } else {
      pauseButton.textContent = ClearTokUtils.getText('pauseButton');
      pauseButton.className = 'control-button pause';
      this.addLogEntry(ClearTokUtils.getText('logProcessResumed'), 'info');
      // 发送恢复消息，忽略错误
      window.messageService.sendToBackground('RESUME_REMOVAL').catch(() => {});
    }
  }

  // 检查TikTok标签页状态
  async checkTabConnection() {
    try {
      // 从 background 获取当前处理的 tabId
      const state = await window.messageService.sendToBackground('GET_STATE');

      if (!state?.process?.tabId) {
        this.resetToInitialState();
        return false;
      }

      const activeTabId = state.process.tabId;

      // 验证 tab 是否仍然存在
      try {
        await chrome.tabs.get(activeTabId);
      } catch (e) {
        // Tab 已关闭
        this.resetToInitialState();
        return false;
      }

      // 尝试ping content script
      try {
        const response = await chrome.tabs.sendMessage(activeTabId, {
          type: 'PING',
          timestamp: Date.now()
        });

        // MessageBus 返回 { success: true, result: 'PONG' }
        if (response?.success !== true || response?.result !== 'PONG') {
          this.resetToInitialState();
          return false;
        }
        return true;
      } catch (error) {
        // 连接失败，重置状态
        this.resetToInitialState();
        return false;
      }
    } catch (error) {
      console.error('[ClearTok] Error checking tab connection:', error);
      this.resetToInitialState();
      return false;
    }
  }

  // 重置界面到初始状态
  resetToInitialState() {
    this.isProcessing = false;
    this.setState('welcome');

    // 重置步骤卡片状态
    const step1Card = document.getElementById('openTikTokStep');
    const step2Card = document.getElementById('step2Card');
    const startButton = document.getElementById('startButton');

    step1Card?.classList.add('step-active');
    step1Card?.classList.remove('step-inactive', 'step-checking');
    step2Card?.classList.add('step-inactive');
    step2Card?.classList.remove('step-active');
    startButton?.setAttribute('disabled', 'true');

    // 更新登录状态显示
    const loginStatus = document.getElementById('loginStatus');
    if (loginStatus) {
      loginStatus.innerHTML = `
        <div class="status-icon">⚪</div>
        <div class="status-text">
          <span>${ClearTokUtils.getText('loginStatusDefault')}</span>
        </div>
      `;
    }

    // 清空进度显示
    const progressInfo = document.querySelector('.progress-info');
    if (progressInfo) {
      progressInfo.textContent = '';
    }

    // 隐藏进度条
    const progressContainer = document.querySelector('.progress-container');
    if (progressContainer) {
      progressContainer.style.display = 'none';
    }

    console.log('[ClearTok] UI reset to initial state');
  }

  restart(sessionAuth) {
    this.isProcessing = false;
    this.isPaused = false;

    // 追踪 "重启" 事件
    if (sessionAuth && sessionAuth.sessionId) {
      sessionAuth.trackEvent('process_restarted');
    }

    this.clearProcessingData();
    this.setState('welcome');

    const pauseButton = document.getElementById('pauseButton');
    if (pauseButton) {
      pauseButton.textContent = ClearTokUtils.getText('pauseButton');
      pauseButton.className = 'control-button pause';
    }
  }

  setState(newState) {
    const states = ['welcome', 'processing', 'complete', 'error'];
    states.forEach(state => {
      const element = document.getElementById(`${state}State`);
      if (element) element.style.display = 'none';
    });
    const currentElement = document.getElementById(`${newState}State`);
    if (currentElement) currentElement.style.display = 'block';
  }

  updateStatus(message) {
    const statusElement = document.getElementById('statusMessage');
    if (statusElement) statusElement.textContent = message;
  }

  updateProgress(current, total) {
    const progressFill = document.getElementById('progressFill');
    const progressText = document.getElementById('progressText');
    if (progressFill && progressText) {
      const percentage = total > 0 ? (current / total) * 100 : 0;
      progressFill.style.width = `${percentage}%`;
      progressText.textContent = `${current} / ${total}`;
    }
  }

  handleCompletion(message, sessionAuth) {
    this.isProcessing = false;
    this.setState('complete');
    // 确保 removedCount 是一个数字，并使用 removedVideos 作为备用
    const removedCount = message.removedCount || this.removedVideos || 0;
    const duration = message.duration || this.duration || 0;
    let durationText = '';
    const totalDurationSeconds = sessionAuth.sessionStartTime ? Math.floor((Date.now() - sessionAuth.sessionStartTime) / 1000) : (duration ? Math.floor(duration.total / 1000) : 0);

    // 追踪 "完成" 事件，并附上最终数据
    sessionAuth.trackEvent('process_completed', {
      reposts_removed: removedCount,
      total_duration_seconds: totalDurationSeconds
    });

    // 上报使用量到服务器
    if (removedCount > 0) {
      this.reportUsage(sessionAuth, removedCount);
    }

    // 更新本地配额使用量
    sessionAuth.updateQuotaUsage(removedCount);

    const completionMessage = document.getElementById('completionMessage');
    if (completionMessage) {
      let durationText = '';
      if (duration) {
        if (duration.minutes > 0) {
          durationText = ClearTokUtils.getText('durationMinutes', {
            minutes: String(duration.minutes),
            seconds: String(duration.seconds)
          });
        } else {
          durationText = ClearTokUtils.getText('durationSeconds', {
            seconds: String(duration.seconds)
          });
        }
      }
      // 确保 count 参数正确传递，转换为字符串
      const messageText = ClearTokUtils.getText('completionMessageSuccess', {
        count: String(removedCount),
        plural: removedCount !== 1 ? 's' : '',
        duration: durationText
      });

      // 调试：如果消息仍然包含 {count}，使用备用方法
      if (messageText.includes('{count}')) {
        completionMessage.textContent = `Successfully removed ${removedCount} reposted video ${removedCount !== 1 ? 's' : ''} from your profile ${durationText}`;
      } else {
        completionMessage.textContent = messageText;
      }
    }
    this.updateRemovedVideosList('removedVideosListComplete', 'removedCountComplete');
    const shareBtn = document.getElementById('shareCardButton');
    if (shareBtn) {
      shareBtn.style.display = this.removedUrls.length > 0 ? 'block' : 'none';
      shareBtn.onclick = () => this.showShareModal();
    }

    // Completion primary action:
    // - Premium users: always show "Rate Us"
    // - Non‑premium: if removed >= 50 show "Rate Us", else promote Plus
    const rateBtn = document.getElementById('rateUsButtonComplete');
    if (rateBtn) {
      const isPremium = !!(sessionAuth && sessionAuth.quotaInfo && sessionAuth.quotaInfo.is_premium);
      if (isPremium || removedCount >= 50) {
        // Keep original click listener (show rating modal) set in popup.js; only ensure label
        rateBtn.textContent = ClearTokUtils.getText('rateUsButton') || 'Rate Us';
        rateBtn.removeAttribute('data-action');
        rateBtn.removeAttribute('disabled');
      } else {
        rateBtn.textContent = ClearTokUtils.getText('unlockPlusButton') || 'Unlock unlimited';
        // Signal popup.js to open premium instead of rating modal
        rateBtn.setAttribute('data-action', 'open-premium');
      }
    }

    this.addLogEntry(ClearTokUtils.getText('logProcessCompleted', { count: removedCount, duration: durationText }), 'success');
    if (removedCount > 0) {
      this.refreshTikTokPage();
    }
  }

  handleNoReposts(message, sessionAuth) {
    this.isProcessing = false;
    this.setState('complete');

    // 追踪 "未找到转帖" 事件
    sessionAuth.trackEvent('no_reposts_found');

    const completionMessage = document.getElementById('completionMessage');
    if (completionMessage) completionMessage.textContent = ClearTokUtils.getText('noRepostsFoundMessage');
    const shareBtn = document.getElementById('shareCardButton');
    if (shareBtn) shareBtn.style.display = 'none';
    this.addLogEntry(ClearTokUtils.getText('logNoRepostsFound', { duration: '' }), 'info');
    ClearTokUtils.showNotification(ClearTokUtils.getText('notificationNoRepostsFound'), 'info');
  }

  handleError(message, error = null, sessionAuth = null) {
    this.isProcessing = false;
    this.setState('error');
    const errorMessage = document.getElementById('errorMessage');
    if (errorMessage) errorMessage.textContent = message;

    // 追踪 "错误" 事件
    if (sessionAuth) {
      sessionAuth.trackEvent('process_error', {
        error_message: message,
        error_details: error ? error.toString() : ''
      });
    }

    this.addLogEntry(ClearTokUtils.getText('logError', { message: message }), 'error');
    if (error) console.error('Extension error:', error);
  }

  async refreshTikTokPage() {
    try {
      // 优先使用正在工作的 TikTok 标签
      const state = await window.messageService.getState();
      const workingTabId = state?.process?.tabId || null;

      const reloadAndNavigate = async (tabId) => {
        await chrome.tabs.reload(tabId);
        this.addLogEntry(ClearTokUtils.getText('logRefreshingPage'), 'info');
        ClearTokUtils.showNotification(ClearTokUtils.getText('notificationPageRefreshed'), 'success');

        // 确保脚本注入
        // setTimeout(async () => {
        //   try { await window.messageService.sendToBackground('CHECK_LOGIN_TAB', { tabId }); } catch (_) {}
        // }, 3000);
        // 使用与工作流一致的函数导航到 Reposts 标签
        setTimeout(async () => {
          try { await window.messageService.navigateToReposts(); } catch (_) {}
        }, 5000);
      };

      if (workingTabId) {
        await reloadAndNavigate(workingTabId);
        return;
      }

      // 兜底：未能获取进行中的 tab，则选择最近一个 TikTok 标签
      const tabs = await chrome.tabs.query({ url: '*://www.tiktok.com/*' });
      if (tabs.length > 0) {
        await reloadAndNavigate(tabs[tabs.length - 1].id);
      }
    } catch (error) {
      console.log('Error refreshing page:', error);
    }
  }

  // === 使用量上报 ===

  async reportUsage(sessionAuth, count) {
    try {
      if (!sessionAuth.sessionId) {
        console.warn('No session ID, cannot report usage');
        return;
      }

      const result = await window.apiService.reportUsage(sessionAuth.sessionId, count);
      if (result.success) {
        console.log(`✅ Successfully reported ${count} removals to server`);
      } else {
        console.warn('Failed to report usage:', result.error);
      }
    } catch (error) {
      console.error('Error reporting usage:', error);
    }
  }

  // === 日志系统 ===

  addLogEntry(message, type = 'info', videoInfo = null) {
    // 添加到队列
    const now = new Date();
    this.logQueue.push({
      message,
      type,
      videoInfo,
      timestamp: ClearTokUtils.formatTimestamp()
    });

    // 如果当前没有在打字，开始处理队列
    if (!this.isTyping) {
      this.processLogQueue();
    }
  }

  // 处理日志打印队列
  async processLogQueue() {
    this.isTyping = true;

    while (this.logQueue.length > 0) {
      const logItem = this.logQueue.shift();
      await this.printSingleLog(logItem);

      // 如果队列还有更多日志，显示等待效果
      if (this.logQueue.length > 0) {
        await this.showWaitingDots();
      }
    }

    this.isTyping = false;
  }

  // 显示等待省略号效果
  async showWaitingDots() {
    const actionLog = document.getElementById('actionLog');
    if (!actionLog) return;

    // 创建等待指示器
    const waitingElement = document.createElement('div');
    waitingElement.className = 'log-waiting-dots';
    const timestamp = ClearTokUtils.formatTimestamp();
    waitingElement.innerHTML = `
      <span class="log-timestamp">${timestamp}</span>
      <div class="log-content">
        <span class="log-icon">⏳</span>
        <span class="waiting-dots">
          <span class="dot">.</span><span class="dot">.</span><span class="dot">.</span>
        </span>
      </div>
    `;

    // 插入到顶部
    actionLog.insertBefore(waitingElement, actionLog.firstChild);

    // 确保滚动到顶部显示等待效果
    setTimeout(() => {
      actionLog.scrollTop = 0;
    }, 50);

    // 等待时间可以稍短一些，让体验更流畅
    await ClearTokUtils.sleep(600);

    // 移除等待指示器
    if (waitingElement.parentNode) {
      waitingElement.parentNode.removeChild(waitingElement);
    }
  }

  // 打印单条日志
  async printSingleLog(logItem) {
    const actionLog = document.getElementById('actionLog');
    if (!actionLog) return;

    const logEntry = document.createElement('div');
    logEntry.className = `log-line log-${logItem.type}`;

    // 初始化空内容
    logEntry.innerHTML = '';

    // 在顶部插入新日志
    actionLog.insertBefore(logEntry, actionLog.firstChild);

    // 开始打字机效果（返回Promise等待完成）
    await this.typewriterEffectAsync(logEntry, logItem.message, logItem.type, logItem.videoInfo, logItem.timestamp);

    // 限制日志条数（从底部移除）
    while (actionLog.children.length > CONSTANTS.MAX_LOG_ENTRIES) {
      actionLog.removeChild(actionLog.lastChild);
    }

    // 确保顶部可见
    setTimeout(() => {
      actionLog.scrollTop = 0;
    }, 50);

    // 更新内存日志
    this.actionLog.unshift(logItem);
    if (this.actionLog.length > CONSTANTS.MAX_LOG_ENTRIES) {
      this.actionLog = this.actionLog.slice(0, CONSTANTS.MAX_LOG_ENTRIES);
    }
  }

  // 异步打字机效果实现
  typewriterEffectAsync(element, messageText, type, videoInfo, timestamp) {
    return new Promise((resolve) => {
      let i = 0;
      const speed = type === 'waiting' ? 15 : CONSTANTS.TYPEWRITER_SPEED; // 大幅提升打字速度

      // 获取图标
      const icon = ClearTokUtils.getLogIcon(type);

      // 立即显示时间戳和图标（时间在前）
      element.innerHTML = `
        <span class="log-timestamp">${timestamp}</span>
        <div class="log-content">
          <span class="log-icon">${icon}</span>
          <span class="log-text"><span class="cursor">|</span></span>
        </div>
      `;

      const textSpan = element.querySelector('.log-text');

      function typeChar() {
        if (i < messageText.length) {
          // 插入字符到光标前
          const currentText = messageText.substring(0, i + 1);
          textSpan.innerHTML = `${currentText}<span class="cursor">|</span>`;
          i++;
          setTimeout(typeChar, speed);
        } else {
          // 打字完成，移除光标，添加链接（如果有）
          if (videoInfo && videoInfo.url) {
            const videoTitle = videoInfo.title ? `"${videoInfo.title}"` : 'video';
            textSpan.innerHTML = `${messageText} → <span class="log-link">${videoTitle}</span>`;

            // 添加点击事件监听器
            const linkElement = textSpan.querySelector('.log-link');
            if (linkElement) {
              linkElement.addEventListener('click', () => {
                if (window.clearTokExtension) {
                  window.clearTokExtension.openVideoInNewTab(videoInfo.url);
                } else {
                  // 备用方法
                  chrome.tabs.create({ url: videoInfo.url, active: false });
                }
              });
            }
          } else {
            textSpan.innerHTML = messageText;
          }

          // 打字完成，resolve Promise
          resolve();
        }
      }

      // 开始打字动画
      setTimeout(typeChar, 200);
    });
  }

  showDetailedLog() {
    let logContent = '';
    if (this.removedUrls.length > 0) {
      logContent += ClearTokUtils.getText('removedVideosHeader', { count: this.removedUrls.length }) + '\n';
      this.removedUrls.forEach((item, index) => {
        logContent += `${index + 1}. ${item.title || ClearTokUtils.getText('videoUnknownTitle')} by ${item.author || ClearTokUtils.getText('videoUnknownAuthor')}\n`;
        logContent += `   ${item.url}\n`;
        logContent += `   ${ClearTokUtils.getText('videoRemovedAt', { timestamp: item.timestamp })}\n\n`;
      });
    }
    if (this.pendingUrls.length > 0) {
      logContent += ClearTokUtils.getText('pendingVideosHeader') + '\n';
      this.pendingUrls.forEach((item, index) => {
        const wasRemoved = this.removedUrls.find(removed => removed.url === item.url);
        if (!wasRemoved) {
          logContent += `${index + 1}. ${item.title || ClearTokUtils.getText('videoUnknownTitle')} by ${item.author || ClearTokUtils.getText('videoUnknownAuthor')}\n`;
          logContent += `   ${item.url}\n`;
          logContent += `   ${ClearTokUtils.getText('videoStatusPending')}\n\n`;
        }
      });
    }
    if (logContent.trim() === '') {
      ClearTokUtils.showNotification(ClearTokUtils.getText('notificationNoUrls'), 'info');
      return;
    }
    ClearTokUtils.copyToClipboard(logContent, () => {
      this.addLogEntry(ClearTokUtils.getText('logVideoUrlsCopied'), 'info');
      ClearTokUtils.showNotification(ClearTokUtils.getText('notificationUrlsCopied'), 'success');
    }, () => {
      this.addLogEntry(ClearTokUtils.getText('logFailedToCopyUrls'), 'error');
      ClearTokUtils.showNotification(ClearTokUtils.getText('notificationFailedToCopyUrls'), 'error');
    });
  }

  // === 视频管理 ===

  addRemovedVideo(videoInfo) {
    this.removedUrls.push({ ...videoInfo, timestamp: new Date().toLocaleString() });
    this.updateRemovedVideosList('removedVideosList', 'removedCount');
    this.updateRemovedVideosList('removedVideosListComplete', 'removedCountComplete');
  }

  updateRemovedVideosList(listId, countId) {
    const list = document.getElementById(listId);
    const count = document.getElementById(countId);
    if (list && count) {
      count.textContent = this.removedUrls.length;
      if (this.removedUrls.length > 0) {
        list.innerHTML = this.removedUrls.slice(-10).map((video) => {
          const videoTitle = video.title || ClearTokUtils.getText('videoUnknownTitle');
          const videoAuthor = video.author || ClearTokUtils.getText('videoUnknownAuthor');
          const url = video.url || '';
          const linkText = `"${ClearTokUtils.escapeHtml(videoTitle)}" by ${ClearTokUtils.escapeHtml(videoAuthor.startsWith('@') ? videoAuthor : '@' + videoAuthor)}`;
          return `
            <div class="removed-video-line">
              <a class="video-link" href="${ClearTokUtils.escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${linkText}</a>
            </div>
          `;
        }).join('');
      } else {
        list.innerHTML = `<div class="no-videos">${ClearTokUtils.getText('noRemovedVideos')}</div>`;
      }
    }
  }

  openVideoInNewTab(url) {
    if (url && url.startsWith('http')) {
      chrome.tabs.create({ url: url, active: false });
      ClearTokUtils.showNotification(ClearTokUtils.getText('notificationVideoOpened') || '🔗 Video opened in new tab', 'info');
    } else {
      ClearTokUtils.showNotification(ClearTokUtils.getText('notificationInvalidVideoUrl') || '❌ Invalid video URL', 'error');
    }
  }

  // === 导出功能 ===

  exportRemovedCSV() {
    if (!this.removedUrls || this.removedUrls.length === 0) {
      ClearTokUtils.showNotification(ClearTokUtils.getText('notificationNoUrls') || 'No removed videos to export', 'info');
      return;
    }

    const header = ['username', 'description', 'url', 'videoId'];
    const rows = this.removedUrls.map(v => {
      const username = (v.author || '').replace(/^@/, '') || '';
      const description = v.title || '';
      const url = v.url || '';
      let videoId = '';
      try {
        const m = url.match(/\/video\/(\d+)/);
        if (m && m[1]) videoId = m[1];
      } catch (_) {}
      return [username, description, url, videoId]
        .map(s => `"${ClearTokUtils.escapeCSV(s)}"`).join(',');
    });
    const csv = ['"' + header.join('","') + '"', ...rows].join('\n');

    const filename = ClearTokUtils.generateExportFileName('cleartok_removed');
    const success = ClearTokUtils.downloadFile(csv, filename);

    if (success) {
      ClearTokUtils.showNotification(ClearTokUtils.getText('notificationExportSuccess') || '✅ Exported removed list as CSV', 'success');
    } else {
      ClearTokUtils.showNotification(ClearTokUtils.getText('notificationExportFailed') || '❌ Failed to export CSV', 'error');
    }
  }

  copyRemovedList() {
    if (this.removedUrls.length === 0) {
      ClearTokUtils.showNotification(ClearTokUtils.getText('notificationNoUrls'), 'info');
      return;
    }
    const listText = this.removedUrls.map((video, index) => {
      const title = video.title || ClearTokUtils.getText('videoUnknownTitle');
      const author = video.author || ClearTokUtils.getText('videoUnknownAuthor');
      return `${index + 1}. ${title} by ${author}\n   ${video.url}\n   ${ClearTokUtils.getText('videoRemovedAt', { timestamp: video.timestamp })}\n`;
    }).join('\n');
    const fullText = ClearTokUtils.getText('removedVideosHeader', { count: this.removedUrls.length }) + '\n\n' + listText;

    ClearTokUtils.copyToClipboard(fullText, () => {
      ClearTokUtils.showNotification(ClearTokUtils.getText('notificationUrlsCopied'), 'success');
    }, () => {
      ClearTokUtils.showNotification(ClearTokUtils.getText('notificationFailedToCopyUrls'), 'error');
    });
  }
}

// 导出类
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ProcessLoggerManager;
} else {
  window.ProcessLoggerManager = ProcessLoggerManager;
}
