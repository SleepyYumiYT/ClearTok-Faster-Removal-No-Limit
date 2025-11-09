// /modules/workflow.js

class WorkflowManager {
    /**
     * @param {ConfigManager} config
     * @param {UIManager} ui
     * @param {StateStore} stateStore
     * @param {MessageBus} messageBus
     */
    constructor(config, ui, stateStore, messageBus) {
        this.config = config;
        this.ui = ui;
        this.stateStore = stateStore || window.clearTokStateStore;
        this.messageBus = messageBus || window.messageBus;
        // 每次滚动/扫描的批次大小（默认 100）
        this.batchSize = 100;
    }

    /**
     * 一个可以被暂停的、有感知能力的睡眠函数
     * @param {number} ms - 总计要等待的毫秒数
     */
    async pausableSleep(ms) {
        const step = 100; // 每100ms检查一次暂停状态
        let elapsed = 0;

        while (elapsed < ms) {
            // 核心：在每次"打盹"前，都检查暂停状态
            await this.checkPauseState();

            // 如果脚本被停止，则直接退出
            const state = await this.stateStore.getState();
            if (!state.process.isRunning) {
                return;
            }

            await this.ui.sleep(step); // 使用"愚笨"的短时睡眠
            elapsed += step;
        }
    }

    async reset() {
        await this.stateStore.reset();
        console.log('[ClearTok Workflow] Workflow state has been reset.');
    }

    /**
     * 主启动函数
     */
    async start() {
        const state = await this.stateStore.getState();

        if (state.process.isRunning) {
            return; // 进程已在运行，忽略重复请求
        }

        // 启动处理流程 - 不传递 tabId，使用 background 已设置的值
        await this.stateStore.startProcess();
        await this.messageBus.broadcast('STATUS_UPDATE', {
            status: 'Starting removal process...',
            statusKey: 'statusStarting'
        });

        // 激活黑客边框
        if (window.clearTokBorder) {
            window.clearTokBorder.create();
        }

        try {
            // 流程编排
            if (!await this.step_navigateToProfile()) return;
            if (!await this.step_switchToRepostsTabAndScroll()) return;

            const currentState = await this.stateStore.getState();
            if (currentState.stats.totalReposts === 0) {
                const duration = await this.stateStore.getDuration();
                await this.messageBus.broadcast('NO_REPOSTS_FOUND', { duration });
                await this.finishProcess('No reposts found to remove.');
                return;
            }
            if (!await this.step_openFirstVideo()) return;

            await this.step_processVideoQueue();

            await this.finishProcess('All reposts have been processed.');

            // 完成后自动导航到repost页面查看结果
            await this.step_navigateToRepostsTab();

        } catch (error) {
            await this.handleError('An unexpected error occurred in the main workflow.', error);
        }
    }

    /**
     * 执行初始检查，例如登录状态
     */
    async runInitialChecks() {
        try {
            const profileLink = this.ui.findElement('loginStatus.profileLink');
            if (!profileLink || !profileLink.getAttribute('href')?.includes('/@')) {
                await this.messageBus.broadcast('LOGIN_STATUS_UPDATE', { isLoggedIn: false });
                return;
            }

            const href = profileLink.getAttribute('href');
            const usernamePart = href.split('/@')[1];
            const isLoggedIn = usernamePart && usernamePart.trim().length > 0;
            const hasAvatar = this.ui.findElement('loginStatus.avatarImage', profileLink) !== null;

            await this.messageBus.broadcast('LOGIN_STATUS_UPDATE', {
                isLoggedIn: isLoggedIn,
                username: isLoggedIn ? usernamePart.trim() : null,
                hasUserAvatar: hasAvatar,
            });
            console.log('[ClearTok] Login status checked:', { isLoggedIn });

        } catch (error) {
            console.error('[ClearTok] Error checking login status:', error);
            await this.messageBus.broadcast('LOGIN_STATUS_UPDATE', { isLoggedIn: false, error: error.message });
        }
    }

    // --- 工作流步骤 ---

    async step_navigateToProfile() {
        await this.messageBus.broadcast('STATUS_UPDATE', {
            status: 'Navigating to your profile...',
            statusKey: 'statusNavigatingProfile'
        });

        // 首先检查是否已经在个人主页
        const repostTab = await this.ui.waitForElement('navigation.repostTab', 2000);
        if (repostTab) {
            return true; // 已在个人主页
        }

        // 尝试点击 profile 按钮
        const profileButton = await this.ui.waitForElement('navigation.profileButton', 5000);
        if (!profileButton) {
            await this.handleError("Cannot find profile button. Please make sure you're on TikTok.com and logged in.");
            return false;
        }

        profileButton.click();

        // 等待个人主页关键元素准备就绪（例如 Reposts 标签出现）
        const repostTabAfterNav = await this.ui.waitForElement('navigation.repostTab', 7000);
        if (!repostTabAfterNav) {
            await this.handleError("Failed to navigate to profile page. Please try again.");
            return false;
        }

        return true;
    }

