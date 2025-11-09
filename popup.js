/**
 * ClearTok Extension - 主控制器
 * 重构后的精简版本，使用模块化架构
 */

// 确保在导入类之前检查重复注入
chrome.runtime.sendMessage({
  type: 'ENSURE_SELECTORS',
  timestamp: Date.now()
});

class ClearTokExtension {
  constructor() {
    // 核心状态
    this.currentState = 'welcome';
    this.lastMessageTimestamp = 0;

    // 初始化模块管理器
    this.sessionAuth = new SessionAuthManager();
    this.processLogger = new ProcessLoggerManager();
    this.modals = new ModalsManager();

    // 初始化
    this.init();
  }

  async init() {
    // 初始化事件监听器
    this.initializeEventListeners();

    // 初始化各模块
    this.sessionAuth.cleanupExpiredSessions();
    await this.sessionAuth.initializeSession();
    this.sessionAuth.initializeFooterAuth();
    this.modals.initializeModals();

    // 检查TikTok登录状态
    this.sessionAuth.checkTikTokLogin();

    // 设置定期检查连接状态（每3秒）
    setInterval(() => {
      if (this.processLogger.isProcessing) {
        this.processLogger.checkTabConnection();
      }
    }, 3000);

    // 在 popup 关闭时自动暂停并上报
    window.addEventListener('beforeunload', () => {
      try {
        if (this.processLogger.isProcessing && !this.processLogger.isPaused) {
          // 尝试暂停，但忽略任何错误（因为进程可能已经结束）
          window.messageService.sendToBackground('PAUSE_REMOVAL').catch(() => {});
        }
      } catch (_) { /* noop */ }
    });

    // 委托点击监听器为视频链接按钮
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.video-link-btn');
      if (btn && btn.dataset.url) {
        this.processLogger.openVideoInNewTab(btn.dataset.url);
      }
    });
  }

  initializeEventListeners() {
    // TikTok 相关
    document.getElementById('openTikTokStep')?.addEventListener('click', () => this.sessionAuth.openTikTok());
    document.getElementById('recheckButton')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.sessionAuth.recheckLoginStatus();
    });

    // 处理流程控制
    document.getElementById('startButton')?.addEventListener('click', () => this.startRemoval());
    document.getElementById('pauseButton')?.addEventListener('click', () => this.processLogger.togglePause());
    document.getElementById('viewLogButton')?.addEventListener('click', () => this.processLogger.showDetailedLog());
    document.getElementById('retryButton')?.addEventListener('click', () => this.restart());

    // 评分和反馈
    document.getElementById('rateUsButton')?.addEventListener('click', () => this.modals.showRatingModal());
    const rateCompleteBtn = document.getElementById('rateUsButtonComplete');
    if (rateCompleteBtn) {
      rateCompleteBtn.addEventListener('click', async () => {
        if (rateCompleteBtn.dataset.action === 'open-premium') {
          // 简化逻辑：先刷新配额，若可用则直接继续删除；否则再打开订阅页
          try {
            await this.sessionAuth.fetchUserQuota();
          } catch (_) {}

          const isPlus = !!this.sessionAuth?.quotaInfo?.is_premium;
          const remaining = Math.max(0, this.sessionAuth?.quotaInfo?.remaining ?? 0);

          if (isPlus || remaining > 0) {
            await this.processLogger.startRemoval(this.sessionAuth);
          } else {
            try {
              let url = 'https://tiktokrepostremover.com/premium/';
              try {
                const u = new URL(url);
                u.searchParams.set('source', 'extension');
                if (this.sessionAuth?.sessionId) u.searchParams.set('session_id', this.sessionAuth.sessionId);
                url = u.toString();
              } catch (_) {}
              chrome.tabs.create({ url, active: true });
            } catch (_) {}
          }
          return;
        }
        this.modals.showRatingModal();
      });
    }
    document.getElementById('rateUsActionButton')?.addEventListener('click', () => this.modals.handleRatingAction(this.sessionAuth));
    document.getElementById('submitFeedbackButton')?.addEventListener('click', () => this.modals.handleFeedbackSubmit(this.sessionAuth));
    document.getElementById('alreadyRatedButton')?.addEventListener('click', () => this.modals.closeRatingModal());

    // 语言选择
    document.getElementById('languageSelectorBtn')?.addEventListener('click', () => this.modals.showLanguageSelector());
    document.getElementById('closeLanguageModal')?.addEventListener('click', () => this.modals.hideLanguageSelector());

    // 关闭语言模态框当点击外部时
    document.getElementById('languageModal')?.addEventListener('click', (e) => {
      if (e.target.classList.contains('modal-overlay')) {
        this.modals.hideLanguageSelector();
      }
    });

    // 语言选项选择
    document.querySelectorAll('.language-option').forEach(option => {
      option.addEventListener('click', () => {
        const langCode = option.getAttribute('data-lang');
        if (langCode) {
          this.modals.selectLanguage(langCode);
        }
      });
    });

    // 分享卡片
    document.getElementById('shareCardButton')?.addEventListener('click', () => this.modals.showShareModal());
    document.getElementById('closeShareModal')?.addEventListener('click', () => this.modals.closeShareModal());
    document.getElementById('shareModal')?.addEventListener('click', (e) => {
      if (e.target.classList?.contains('modal-overlay')) this.modals.closeShareModal();
    });
    document.getElementById('shareTaglineInput')?.addEventListener('input', () => this.modals.updateSharePreview(this.sessionAuth.tikTokUsername));
    document.getElementById('shareTaglineShuffleBtn')?.addEventListener('click', () => this.modals.shuffleTagline());
    document.getElementById('shareSaveBtn')?.addEventListener('click', () => this.modals.saveShareCard(this.sessionAuth.tikTokUsername));
    document.getElementById('shareCopyCaptionBtn')?.addEventListener('click', () => this.modals.copyShareCaption(this.sessionAuth.tikTokUsername));

    // 导出按钮 (CSV)
    document.getElementById('exportRemovedButton')?.addEventListener('click', () => this.processLogger.exportRemovedCSV());
    document.getElementById('exportRemovedButtonComplete')?.addEventListener('click', () => this.processLogger.exportRemovedCSV());

    // 设置shuffle按钮标签
    const shuffleBtn = document.getElementById('shareTaglineShuffleBtn');
    if (shuffleBtn) {
      const label = ClearTokUtils.getText('shareShuffleTitle');
      if (label) shuffleBtn.setAttribute('aria-label', label);
    }

    // 使用新的消息服务注册消息处理器
    this.registerMessageHandlers();
  }

  // === 主要流程方法 ===

  async startRemoval() {
    // 点击时先刷新一次配额，尽量避免陈旧数据
    try { await this.sessionAuth.fetchUserQuota(); } catch (_) {}

    const isPlus = !!this.sessionAuth?.quotaInfo?.is_premium;
    const remaining = Math.max(0, this.sessionAuth?.quotaInfo?.remaining ?? this.sessionAuth.getRemainingQuota());

    if (!isPlus && remaining <= 0) {
      // 达到限额，跳转到相应页面，并携带 session_id/source
      const base = this.sessionAuth.quotaInfo.authenticated
        ? 'https://tiktokrepostremover.com/premium/'   // 已登录用户跳转到订阅页面
        : 'https://tiktokrepostremover.com/login/';     // 未登录用户跳转到登录页面

      let url = base;
      try {
        const u = new URL(base);
        u.searchParams.set('source', 'extension');
        if (this.sessionAuth?.sessionId) u.searchParams.set('session_id', this.sessionAuth.sessionId);
        url = u.toString();
      } catch (_) { /* noop */ }
      chrome.tabs.create({ url });
      return;
    }

    await this.processLogger.startRemoval(this.sessionAuth);
  }

  restart() {
    this.processLogger.restart(this.sessionAuth);
    this.sessionAuth.checkTikTokLogin();
  }

  // === 消息处理器注册 ===

  registerMessageHandlers() {
    // 状态变化（来自 background）
    window.messageService.on('STATE_CHANGED', (payload) => {
      this.handleStateChanged(payload);
    });

    // 登录状态更新
    window.messageService.on('LOGIN_STATUS_UPDATE', (payload) => {
      this.handleLoginStatusUpdate(payload);
    });

    // 进度更新
    window.messageService.on('UPDATE_PROGRESS', (payload) => {
      this.handleProgressUpdate(payload);
    });

    // 视频移除
    window.messageService.on('VIDEO_REMOVED', (payload) => {
      this.handleVideoRemoved(payload);
    });

    // 视频跳过
    window.messageService.on('VIDEO_SKIPPED', (payload) => {
      this.handleVideoSkipped(payload);
    });

    // 等待状态
    window.messageService.on('WAITING', (payload) => {
      this.handleWaiting(payload);
    });

    // 状态更新
    window.messageService.on('STATUS_UPDATE', (payload) => {
      this.handleStatusUpdate(payload);
    });

    // UI等待超时
    window.messageService.on('UI_WAIT_TIMEOUT', (payload) => {
      this.handleUiWaitTimeout(payload);
    });

    // 错误
    window.messageService.on('ERROR', (payload) => {
      this.handleError(payload);
    });

    // 完成
    window.messageService.on('COMPLETE', (payload) => {
      this.handleComplete(payload);
    });

    // 没有找到reposts
    window.messageService.on('NO_REPOSTS_FOUND', (payload) => {
      this.handleNoReposts(payload);
    });

    // 标签页关闭处理
    window.messageService.on('TAB_CLOSED', (payload) => {
      this.handleTabClosed(payload);
    });
  }

  // === 消息处理方法 ===

  handleLoginStatusUpdate(message) {
    if (1) { // 替换为 switch 以下的内容
      if (message.isLoggedIn) {
          if (message.username && message.username !== this.sessionAuth.tikTokUsername) {
            this.sessionAuth.tikTokUsername = message.username;
            this.sessionAuth.trackEvent('user_logged_in', { tiktok_username: message.username });
          }
          this.sessionAuth.updateLoginStatus('loggedIn');
        } else {
          if (this.sessionAuth.tikTokUsername !== null) {
            this.sessionAuth.tikTokUsername = null;
            this.sessionAuth.trackEvent('user_logged_out');
          }
          this.sessionAuth.updateLoginStatus('notLoggedIn');
          ClearTokUtils.showNotification(ClearTokUtils.getText('notificationPleaseLogin') || '⚠️ Please log in to TikTok.com to continue', 'error');
      }
    }
  }

  handleProgressUpdate(message) {
        // 仅在首次与最终两个阶段上报事件
        if (message.phase === 'first' || message.phase === 'final') {
          this.sessionAuth.trackEvent('total_reposts_found', {
            total_reposts_found: message.total,
            phase: message.phase
          });
        }
        this.processLogger.processedVideos = message.current;
        this.processLogger.totalVideos = message.total;
        this.processLogger.updateProgress(message.current, message.total);
        this.processLogger.updateStatus(`Processing video ${message.current} of ${message.total}`);
  }

  handleVideoRemoved(message) {
        console.log('------------videoRemoved', message);
        this.processLogger.removedVideos++;
        if (message.title || message.author || message.url) {
          this.processLogger.addRemovedVideo({ title: message.title, author: message.author, url: message.url });
        }

        let removeLogMessage;
        if (message.title && message.author) {
          removeLogMessage = `Removed: "${message.title}" by @${message.author}`;
        } else if (message.title) {
          removeLogMessage = `Removed: "${message.title}"`;
        } else if (message.author) {
          removeLogMessage = `Removed video by @${message.author}`;
        } else {
          removeLogMessage = `Video #${message.index || this.processLogger.removedVideos} removed`;
        }

        this.processLogger.addLogEntry(removeLogMessage, 'success', { title: message.title, author: message.author, url: message.url });
  }

  handleVideoSkipped(message) {
        let skipLogMessage = ClearTokUtils.getText('logVideoSkipped', { number: message.index });
        if (message.title && message.author) skipLogMessage = ClearTokUtils.getText('logVideoSkippedWithTitle', { title: message.title, author: message.author });
        else if (message.title) skipLogMessage = ClearTokUtils.getText('logVideoSkippedTitleOnly', { title: message.title });
        else if (message.author) skipLogMessage = ClearTokUtils.getText('logVideoSkippedAuthorOnly', { author: message.author });
        skipLogMessage = ClearTokUtils.getText('logVideoSkippedWithReason', { message: skipLogMessage, reason: message.reason });
        this.processLogger.addLogEntry(skipLogMessage, 'info');
  }

  handleWaiting(message) {
        if (message.seconds === 'paused') {
          this.processLogger.addLogEntry('Process paused by user', 'waiting');
        } else if (typeof message.seconds === 'number') {
          const waitMessage = `Waiting ${message.seconds}s before next action...`;
          this.processLogger.addLogEntry(waitMessage, 'waiting');
        } else if (message.reason) {
          this.processLogger.addLogEntry(message.reason, 'waiting');
        } else {
          this.processLogger.addLogEntry('Processing...', 'waiting');
        }
  }

  handleStatusUpdate(message) {
        // Prefer i18n key when available
        let statusText = message.status || '';
        if (message.statusKey) {
          statusText = ClearTokUtils.getText(message.statusKey, message.statusParams || {});
        }
        if (statusText) this.processLogger.updateStatus(statusText);

        // Log the resolved status text (once per update)
        if (statusText) {
          this.processLogger.addLogEntry(statusText, 'info');
        }
  }

  handleUiWaitTimeout(message) {
        this.sessionAuth.trackEvent('wait_for_element_timeout', {
          selector_key: message.selectorKey,
          timeout_ms: message.timeout,
          page_url: message.url
        });
  }

  handleError(message) {
        this.processLogger.handleError(message.message, message.error, this.sessionAuth);
        // 如果是连接错误，检查并重置状态
        if (message.message && message.message.includes('No active TikTok tab found')) {
          this.processLogger.resetToInitialState();
        }
  }

  handleComplete(message) {
        this.processLogger.handleCompletion(message, this.sessionAuth);
  }

  handleNoReposts(message) {
        this.processLogger.handleNoReposts(message, this.sessionAuth);
  }

  handleTabClosed(payload) {
    console.log('[ClearTok Popup] Tab closed, stats preserved:', payload.stats);

    // 更新处理状态为停止（非错误状态）
    this.processLogger.isProcessing = false;
    this.processLogger.isPaused = false;

    // 更新统计信息（如果提供）
    if (payload.stats) {
      this.processLogger.totalVideos = payload.stats.totalReposts || 0;
      this.processLogger.processedVideos = payload.stats.processedVideos || 0;
      this.processLogger.removedVideos = payload.stats.removedVideos || 0;
    }

    // 显示适当的完成状态
    if (payload.hasRemovedVideos || this.processLogger.removedVideos > 0) {
      // 调用 handleCompletion 来显示完成消息
      this.processLogger.handleCompletion({
        removedCount: this.processLogger.removedVideos,
        duration: this.processLogger.duration || 0
      }, this.sessionAuth);
      // 如果有已删除的视频，显示完成状态
      this.processLogger.setState('complete');
      this.processLogger.addLogEntry('Process stopped - tab was closed. Statistics preserved.', 'warning');
    } else {
      // 如果没有删除任何视频，显示欢迎状态
      this.processLogger.setState('welcome');
      this.processLogger.addLogEntry('Process stopped - tab was closed.', 'info');
    }

    // 更新状态显示
    this.processLogger.updateStatus('Process stopped due to tab closure');
  }

  handleStateChanged(state) {
    // 同步状态到 UI
    if (state.stats) {
      this.processLogger.totalVideos = state.stats.totalReposts;
      this.processLogger.processedVideos = state.stats.processedVideos;
      this.processLogger.removedVideos = state.stats.removedVideos;
    }

    if (state.process) {
      this.processLogger.isProcessing = state.process.isRunning;
      this.processLogger.isPaused = state.process.isPaused;
    }

    // 更新 UI - 优化状态判断逻辑
    if (state.process.isRunning) {
      this.processLogger.setState('processing');
    } else if (state.stats.removedVideos > 0 || this.processLogger.removedVideos > 0) {
      // 如果有已删除的视频（从 state 或本地记录），显示完成状态
      this.processLogger.setState('complete');
    } else if (!state.process.isRunning && state.stats.totalReposts === 0) {
      // 没有运行且没有数据，显示欢迎界面
      this.processLogger.setState('welcome');
    }
  }
}

// 确保在 DOM 加载完成后初始化
document.addEventListener('DOMContentLoaded', async () => {
  // 假设 window.i18n 和 window.apiService 已经通过其他脚本注入
  if (typeof I18n !== 'undefined') {
    window.i18n = new I18n();
    await window.i18n.init();
  }

  const extension = new ClearTokExtension();
  // 设置全局引用以便在HTML onclick中使用
  window.clearTokExtension = extension;
});
