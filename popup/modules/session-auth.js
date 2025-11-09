/**
 * 会话和认证管理模块
 */

class SessionAuthManager {
  constructor() {
    // 会话相关
    this.sessionId = null;
    this.sessionStartTime = null;
    this.tikTokUsername = null;

    // 认证相关
    this.currentLoginStatus = null;
    this.accountInfo = null;
    this.footerAuthElement = null;
    this.accountPollingTimer = null;
    this.accountPollingAttempts = 0;

    // 配额信息
    this.quotaInfo = {
      // 默认使用极大数值实现“无限”配额，避免使用不可序列化的 Infinity
      daily_limit: Number.MAX_SAFE_INTEGER,
      daily_used: 0,
      remaining: Number.MAX_SAFE_INTEGER,
      is_premium: true,
      authenticated: false,
      user_email: null,
      last_updated: null,
      date: new Date().toISOString().split('T')[0]
    };

    // 其他状态
    this.isOpeningTikTok = false;
    this.currentTikTokTab = null;

    try {
      window.addEventListener('i18n-language-changed', () => {
        try {
          this.updateLoginStatus(this.currentLoginStatus || 'waiting');
        } catch (_) {}
      });
    } catch (_) {}
  }

  /**
   * 初始化会话
   */
  async initializeSession() {
    try {
      const existingSession = await this.getStoredSession();
      if (existingSession && this.isSessionValid(existingSession)) {
        this.sessionId = existingSession.sessionId;
        this.sessionStartTime = existingSession.sessionStartTime;
        this.tikTokUsername = existingSession.tikTokUsername;
        console.log('复用现有session:', this.sessionId);
        await this.updateStoredSession({ ...existingSession, lastActiveTime: Date.now() });
        return;
      }

      // 如果没有有效会话，则创建新的
      this.sessionStartTime = Date.now();
      const response = await window.apiService.createSession();
      this.sessionId = response.session_id;
      console.log('创建新session:', this.sessionId);
      await this.saveSessionToStorage();

      // 追踪会话创建事件
      this.trackEvent('session_initialized');

      // 获取用户配额信息
      await this.fetchUserQuota();

    } catch (error) {
      console.warn('Failed to initialize session:', error);
    }
  }

  /**
   * 追踪关键事件
   * @param {string} eventName - 事件名
   * @param {Object} data - 事件数据
   */
  async trackEvent(eventName, data = {}) {
    if (!this.sessionId) {
      // 等待 2000ms 后重试
      await ClearTokUtils.sleep(2000);
      if (!this.sessionId) {
        console.warn(`Cannot track event "${eventName}", no session ID.`);
        return;
      }
    }

    try {
      const payload = {
        event_name: eventName,
        ...data,
      };

      // 使用现有的API更新函数来发送事件
      await window.apiService.updateSession(this.sessionId, payload);
      console.log(`✅ Event tracked: ${eventName}`, payload);

      // 如果事件中包含用户名，则更新本地存储
      if (data.tiktok_username) {
        this.tikTokUsername = data.tiktok_username;
        await this.saveSessionToStorage();
      }

    } catch (error) {
      console.warn(`Failed to track event "${eventName}":`, error);
    }
  }

  // === Session 存储管理方法 ===

  async getStoredSession() {
    try {
      const result = await chrome.storage.local.get([CONSTANTS.SESSION_STORAGE_KEY]);
      return result[CONSTANTS.SESSION_STORAGE_KEY] || null;
    } catch (error) {
      console.warn('Failed to get stored session:', error);
      return null;
    }
  }

  isSessionValid(sessionData) {
    if (!sessionData || !sessionData.sessionId || !sessionData.createdTime) return false;
    const sessionAge = Date.now() - sessionData.createdTime;
    if (sessionAge > CONSTANTS.SESSION_EXPIRY_TIME) {
      console.log('Session expired, age:', Math.floor(sessionAge / 1000 / 60), 'minutes');
      return false;
    }
    return true;
  }

  async saveSessionToStorage() {
    try {
      const sessionData = {
        sessionId: this.sessionId,
        sessionStartTime: this.sessionStartTime,
        tikTokUsername: this.tikTokUsername,
        createdTime: Date.now(),
        lastActiveTime: Date.now(),
      };
      await chrome.storage.local.set({ [CONSTANTS.SESSION_STORAGE_KEY]: sessionData });
    } catch (error) {
      console.warn('Failed to save session to storage:', error);
    }
  }

  async updateStoredSession(sessionData) {
    try {
      await chrome.storage.local.set({ [CONSTANTS.SESSION_STORAGE_KEY]: sessionData });
    } catch (error) {
      console.warn('Failed to update stored session:', error);
    }
  }