    async step_navigateToRepostsTab() {
        await this.messageBus.broadcast('STATUS_UPDATE', {
            status: 'Navigating to Reposts tab...',
            statusKey: 'statusNavigateToRepostsTab'
        });
        let repostTab = await this.ui.waitForElement('navigation.repostTab', 10000);
        if (!repostTab) {
            repostTab = this.ui.findByText('navigation.repostTabFallback', 'Reposts');
        }
        if (repostTab) {
            repostTab.click();
            // 等待 Reposts 列表元素出现（放宽等待时间以适配慢网速/慢渲染）
            await this.ui.waitForElement('video.containers', 15000);
            await this.messageBus.broadcast('STATUS_UPDATE', {
                status: 'On reposts tab, showing results.',
                statusKey: 'statusOnRepostsTab'
            });
            return true;
        }
        await this.messageBus.broadcast('STATUS_UPDATE', {
            status: 'Could not find Reposts tab.',
            statusKey: 'statusCouldNotFindRepostsTab'
        });
        return false;
    }

    async step_switchToRepostsTabAndScroll() {
        await this.messageBus.broadcast('STATUS_UPDATE', {
            status: 'Looking for Reposts tab...',
            statusKey: 'statusLookingForRepostsTab'
        });
        if (!await this.step_navigateToRepostsTab()) {
            await this.handleError("Could not find or click the 'Reposts' tab.");
            return false;
        }

        // 获取用户配额限制（但是限制单次扫描为 batchSize，以便分批加载）
        let maxItems = Infinity;
        try {
            const quotaInfo = await this.getQuotaInfo();
            const quotaRemaining = (typeof quotaInfo.remaining === 'number') ? quotaInfo.remaining : Infinity;
            maxItems = Math.min(quotaRemaining, this.batchSize);
            console.log(`[ClearTok] User quota remaining: ${maxItems}`);

            await this.messageBus.broadcast('STATUS_UPDATE', {
                status: `Scrolling to load initial reposts ...`,
                statusKey: 'statusScrolling'
            });
        } catch (error) {
            console.warn('[ClearTok] Failed to get quota info, using default:', error);
            maxItems = 100;
        }

        const totalFound = await this.ui.autoScrollToBottom('video.containers', async (progress, isFinal) => {
            await this.messageBus.broadcast('UPDATE_PROGRESS', {
                current: 0,
                total: progress,
                phase: isFinal ? 'final' : 'first',
                status: `Loaded ${progress} reposts so far...`,
                statusKey: 'statusLoadedSoFar',
                statusParams: { count: progress }
            });
        }, maxItems);

        await this.stateStore.setTotal(totalFound);
        const state = await this.stateStore.getState();
        await this.messageBus.broadcast('STATUS_UPDATE', {
            status: `Found ${state.stats.totalReposts} reposts.`,
            statusKey: 'statusFoundTotal',
            statusParams: { total: state.stats.totalReposts }
        });
        console.log(`[ClearTok] Found ${state.stats.totalReposts} total reposts.`);
        return true;
    }

    async step_openFirstVideo() {
        await this.messageBus.broadcast('STATUS_UPDATE', {
            status: 'Opening the first repost...',
            statusKey: 'statusOpeningFirstRepost'
        });
        // 打开第一条视频时也放宽等待时间
        const success = await this.ui.click('video.containers', 15000);
        if (!success) {
            await this.handleError("No reposted videos found on the page to click.");
            return false;
        }
        // 等待视频播放视图的关键按钮出现，替代固定等待
        await this.ui.waitForElement('video.repostButton', 7000);
        return true;
    }

