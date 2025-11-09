// /modules/ui.js

class UIManager {
  /**
   * @param {ConfigManager} config - 配置模块的实例
   */
  constructor(config) {
    this.config = config;
  }

  /**
   * 查找单个元素，支持多个选择器
   * @param {string} selectorKey - 在config中定义的键
   * @param {Element} parent - 父元素，默认为 document
   * @returns {Element|null}
   */
  findElement(selectorKey, parent = document) {
    const selectors = this.config.get(selectorKey);
    if (!selectors) return null;

    const selectorList = Array.isArray(selectors) ? selectors : [selectors];
    for (const selector of selectorList) {
      try {
        const element = parent.querySelector(selector);
        if (element) return element;
      } catch (error) {
        console.error(`[ClearTok] Invalid selector: "${selector}" from key "${selectorKey}"`, error);
      }
    }
    return null;
  }

  /**
   * 查找所有匹配的元素
   * @param {string} selectorKey
   * @param {Element} parent
   * @returns {NodeListOf<Element>}
   */
  findAllElements(selectorKey, parent = document) {
    const selectors = this.config.get(selectorKey);
    if (!selectors) return document.querySelectorAll(''); // 返回空的NodeList
    const selectorString = Array.isArray(selectors) ? selectors.join(', ') : selectors;
    return parent.querySelectorAll(selectorString);
  }


  /**
   * 通过文本内容查找元素
   * @param {string} selectorKey 
   * @param {string} text 
   * @param {boolean} caseSensitive 
   * @returns {Element|null}
   */
  findByText(selectorKey, text, caseSensitive = false) {
    const elements = this.findAllElements(selectorKey);
    const targetText = caseSensitive ? text : text.toLowerCase();

    for (const element of elements) {
      const elementText = element.textContent?.trim() || '';
      const comparableText = caseSensitive ? elementText : elementText.toLowerCase();
      if (comparableText.includes(targetText)) {
        return element;
      }
    }
    return null;
  }

  /**
   * 等待元素出现
   * @param {string} selectorKey
   * @param {number} timeout
   * @returns {Promise<Element>}
   */
  // 超时时原来是 reject(...) → 改成发送上报消息后 resolve(null)
  async waitForElement(selectorKey, timeout = 10000) {
    return new Promise((resolve) => {
      const interval = 200;
      const endTime = Date.now() + timeout;

      const check = () => {
        const element = this.findElement(selectorKey);
        if (element) {
          resolve(element);
        } else if (Date.now() > endTime) {
          try {
            // 使用 MessageBus 发送消息到 background
            if (window.MessageBus) {
              const messageBus = new window.MessageBus();
              messageBus.send('background', 'UI_WAIT_TIMEOUT', {
                selectorKey,
                timeout,
                url: window.location.href
              }).catch(() => {});
            }
          } catch (_) { }
          resolve(null);
        } else {
          setTimeout(check, interval);
        }
      };
      check();
    });
  }

  /**
   * 点击一个元素
   * @param {string} selectorKey
   * @returns {Promise<boolean>} 是否成功
   */
  async click(selectorKey, timeout = 5000) {
    try {
      const element = await this.waitForElement(selectorKey, timeout);
      if (element) {
        element.click();
        return true;
      }
    } catch (error) {
      console.error(`[ClearTok] Failed to click element with key "${selectorKey}":`, error);
    }
    return false;
  }

  /**
   * 异步等待
   * @param {number} ms - 毫秒
   */
  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 获取元素的文本内容
   * @param {string} selectorKey
   * @returns {string}
   */
  getText(selectorKey) {
    const element = this.findElement(selectorKey);
    return element ? element.textContent.trim() : '';
  }

  /**
   * 自动滚动页面到底部以加载所有内容
   * 仅在两次时机触发回调：
   * 1) 第一次检测到内容数量（首次滚动后）
   * 2) 最终完成时
   * @param {function(number)} onProgress - 回调函数（最多回调两次：首次与最终）
   * @returns {Promise<number>} - 返回找到的元素总数
   */
  async autoScrollToBottom(itemSelectorKey, onProgress, maxItems = Infinity) {
    return new Promise(async (resolve) => {
      // 取消 1000 条硬性上限，尊重传入的 maxItems（可能为 Number.MAX_SAFE_INTEGER）
      const cappedMax = maxItems ?? Infinity;

      let lastItemsCount = 0;
      let lastHeight = 0;
      let noChangeCount = 0;
      // 对大配额/长列表容忍更多空转周期，避免过早结束
      let maxNoChangeCount = (isFinite(cappedMax) && cappedMax > 200) ? 6 : 3;
      let finished = false;
      let firstProgressReported = false;

      const finalize = () => {
        if (finished) return;
        finished = true;
        clearInterval(scrollInterval);
        clearTimeout(timeoutId);
        const finalItems = this.findAllElements(itemSelectorKey);
        if (onProgress) onProgress(finalItems.length, true);
        resolve(finalItems.length);
      };

      // 更短的轮询以加快加载（风险：更频繁触发懒加载/防护）
      const POLL_INTERVAL = 800; // ms
      const scrollInterval = setInterval(() => {
        // 触发小幅向上抖动再触底，帮助虚拟列表加载
        try {
          const jitter = Math.floor(Math.random() * 101); // 0~100
          if (jitter > 0) window.scrollBy(0, -jitter);
        } catch (_) {}
        setTimeout(() => {
          try { window.scrollTo(0, document.body.scrollHeight); } catch (_) {}
        }, 30);

        const currentItems = this.findAllElements(itemSelectorKey);
        const currentCount = currentItems.length;

        // 首次滚动回调
        if (!firstProgressReported) {
          firstProgressReported = true;
          if (onProgress) onProgress(currentCount, false);
        }

        // 每次检测到数量增加都回调一次，提供更实时的进度反馈
        if (currentCount > lastItemsCount) {
          lastItemsCount = currentCount;
          noChangeCount = 0;
          if (onProgress) onProgress(currentCount, false);
        } else {
          noChangeCount++;
        }

        // 如果超过了请求的最大条数 + 10，立即结束
        if (isFinite(cappedMax) && currentCount >= cappedMax + 10) {
          finalize();
          return;
        }

        const currentHeight = document.body.scrollHeight;
        const heightChanged = currentHeight !== lastHeight;
        if (heightChanged) {
          lastHeight = currentHeight;
          // 视为有变化，重置空转计数
          noChangeCount = 0;
        }

        if (noChangeCount >= maxNoChangeCount) {
          finalize();
        }
      }, POLL_INTERVAL);

      // 增加超时时间以支持更长列表的加载
      const timeoutId = setTimeout(() => {
        console.warn('[YumiRem] Auto-scroll timed out.');
        finalize();
      }, 300000); // 5 minutes
    });
  }
}
