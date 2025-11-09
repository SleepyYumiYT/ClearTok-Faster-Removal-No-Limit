/**
 * 模态框功能模块 - 评分、语言切换、分享卡片
 */

class ModalsManager {
  constructor() {
    // 评分相关
    this.selectedRating = 0;
    this.ratingLabels = ['Bad', 'Okay', 'Good', 'Great', 'Love it!'];

    // 分享相关
    this.shareTaglines = null;
    this._lastTaglineIndex = -1;
  }

  // === 初始化方法 ===

  initializeModals() {
    this.initializeRatingModal();
    this.initializeLanguageSelector();
    this.initializeShareModal();
  }

  // === 评分模态框 ===

  initializeRatingModal() {
    const stars = document.querySelectorAll('.star');
    stars.forEach((star, index) => {
      star.addEventListener('click', () => this.selectRating(index + 1));
      star.addEventListener('mouseenter', () => this.hoverRating(index + 1));
    });

    const labels = document.querySelectorAll('.rating-label');
    labels.forEach((label, index) => {
      label.addEventListener('click', () => this.selectRating(index + 1));
    });

    document.getElementById('ratingModal')?.addEventListener('click', (e) => {
      if (e.target.classList.contains('modal-overlay')) this.closeRatingModal();
    });

    document.querySelector('.stars-container')?.addEventListener('mouseleave', () => {
      this.updateStarDisplay(this.selectedRating);
    });

    // 添加反馈输入框的字符计数功能
    const feedbackInput = document.getElementById('feedbackInput');
    const feedbackCharCount = document.getElementById('feedbackCharCount');
    if (feedbackInput && feedbackCharCount) {
      feedbackInput.addEventListener('input', () => {
        const currentLength = feedbackInput.value.length;
        feedbackCharCount.textContent = currentLength;

        // 更新字符计数颜色
        if (currentLength > 450) {
          feedbackCharCount.style.color = 'var(--color-warning)';
        } else {
          feedbackCharCount.style.color = 'var(--color-text-secondary)';
        }
      });
    }
  }

  showRatingModal() {
    const modal = document.getElementById('ratingModal');
    if (modal) {
      modal.classList.remove('hidden');
      this.resetRatingModal();
    }
  }

  closeRatingModal() {
    const modal = document.getElementById('ratingModal');
    if (modal) modal.classList.add('hidden');
  }

  resetRatingModal() {
    this.selectedRating = 0;
    this.updateStarDisplay(0);
    this.updateRatingMessage();
    this.updateActionButton();
    this.updateFeedbackSection();

    // 重置反馈输入框
    const feedbackInput = document.getElementById('feedbackInput');
    const feedbackCharCount = document.getElementById('feedbackCharCount');
    if (feedbackInput) {
      feedbackInput.value = '';
    }
    if (feedbackCharCount) {
      feedbackCharCount.textContent = '0';
      feedbackCharCount.style.color = 'var(--color-text-secondary)';
    }
  }

  selectRating(rating) {
    this.selectedRating = rating;
    this.updateStarDisplay(rating);
    this.updateRatingMessage();
    this.updateActionButton();
    this.updateFeedbackSection();
  }

  hoverRating(rating) {
    if (this.selectedRating === 0) this.updateStarDisplay(rating);
  }

  updateStarDisplay(rating) {
    const stars = document.querySelectorAll('.star');
    const labels = document.querySelectorAll('.rating-label');
    stars.forEach((star, index) => star.classList.toggle('active', index < rating));
    labels.forEach((label, index) => label.classList.toggle('active', index === rating - 1));
  }

  updateRatingMessage() {
    const messageElement = document.querySelector('.rating-message p');
    if (messageElement) {
      if (this.selectedRating === 0) messageElement.textContent = ClearTokUtils.getText('pleaseRateUs');
      else messageElement.textContent = this.ratingLabels[this.selectedRating - 1] + '!';
    }
  }