    async step_processVideoQueue() {
        // 仅预加载少量（上一步滚动到的）数量用于展示；后续通过"下一条"推进，动态增长总数
        let currentIndex = 0;
        let removedCount = 0;

        // 获取配额信息
        const quotaInfo = await this.getQuotaInfo();
        const maxRemoval = quotaInfo.remaining || 100;

        while (true) {
            await this.checkPauseState();

            const state = await this.stateStore.getState();
            if (!state.process.isRunning) break;

            // 如果已经处理到当前已加载的末尾，尝试加载下一批（batch）
            if (currentIndex >= (state.stats.totalReposts || 0)) {
                // 请求目标数：当前已知总数 + batchSize
                const target = (state.stats.totalReposts || 0) + this.batchSize;
                const newlyFound = await this.ui.autoScrollToBottom('video.containers', async (progress, isFinal) => {
                    await this.messageBus.broadcast('UPDATE_PROGRESS', {
                        current: currentIndex,
                        total: progress,
                        phase: isFinal ? 'final' : 'batch',
                        status: `Loaded ${progress} reposts so far...`,
                        statusKey: 'statusLoadedSoFar',
                        statusParams: { count: progress }
                    });
                }, target);
                if (newlyFound && newlyFound > (state.stats.totalReposts || 0)) {
                    await this.stateStore.setTotal(newlyFound);
                    console.log(`[ClearTok] Loaded additional reposts, new total: ${newlyFound}`);
                } else {
                    // 没有加载到更多内容，继续处理当前已加载项或结束
                    console.log('[ClearTok] No additional reposts found when attempting to load next batch.');
                }
            }

            // 检查是否达到配额限制
            if (removedCount >= maxRemoval) {
                await this.messageBus.broadcast('STATUS_UPDATE', {
                    status: `Daily limit reached`,
                    statusKey: 'statusDailyLimitReached'
                });
                console.log(`[ClearTok] Daily limit reached: ${removedCount}/${maxRemoval}`);
                break;
            }

            currentIndex += 1;

            // 动态更新总数
            const displayTotal = Math.max(currentIndex, state.stats.totalReposts || 0);
            if (displayTotal > state.stats.totalReposts) {
                await this.stateStore.setTotal(displayTotal);
            }

            await this.messageBus.broadcast('STATUS_UPDATE', {
                status: `Processing repost ${currentIndex} of ${displayTotal}...`,
                statusKey: 'statusProcessingRepostOf',
                statusParams: { current: currentIndex, total: displayTotal }
            });

            // 提取视频信息
            const videoInfo = this.getVideoInfo();
            await this.stateStore.setCurrentVideo({ ...videoInfo, index: currentIndex });
            await this.messageBus.broadcast('UPDATE_PROGRESS', {
                current: currentIndex,
                total: displayTotal,
                ...videoInfo
            });

            // 查找并点击"取消转发"按钮
            const repostButton = await this.ui.waitForElement('video.repostButton', 5000);
            if (repostButton && this.isVideoReposted(repostButton)) {
                // 点击取消转发（删除）并立即继续，不阻塞等待 UI/日志写入完成
                repostButton.click();
                removedCount++;  // 增加已删除计数

                // Fire-and-forget：发送已删除事件，后台/弹窗会异步处理并写入日志/状态
                try {
                    // 不要 await，这样可以与后续跳转并行
                    this.messageBus.broadcast('VIDEO_REMOVED', {
                        index: currentIndex,
                        ...videoInfo
                    });
                } catch (_) { /* ignore */ }

                console.log(`[ClearTok] Removed repost #${currentIndex} (${removedCount}/${maxRemoval})`);
                // 给 DOM/事件一点时间稳定（短于原始延迟），之后尽快切换到下一条
                await this.pausableSleep(this.getRandomDelay(200, 400));
            } else {
                await this.messageBus.broadcast('VIDEO_SKIPPED', {
                    index: currentIndex,
                    reason: 'Not a repost or button not found',
                    ...videoInfo
                });
                console.log(`[ClearTok] Skipped video #${currentIndex}`);
            }

            // 尝试进入下一条
            const nextButton = await this.ui.waitForElement('video.nextButton', 5000);
            if (nextButton && !nextButton.disabled) {
                nextButton.click();
                // 加快切换到下一条的短延迟（原 600–1600ms -> 300–900ms）
                await this.pausableSleep(this.getRandomDelay(300, 900));

                // 保留微休/长休逻辑，但缩短时长以提高速度
                if (currentIndex % 35 === 0) {
                    // 长休：1.5–4s（原 2–6s）
                    await this.pausableSleep(this.getRandomDelay(1500, 4000));
                } else if (currentIndex % 10 === 0) {
                    // 微休：0.7–1.5s（原 1–3s）
                    await this.pausableSleep(this.getRandomDelay(700, 1500));
                }

                continue;
            } else {
                console.warn('[ClearTok] Next button not found or disabled. Ending process.');
                break;
            }
        }

        // 关闭视频播放器
        const closeButton = await this.ui.waitForElement('video.closeButton', 3000);
        if (closeButton) {
            closeButton.click();
        } else {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        }
        // await this.ui.sleep(1000);
    }