  async clearStoredSession() {
    try {
      await chrome.storage.local.remove([CONSTANTS.SESSION_STORAGE_KEY]);
      console.log('Stored session cleared');
    } catch (error) {
      console.warn('Failed to clear stored session:', error);
    }
  }

  async cleanupExpiredSessions() {
    try {
      const existingSession = await this.getStoredSession();
      if (existingSession && !this.isSessionValid(existingSession)) {
        await this.clearStoredSession();
        console.log('Expired session cleaned up');
      }
    } catch (error) {
      console.warn('Failed to cleanup expired sessions:', error);
    }
  }

  // === 配额管理方法 ===

  /**
   * 获取用户配额信息
   */
  async fetchUserQuota() {
    try {
      // 调用 API 获取最新配额信息
      const authData = await window.apiService.fetchAuthenticatedUser(this.sessionId);

      this.quotaInfo = {
        daily_limit: Number.MAX_SAFE_INTEGER,
        daily_used: authData.daily_used || 0,
        remaining: Number.MAX_SAFE_INTEGER,
        is_premium: true,
        authenticated: authData.authenticated || true,
        user_email: authData.user?.email || null,
        last_updated: Date.now(),
        date: new Date().toISOString().split('T')[0]
      };
      console.log('ClearTok 用户配额:', this.quotaInfo);

      // 保存到本地存储
      await this.saveQuotaInfo();
      // 根据配额更新 Step 2 按钮文案
      this.updateStartButtonLabel();
    } catch (error) {
      console.warn('获取配额信息失败，使用默认值:', error);
      // API 调用失败，使用默认配额
      this.quotaInfo = {
        daily_limit: Number.MAX_SAFE_INTEGER,
        daily_used: 0,
        remaining: Number.MAX_SAFE_INTEGER,
        is_premium: true,
        authenticated: false,
        user_email: null,
        last_updated: Date.now(),
        date: new Date().toISOString().split('T')[0]
      };
      await this.saveQuotaInfo();
      this.updateStartButtonLabel();
    }
  }

  /**
   * 根据配额/会员状态更新 Step2 按钮的文案
   */
  updateStartButtonLabel() {
    try {
      const btn = document.getElementById('startButton');
      if (!btn) return;
      const isPlus = !!this.quotaInfo?.is_premium;
      const remaining = Math.max(0, this.quotaInfo?.remaining ?? 0);
      if (isPlus) {
        btn.textContent = ClearTokUtils.getText('startButton') || '🧹 Start Removing Reposts';
        btn.disabled = false;
        return;
      }
      if (remaining <= 0) {
        btn.textContent = ClearTokUtils.getText('dailyLimitReachedButton') || (ClearTokUtils.getText('unlockPlusButton') || 'Unlock unlimited — Get Plus');
        btn.disabled = false; // 允许点击以跳转 premium
        return;
      }
      btn.textContent = ClearTokUtils.getText('startButton') || '🧹 Start Removing Reposts';
      btn.disabled = false;
    } catch (_) {}
  }

  /**
   * 获取存储的配额信息
   */
  async getStoredQuotaInfo() {
    try {
      const result = await chrome.storage.local.get(['quotaInfo']);
      return result.quotaInfo || null;
    } catch (error) {
      console.warn('Failed to get stored quota info:', error);
      return null;
    }
  }

  /**
   * 保存配额信息
   */
  async saveQuotaInfo() {
    try {
      await chrome.storage.local.set({ quotaInfo: this.quotaInfo });
    } catch (error) {
      console.warn('Failed to save quota info:', error);
    }
  }

  /**
   * 检查配额是否为今天的数据
   */
  isQuotaValidForToday(quotaInfo) {
    const today = new Date().toISOString().split('T')[0];
    return quotaInfo.date === today;
  }

  /**
   * 更新配额使用量
   * @param {number} count - 使用的数量
   */
  async updateQuotaUsage(count) {
    this.quotaInfo.daily_used += count;
    this.quotaInfo.remaining = Math.max(0, this.quotaInfo.daily_limit - this.quotaInfo.daily_used);
    await this.saveQuotaInfo();
    this.updateStartButtonLabel();
  }

  /**
   * 获取剩余配额
   */
  getRemainingQuota() {
    // 检查是否需要重置（跨天）
    const today = new Date().toISOString().split('T')[0];
    if (this.quotaInfo.date !== today) {
      // 新的一天，重置配额
      this.quotaInfo.date = today;
      this.quotaInfo.daily_used = 0;
      this.quotaInfo.remaining = this.quotaInfo.daily_limit;
      this.saveQuotaInfo();
    }
    return this.quotaInfo.remaining;
  }