  updateActionButton() {
    const actionButton = document.getElementById('rateUsActionButton');
    const feedbackButton = document.getElementById('submitFeedbackButton');

    if (actionButton) {
      actionButton.classList.toggle('active', this.selectedRating > 0);
      // 当评分≤3时，隐藏评分按钮，显示反馈按钮
      actionButton.classList.toggle('hidden', this.selectedRating > 0 && this.selectedRating <= 3);
    }

    if (feedbackButton) {
      // 只有当评分≤3时才显示反馈提交按钮
      feedbackButton.classList.toggle('hidden', this.selectedRating === 0 || this.selectedRating > 3);
      feedbackButton.classList.toggle('active', this.selectedRating > 0 && this.selectedRating <= 3);
    }
  }

  updateFeedbackSection() {
    const feedbackSection = document.getElementById('feedbackSection');
    if (feedbackSection) {
      // 评分≤3时显示反馈区域
      if (this.selectedRating > 0 && this.selectedRating <= 3) {
        feedbackSection.classList.remove('hidden');
      } else {
        feedbackSection.classList.add('hidden');
      }
    }
  }

  async handleFeedbackSubmit(sessionAuth) {
    if (this.selectedRating === 0 || this.selectedRating > 3) {
      return;
    }

    const feedbackInput = document.getElementById('feedbackInput');
    const feedbackText = feedbackInput ? feedbackInput.value.trim() : '';

    // 记录评分和反馈
    this.recordRating(this.selectedRating, feedbackText);

    // 发送反馈到后端
    try {
      if (sessionAuth.sessionId && window.apiService) {
        await window.apiService.submitFeedback(sessionAuth.sessionId, {
          rating: this.selectedRating,
          feedback: feedbackText
        });
      }
    } catch (error) {
      console.warn('Failed to submit feedback to backend:', error);
    }

    // 关闭模态框并显示感谢消息
    this.closeRatingModal();
    ClearTokUtils.showNotification(ClearTokUtils.getText('thankYouForFeedback', { rating: this.selectedRating }), 'success');
  }

  async handleRatingAction(sessionAuth) {
    if (this.selectedRating === 0) return;

    // 记录评分
    this.recordRating(this.selectedRating);

    // 发送反馈到后端（对于高分用户，反馈为空）
    try {
      if (sessionAuth.sessionId && window.apiService) {
        await window.apiService.submitFeedback(sessionAuth.sessionId, {
          rating: this.selectedRating,
          feedback: '' // 高分用户的反馈为空
        });
      }
    } catch (error) {
      console.warn('Failed to submit feedback to backend:', error);
    }

    // 只有高分（4-5星）才跳转到商店页面
    if (this.selectedRating >= 4) {
      const storeUrl = ClearTokUtils.getStoreUrl();
      chrome.tabs.create({ url: storeUrl });
    }

    this.closeRatingModal();
    ClearTokUtils.showNotification(ClearTokUtils.getText('thankYouForRating'), 'success');
  }

  recordRating(rating, feedback = '') {
    console.log('User rated:', rating, 'stars', feedback ? 'with feedback' : 'without feedback');
    try {
      chrome.storage.local.set({
        'userRated': true,
        'ratingValue': rating,
        'ratingFeedback': feedback,
        'ratingDate': Date.now()
      });
    } catch (error) {
      console.warn('Failed to save rating:', error);
    }
  }

  // === 语言选择器 ===

  initializeLanguageSelector() {
    // 语言选择器事件监听器在主文件中设置
  }

  showLanguageSelector() {
    const languageModal = document.getElementById('languageModal');
    if (languageModal) {
      languageModal.classList.remove('hidden');
      document.body.style.overflow = 'hidden';
    }
  }

  hideLanguageSelector() {
    const languageModal = document.getElementById('languageModal');
    if (languageModal) {
      languageModal.classList.add('hidden');
      document.body.style.overflow = '';
    }
  }