    // --- 辅助函数 ---

    getVideoInfo() {
        try {
            const videoInfo = {
                title: '',
                url: window.location.href,
                author: ''
            };

            // 使用配置的选择器获取视频标题
            const titleElement = this.ui.findElement('video.title');
            if (titleElement && titleElement.textContent.trim()) {
                videoInfo.title = titleElement.textContent.trim();
            }

            // 使用配置的选择器获取作者信息
            const authorElement = this.ui.findElement('video.author');
            if (authorElement && authorElement.textContent.trim()) {
                let authorText = authorElement.textContent.trim();
                // Clean up author text
                if (!authorText.startsWith('@')) {
                    authorText = '@' + authorText;
                }
                videoInfo.author = authorText;
            }

            // Fallback: try to extract from URL
            if (!videoInfo.author && videoInfo.url.includes('/@')) {
                const urlParts = videoInfo.url.split('/@');
                if (urlParts.length > 1) {
                    const authorPart = urlParts[1].split('/')[0];
                    if (authorPart) {
                        videoInfo.author = '@' + authorPart;
                    }
                }
            }

            // Fallback: try to extract from video ID in URL
            if (!videoInfo.title && videoInfo.url.includes('/video/')) {
                const videoId = videoInfo.url.split('/video/')[1]?.split('?')[0];
                if (videoId) {
                    videoInfo.title = `Video ${videoId.substring(0, 8)}...`;
                }
            }

            // Truncate long titles
            if (videoInfo.title.length > 50) {
                videoInfo.title = videoInfo.title.substring(0, 50) + '...';
            }

            // Default values if nothing found
            if (!videoInfo.title) {
                videoInfo.title = 'Untitled video';
            }
            if (!videoInfo.author) {
                videoInfo.author = '@unknown';
            }

            return videoInfo;
        } catch (error) {
            console.log('[ClearTok] Error getting video info:', error);
            return {
                title: 'Unknown video',
                url: window.location.href,
                author: '@unknown'
            };
        }
    }

    isVideoReposted(repostButton) {
        // 这个逻辑比较复杂，保持原样
        const isPressed = repostButton.getAttribute(this.config.get('repostStatus.pressedAttribute')) === 'true';
        const hasActiveColor = window.getComputedStyle(repostButton).color !== 'rgb(255, 255, 255)';
        const hasFilledIcon = this.ui.findElement('repostStatus.svgFillSelector', repostButton) !== null;
        return isPressed || hasActiveColor || hasFilledIcon;
    }

    async checkPauseState() {
        while (true) {
            const state = await this.stateStore.getState();
            // 如果没有暂停或者进程已停止，则退出等待循环
            if (!state.process.isPaused || !state.process.isRunning) {
                break;
            }
            // 暂停中，继续等待
            await this.ui.sleep(500);
        }
    }

    getRandomDelay(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    async handleError(message, error = '') {
        await this.stateStore.stopProcess();

        // 移除黑客边框
        if (window.clearTokBorder) {
            window.clearTokBorder.remove();
        }

        await this.messageBus.broadcast('ERROR', { message, error: error.toString() });
        console.error(`[ClearTok] SCRIPT STOPPED: ${message}`, error);
    }

    async finishProcess(message) {
        const state = await this.stateStore.getState();
        const duration = await this.stateStore.getDuration();

        await this.stateStore.stopProcess();

        // 移除黑客边框
        if (window.clearTokBorder) {
            window.clearTokBorder.remove();
        }

        await this.messageBus.broadcast('COMPLETE', {
            removedCount: state.stats.removedVideos,
            totalCount: state.stats.totalReposts,
            duration: duration
        });
        console.log(`[ClearTok] SCRIPT FINISHED: ${message}`);
    }

    /**
     * 获取配额信息
     */
    async getQuotaInfo() {
        try {
            // 优先使用 session-auth 持久化的配额信息
            const result = await chrome.storage.local.get(['quotaInfo']);
            if (result && result.quotaInfo && typeof result.quotaInfo.remaining === 'number') {
                return result.quotaInfo;
            }
        } catch (_) {}

    // 兜底：将默认配额设置为一个极大值以实现“无限”行为（避免使用 JSON 不可序列化的 Infinity）
    const UNLIMITED = Number.MAX_SAFE_INTEGER;
    return { remaining: UNLIMITED, daily_limit: UNLIMITED, is_premium: true };
    }
}