  // === TikTok 登录检测 ===

  async openTikTok() {
    // 防止重复点击
    if (this.isOpeningTikTok) return;

    // 如果已经在 opening 或 checking 状态，不响应点击
    if (this.currentLoginStatus === 'opening' || this.currentLoginStatus === 'checking') {
      return;
    }
    if (this.currentLoginStatus === 'notLoggedIn') {
      this.recheckLoginStatus();
      return;
    }

    try {
      this.isOpeningTikTok = true;
      const tab = await chrome.tabs.create({ url: "https://www.tiktok.com/", active: true });
      this.currentTikTokTab = tab;
      this.updateLoginStatus('opening');
      setTimeout(async () => {
        // 使用新的消息服务
        await window.messageService.sendToBackground('CHECK_LOGIN_TAB', {
          tabId: tab.id
        });
        this.isOpeningTikTok = false;
      }, 4000);
    } catch (error) {
      console.log('Error opening TikTok:', error);
      this.updateLoginStatus('error');
      this.isOpeningTikTok = false;
    }
  }

  async checkTikTokLogin() {
    // 首先显示检测中状态
    this.updateLoginStatus('checking');

    try {
      const tabs = await chrome.tabs.query({ url: "*://www.tiktok.com/*" });
      if (tabs.length > 0) {
        this.currentTikTokTab = tabs[tabs.length - 1];
        // 使用新的消息服务
        await window.messageService.sendToBackground('CHECK_LOGIN_TAB', {
          tabId: tabs[tabs.length - 1].id
        });
      } else {
        // 延迟一下，让用户看到检测过程
        setTimeout(() => {
          this.updateLoginStatus('waiting');
        }, 1500);
      }
    } catch (error) {
      console.log('Error checking TikTok tabs:', error);
      setTimeout(() => {
        this.updateLoginStatus('waiting');
      }, 1500);
    }
  }

  updateLoginStatus(status) {
    if (this.currentLoginStatus === status) return;
    this.currentLoginStatus = status;

    const loginStatus = document.getElementById('loginStatus');
    const step1Card = document.getElementById('openTikTokStep');
    const step2Card = document.getElementById('step2Card');
    const startButton = document.getElementById('startButton');

    // 清除所有状态样式
    step1Card?.classList.remove('step-active', 'step-inactive', 'step-checking');
    step2Card?.classList.remove('step-active', 'step-inactive');

    if (loginStatus) {
      switch (status) {
        case 'loggedIn':
        case 'ready':
          // 已登录：Step1暗淡，Step2亮光
          step1Card?.classList.add('step-inactive');
          step2Card?.classList.add('step-active');
          startButton?.removeAttribute('disabled');
          loginStatus.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px;">
              <span class="status-indicator">✅</span>
              <span>${ClearTokUtils.getText('loginStatusLoggedIn')}</span>
            </div>
            <button class="recheck-button" id="recheckButton" title="${ClearTokUtils.getText('recheckLoginTitle')}">
              <svg class="recheck-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M23 4v6h-6"></path>
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
              </svg>
            </button>
          `;
          this.reattachRecheckListener();
          break;

        case 'notLoggedIn':
          // 未登录：Step1亮光，Step2暗淡
          step1Card?.classList.add('step-active');
          step2Card?.classList.add('step-inactive');
          startButton?.setAttribute('disabled', 'true');
          loginStatus.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px;">
              <span class="status-indicator">⚠️</span>
              <span style="color: var(--color-warning)">${ClearTokUtils.getText('loginStatusNotLoggedIn')}</span>
            </div>
            <button class="recheck-button" id="recheckButton" title="${ClearTokUtils.getText('recheckLoginTitle')}">
              <svg class="recheck-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M23 4v6h-6"></path>
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
              </svg>
            </button>
          `;
          this.reattachRecheckListener();
          break;

        case 'checking':
          // 检测中：Step1呼吸效果
          step1Card?.classList.add('step-checking');
          step2Card?.classList.add('step-inactive');
          startButton?.setAttribute('disabled', 'true');
          loginStatus.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px;">
              <span class="status-indicator">🔄</span>
              <span>${ClearTokUtils.getText('loginStatusChecking')}</span>
            </div>
            <button class="recheck-button spinning" id="recheckButton" title="${ClearTokUtils.getText('loginStatusChecking')}">
              <svg class="recheck-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M23 4v6h-6"></path>
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
              </svg>
            </button>
          `;
          this.reattachRecheckListener();
          break;

        case 'opening':
          step1Card?.classList.add('step-checking');
          step2Card?.classList.add('step-inactive');
          startButton?.setAttribute('disabled', 'true');
          loginStatus.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px;">
              <span class="status-indicator">🔄</span>
              <span>${ClearTokUtils.getText('loginStatusOpening')}</span>
            </div>
            <button class="recheck-button" id="recheckButton" title="${ClearTokUtils.getText('recheckLoginTitle')}">
              <svg class="recheck-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M23 4v6h-6"></path>
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
              </svg>
            </button>
          `;
          this.reattachRecheckListener();
          break;

        case 'error':
          step1Card?.classList.add('step-active');
          step2Card?.classList.add('step-inactive');
          startButton?.setAttribute('disabled', 'true');
          loginStatus.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px;">
              <span class="status-indicator">❌</span>
              <span>${ClearTokUtils.getText('loginStatusError')}</span>
            </div>
            <button class="recheck-button" id="recheckButton" title="${ClearTokUtils.getText('recheckLoginTitle')}">
              <svg class="recheck-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M23 4v6h-6"></path>
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
              </svg>
            </button>
          `;
          this.reattachRecheckListener();
          break;

        default:
          // 默认状态：Step1亮光提示点击
          step1Card?.classList.add('step-active');
          step2Card?.classList.add('step-inactive');
          startButton?.setAttribute('disabled', 'true');
          loginStatus.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px;">
              <span class="status-indicator">👆</span>
              <span>${ClearTokUtils.getText('loginStatusDefault')}</span>
            </div>
            <button class="recheck-button" id="recheckButton" title="Re-check login status">
              <svg class="recheck-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M23 4v6h-6"></path>
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
              </svg>
            </button>
          `;
          this.reattachRecheckListener();
      }
    }
  }