  selectLanguage(langCode) {
    // Hide checkmarks from all options
    document.querySelectorAll('.language-option .checkmark').forEach(checkmark => {
      checkmark.classList.add('hidden');
    });

    // Show checkmark for selected language
    const selectedOption = document.querySelector(`[data-lang="${langCode}"]`);
    if (selectedOption) {
      const checkmark = selectedOption.querySelector('.checkmark');
      if (checkmark) {
        checkmark.classList.remove('hidden');
      }

      // Update the current language display in footer
      const flag = selectedOption.querySelector('.flag').textContent;
      const langName = selectedOption.querySelector('.lang-name').textContent;
      const currentLangSpan = document.querySelector('.current-lang');
      if (currentLangSpan) {
        // Extract language code for display (first 2 letters)
        const shortCode = langCode.includes('_') ? langCode.split('_')[0] : langCode;
        currentLangSpan.innerHTML = `${flag} ${shortCode.toUpperCase()}`;
      }

      // Update main footer language display
      const mainLangBtn = document.querySelector('#languageSelectorBtn .action-text');
      if (mainLangBtn) {
        mainLangBtn.textContent = langName;
      }

      const mainLangFlag = document.querySelector('#languageSelectorBtn .flag-icon');
      if (mainLangFlag) {
        mainLangFlag.textContent = flag;
      }
    }

    // Change the language using i18n if available
    if (window.i18n && window.i18n.changeLanguage) {
      window.i18n.changeLanguage(langCode);
    }

    // Close the modal after selection
    this.hideLanguageSelector();
  }

  // === 分享卡片功能 ===

  initializeShareModal() {
    // 分享卡片事件监听器在主文件中设置
    this.initShareTaglines();
  }

  initShareTaglines() {
    const tags = [];
    try {
      for (let i = 1; i <= 15; i++) {
        const key = `share_tagline_${i}`;
        const msg = (window.i18n && window.i18n.getMessage) ? window.i18n.getMessage(key) : (chrome?.i18n?.getMessage ? chrome.i18n.getMessage(key) : '');
        if (!msg) break;
        tags.push(msg);
      }
    } catch(_) {}
    if (tags.length > 0) {
      this.shareTaglines = tags;
    } else {
      this.shareTaglines = [
        'I have deleted all my reposts so that I can now start over and leave everything old behind',
        "Deleting all reposts so that He Can't know what i'm doing and feeling..!!🕊️❤️‍🩹✨",
        'delete all my repost couse he will never cares abt me',
        'remove all my repost to start a new life',
        'deleted all my reposts so no you cant figure out who i am',
        'Archiving my past to make room for the future',
        'Soft reset: clearing reposts, keeping the lessons',
        'Wiping the slate clean, one repost at a time',
        'Goodbye, yesterday. Hello, version 2.0 of me',
        'Quietly rebuilding—no spoilers this time',
        'No breadcrumbs left. If you know, you know',
        'Moved on. The algorithm can catch up later',
        'Deleting echoes. Keeping the voice',
        'Less noise, more me',
        'Rewriting the timeline, starting here',
      ];
    }
    this._lastTaglineIndex = -1;
  }

  getRandomTagline() {
    if (!this.shareTaglines || this.shareTaglines.length === 0) return '';
    let idx = Math.floor(Math.random() * this.shareTaglines.length);
    if (this._lastTaglineIndex === idx && this.shareTaglines.length > 1) {
      idx = (idx + 1) % this.shareTaglines.length;
    }
    this._lastTaglineIndex = idx;
    return this.shareTaglines[idx];
  }

  shuffleTagline() {
    if (!this.shareTaglines) this.initShareTaglines();
    const input = document.getElementById('shareTaglineInput');
    if (!input) return;
    input.value = this.getRandomTagline();
    this.updateSharePreview();
  }

  showShareModal() {
    const modal = document.getElementById('shareModal');
    if (!modal) return;
    modal.classList.remove('hidden');
    // Default to 9:16 preview
    const preview = document.getElementById('sharePreviewCanvas');
    if (preview) {
      preview.width = 324; preview.height = 576;
    }
    // Initialize default taglines and set a random one on open if input empty
    if (!this.shareTaglines) this.initShareTaglines();
    const input = document.getElementById('shareTaglineInput');
    if (input && !input.value.trim()) {
      input.value = this.getRandomTagline();
    }
    this.updateSharePreview();
  }