  // 重新绑定reCheck按钮事件
  reattachRecheckListener() {
    setTimeout(() => {
      const recheckButton = document.getElementById('recheckButton');
      if (recheckButton) {
        recheckButton.addEventListener('click', (e) => {
          e.stopPropagation();
          this.recheckLoginStatus();
        });
      }
    }, 100);
  }

  // 重新检查登录状态
  async recheckLoginStatus() {
    this.updateLoginStatus('checking');

    try {
      const tabs = await chrome.tabs.query({ url: "*://www.tiktok.com/*" });
      if (tabs.length > 0) {
        this.currentTikTokTab = tabs[tabs.length - 1];
        // 使用新的消息服务
        await window.messageService.sendToBackground('CHECK_LOGIN_TAB', {
          tabId: tabs[tabs.length - 1].id
        });
      } else {
        // 没有TikTok标签，显示需要打开
        setTimeout(() => {
          this.updateLoginStatus('waiting');
        }, 1000);
      }
    } catch (error) {
      console.log('Error rechecking login:', error);
      setTimeout(() => {
        this.updateLoginStatus('error');
      }, 1000);
    }
  }

  // === 账户认证管理 ===

  async initializeFooterAuth() {
    this.footerAuthElement = document.getElementById('footerAuth');
    if (!this.footerAuthElement) return;

    // 先获取配额信息（如果还没有）
    if (!this.quotaInfo.last_updated) {
      await this.fetchUserQuota();
    }

    this.renderFooterAuthState('loading');
    this.loadAccountInfo().catch(() => {});

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        this.loadAccountInfo(true).catch(() => {});
      }
    });
  }

  renderFooterAuthState(state) {
    if (!this.footerAuthElement) return;

    let markup = '';

    switch (state) {
      case 'loading':
        markup = `
          <span class="footer-auth-state" title="Loading…">
            <span class="footer-auth-spinner"></span>
          </span>
        `;
        break;
      case 'loggedIn': {
        const profile = this.accountInfo || {};
        const fallbackName = profile.email ? profile.email.split('@')[0] : 'User';
        const displayName = ClearTokUtils.escapeHtml(profile.name || fallbackName || 'User');
        let avatarHtml;
        if (profile.avatar_url) {
          avatarHtml = `<img src="${ClearTokUtils.escapeHtml(profile.avatar_url)}" alt="${displayName}" class="footer-avatar" />`;
        } else {
          const initial = displayName.trim().charAt(0).toUpperCase() || 'U';
          avatarHtml = `<div class="footer-avatar placeholder">${ClearTokUtils.escapeHtml(initial)}</div>`;
        }
        const subtitleBase = profile.email ? ClearTokUtils.escapeHtml(profile.email) : displayName;
        const isPremium = !!this.quotaInfo?.is_premium;
        const planText = isPremium ? 'Plus — unlimited' : `Free — ${Math.max(0, this.quotaInfo.remaining || 0)} left today`;
        const titleText = `${subtitleBase} — ${planText}`;

        // Only show avatar; name/quota shown in tooltip (title)
        const avatarWithBadge = `
          <span class="footer-avatar-wrapper">
            ${avatarHtml}
            ${isPremium ? `<span class="footer-avatar-badge" aria-label="Plus">PRO</span>` : ''}
          </span>
        `;
        markup = `
          <button class="footer-auth-button" id="footerAccountProfile" type="button" title="${titleText}">
            ${avatarWithBadge}
          </button>
        `;
        break;
      }
      case 'error':
        markup = `
          <span class="footer-auth-state" title="Retrying…">
            <span class="footer-auth-spinner"></span>
          </span>
        `;
        break;
      case 'loggedOut':
      default:
        markup = `
          <button class="footer-action-btn footer-auth-link" id="footerLoginButton" type="button" title="Sign in to sync">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
              <circle cx="12" cy="7" r="4"></circle>
            </svg>
          </button>
        `;
        break;
    }

    this.footerAuthElement.innerHTML = markup;
    this.attachFooterAuthHandlers();
  }

  attachFooterAuthHandlers() {
    if (!this.footerAuthElement) return;

    const loginBtn = this.footerAuthElement.querySelector('#footerLoginButton');
    if (loginBtn) {
      loginBtn.addEventListener('click', () => {
        this.openAccountPortal();
      });
    }
    const retryBtn = this.footerAuthElement.querySelector('#footerAuthRetry');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => {
        this.openAccountPortal();
      });
    }
    const profileBtn = this.footerAuthElement.querySelector('#footerAccountProfile');
    if (profileBtn) {
      profileBtn.addEventListener('click', () => {
        this.openAccountPortal();
      });
    }
  }

  async loadAccountInfo(isPassive = false) {
    if (!window.apiService?.fetchAuthenticatedUser) {
      this.renderFooterAuthState('loggedOut');
      return;
    }

    if (!isPassive) {
      this.renderFooterAuthState('loading');
    }

    try {
      const authData = await window.apiService.fetchAuthenticatedUser(this.sessionId);
      if (authData && authData.authenticated && authData.user && (authData.user.email || authData.user.name)) {
        this.accountInfo = authData.user;
        this.renderFooterAuthState('loggedIn');
        this.stopAccountPolling();
        // 登录成功后，刷新一次配额信息并更新按钮
        try {
          await this.fetchUserQuota();
          this.updateStartButtonLabel();
        } catch (_) {}
      } else {
        this.accountInfo = null;
        if (this.accountPollingTimer && isPassive) {
          this.renderFooterAuthState('loading');
        } else {
          this.renderFooterAuthState('loggedOut');
        }
        // 未登录场景也尝试刷新配额（基于 session_id 的匿名额度）
        try {
          await this.fetchUserQuota();
          this.updateStartButtonLabel();
        } catch (_) {}
      }
    } catch (error) {
      console.warn('Failed to load account info:', error);
      if (!isPassive) {
        this.renderFooterAuthState('error');
      }
    }
  }

  openAccountPortal() {
    try {
      let url = CONSTANTS.LOGIN_PORTAL_URL;
      try {
        const u = new URL(url);
        if (this.sessionId) u.searchParams.set('session_id', this.sessionId);
        url = u.toString();
      } catch (_) { /* fallback to raw url */ }
      chrome.tabs.create({ url, active: true });
      this.renderFooterAuthState('loading');
      this.startAccountPolling();
    } catch (error) {
      console.warn('Failed to open login portal:', error);
    }
  }

  startAccountPolling() {
    if (this.accountPollingTimer) return;
    this.accountPollingAttempts = 0;
    this.loadAccountInfo(true).catch(() => {});
    this.accountPollingTimer = setInterval(async () => {
      this.accountPollingAttempts += 1;
      await this.loadAccountInfo(true);
      if (this.accountInfo || this.accountPollingAttempts >= CONSTANTS.MAX_ACCOUNT_POLLING_ATTEMPTS) {
        this.stopAccountPolling();
        if (!this.accountInfo) {
          this.renderFooterAuthState('loggedOut');
        }
      }
    }, 5000);
  }

  stopAccountPolling() {
    if (this.accountPollingTimer) {
      clearInterval(this.accountPollingTimer);
      this.accountPollingTimer = null;
      this.accountPollingAttempts = 0;
    }
  }
}

// 导出类
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SessionAuthManager;
} else {
  window.SessionAuthManager = SessionAuthManager;
}