  closeShareModal() {
    const modal = document.getElementById('shareModal');
    if (modal) modal.classList.add('hidden');
  }

  updateSharePreview(tikTokUsername = null) {
    const preview = document.getElementById('sharePreviewCanvas');
    if (!preview) return;
    preview.width = 324; preview.height = 576;
    const tagline = document.getElementById('shareTaglineInput')?.value || '';
    this.renderShareCardToCanvas(preview, {
      width: preview.width,
      height: preview.height,
      username: tikTokUsername,
      tagline,
    });
  }

  async saveShareCard(tikTokUsername = null) {
    const tagline = document.getElementById('shareTaglineInput')?.value || '';
    const width = 1080;
    const height = 1920;
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    await this.renderShareCardToCanvas(canvas, {
      width, height, username: tikTokUsername, tagline,
    });
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const ts = new Date();
      const name = `cleartok_share_${ts.getFullYear()}${String(ts.getMonth()+1).padStart(2,'0')}${String(ts.getDate()).padStart(2,'0')}.png`;
      a.href = url; a.download = name; document.body.appendChild(a); a.click();
      a.remove(); URL.revokeObjectURL(url);
    }, 'image/png', 0.95);
    ClearTokUtils.showNotification(ClearTokUtils.getText('notificationShareSaved') || 'Saved share card', 'success');
  }

  copyShareCaption(tikTokUsername = null) {
    const tagline = document.getElementById('shareTaglineInput')?.value || '';
    const caption = this.generateShareCaption(tagline, tikTokUsername);
    ClearTokUtils.copyToClipboard(caption, () => {
      ClearTokUtils.showNotification(ClearTokUtils.getText('notificationCaptionCopied') || 'Caption copied', 'success');
    }, () => {
      ClearTokUtils.showNotification(ClearTokUtils.getText('notificationCaptionCopyFailed') || 'Failed to copy', 'error');
    });
  }

  generateShareCaption(tagline = '', tikTokUsername = null) {
    const user = tikTokUsername ? `@${tikTokUsername}` : '';
    const head = tagline || 'Deleted all my reposts to start fresh.';
    const by = user ? `\n— ${user}` : '';
    return `${head}${by}\n#ClearTok #TikTokCleanup #RepostRemover\nhttps://tiktokrepostremover.com`;
  }

  async renderShareCardToCanvas(canvas, opts = {}) {
    const ctx = canvas.getContext('2d');
    const { width, height, username, tagline = '' } = opts;
    // Read theme accents
    const cs = getComputedStyle(document.documentElement);
    const accent = cs.getPropertyValue('--color-accent').trim() || '#FE2C55';
    const accentAlt = cs.getPropertyValue('--color-accent-alt').trim() || '#00F2EA';

    // Background gradient
    const bgGrad = ctx.createLinearGradient(0, 0, width, height);
    bgGrad.addColorStop(0, '#07090f');
    bgGrad.addColorStop(0.45, '#121522');
    bgGrad.addColorStop(1, '#0b0f1a');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    // Subtle grid
    ctx.save();
    ctx.globalAlpha = 0.08;
    ctx.strokeStyle = '#00f2ea';
    ctx.lineWidth = 1;
    const step = Math.floor(Math.min(width, height) / 24);
    for (let x = 0; x <= width; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); }
    for (let y = 0; y <= height; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }
    ctx.restore();

    // Angular neon band
    ctx.save();
    const band = ctx.createLinearGradient(0, 0, width, 0);
    band.addColorStop(0, accent);
    band.addColorStop(1, accentAlt);
    ctx.fillStyle = band;
    ctx.globalAlpha = 0.12;
    const slope = height * 0.25;
    ctx.beginPath();
    ctx.moveTo(-slope, height * 0.15);
    ctx.lineTo(width, height * 0.45);
    ctx.lineTo(width + slope, height * 0.6);
    ctx.lineTo(0, height * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Center tagline elegantly
    if (tagline) {
      ctx.save();
      const boxX = Math.floor(width*0.1);
      const boxW = Math.floor(width*0.8);
      const centerY = Math.floor(height*0.5);
      const lines = this.wrapText(ctx, tagline, `600 ${Math.floor(width*0.05)}px system-ui, -apple-system, Roboto, sans-serif`, boxW);
      // Background soft panel for readability
      ctx.fillStyle = 'rgba(3, 8, 12, 0.5)';
      const totalH = lines.length * Math.floor(width*0.07) + Math.floor(width*0.06);
      const boxY = centerY - Math.floor(totalH/2);
      this.roundRect(ctx, boxX - Math.floor(width*0.02), boxY - Math.floor(width*0.02), boxW + Math.floor(width*0.04), totalH + Math.floor(width*0.04), Math.floor(width*0.03));
      ctx.fill();
      // Text gradient
      const tg = ctx.createLinearGradient(boxX, boxY, boxX + boxW, boxY);
      tg.addColorStop(0, '#e6faff'); tg.addColorStop(1, accentAlt);
      ctx.fillStyle = tg;
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.shadowColor = accentAlt; ctx.shadowBlur = Math.max(6, Math.floor(width*0.008));
      ctx.font = `600 ${Math.floor(width*0.05)}px system-ui, -apple-system, Roboto, sans-serif`;
      let y = boxY + Math.floor(width*0.03);
      const lh = Math.floor(width*0.07);
      lines.forEach(line => { ctx.fillText(line, boxX, y); y += lh; });
      ctx.restore();
    }

    // Footer branding
    ctx.save();
    const brandY = Math.floor(height*0.88);
    // Logo image
    try {
      let logo = await this.loadImageSafe(typeof chrome !== 'undefined' && chrome.runtime ? chrome.runtime.getURL('icon.png') : null);
      if (!logo) logo = await this.loadImageSafe('icon.png');
      if (logo) {
        const size = Math.floor(width*0.065);
        ctx.globalAlpha = 0.95;
        ctx.drawImage(logo, Math.floor(width*0.08), brandY, size, size);
      }
    } catch(_){}
    ctx.globalAlpha = 1;
    ctx.font = `700 ${Math.floor(width*0.045)}px system-ui, -apple-system, Roboto, sans-serif`;
    const grad = ctx.createLinearGradient(0, brandY, width*0.2, brandY);
    grad.addColorStop(0, accent);
    grad.addColorStop(1, accentAlt);
    ctx.fillStyle = grad;
    ctx.fillText('ClearTok', Math.floor(width*0.16), brandY + Math.floor(width*0.02));
    ctx.font = `400 ${Math.floor(width*0.03)}px system-ui, -apple-system, Roboto, sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText('tiktokrepostremover.com', Math.floor(width*0.16), brandY + Math.floor(width*0.08));
    ctx.restore();

    // Scanline overlay
    ctx.save();
    const scanH = Math.max(2, Math.floor(height/240));
    for (let y = 0; y < height; y += scanH*4) {
      ctx.fillStyle = 'rgba(0, 242, 234, 0.06)';
      ctx.fillRect(0, y, width, scanH);
    }
    ctx.restore();
  }

  // 辅助方法
  roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w/2, h/2);
    ctx.beginPath();
    ctx.moveTo(x+rr, y);
    ctx.arcTo(x+w, y, x+w, y+h, rr);
    ctx.arcTo(x+w, y+h, x, y+h, rr);
    ctx.arcTo(x, y+h, x, y, rr);
    ctx.arcTo(x, y, x+w, y, rr);
    ctx.closePath();
  }

  loadImageSafe(src) {
    return new Promise(resolve => {
      if (!src) return resolve(null);
      const img = new Image(); img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  wrapText(ctx, text, font, maxWidth) {
    ctx.save();
    ctx.font = font;
    const words = text.split(/\s+/);
    const lines = [];
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width <= maxWidth) {
        line = test;
      } else {
        if (line) lines.push(line);
        line = w;
      }
    }
    if (line) lines.push(line);
    ctx.restore();
    return lines.slice(0, 6);
  }
}

// 导出类
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ModalsManager;
} else {
  window.ModalsManager = ModalsManager;
}