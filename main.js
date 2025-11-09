// /main.js
console.log('[ClearTok main.js] Script loaded at', new Date().toISOString());

// 确保在导入类之前检查重复注入
if (window.clearTokHasInitialized) {
  console.log('[ClearTok] Script already initialized. Skipping.');
} else {
  console.log('[ClearTok main.js] First initialization, proceeding...');
  window.clearTokHasInitialized = true;

  // 创建黑客风格边框
  function createHackerBorder() {
    // 检查是否已存在边框
    if (document.getElementById('cleartok-hacker-border')) {
      return;
    }

    // 创建边框容器
    const borderContainer = document.createElement('div');
    borderContainer.id = 'cleartok-hacker-border';
    
    // 设置边框样式 - 使用最高层级确保始终在最外层
    borderContainer.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      pointer-events: none;
      z-index: 2147483647;
      isolation: isolate;
      overflow: hidden;
    `;

    // 创建四条边框 - 细线条但有强烈微光
    const borders = {
      top: { 
        left: 0, 
        top: 0, 
        width: '100%', 
        height: '2px',
        gradient: '90deg'
      },
      bottom: { 
        left: 0, 
        bottom: 0, 
        width: '100%', 
        height: '2px',
        gradient: '90deg'
      },
      left: { 
        left: 0, 
        top: 0, 
        width: '2px', 
        height: '100%',
        gradient: '180deg'
      },
      right: { 
        position: 'absolute',
        right: 0, 
        top: 0, 
        width: '2px', 
        height: '100%',
        gradient: '180deg'
      }
    };

    Object.entries(borders).forEach(([position, config]) => {
      const { gradient, ...styles } = config;
      const border = document.createElement('div');
      border.className = `cleartok-border-${position}`;
      
      // 为每条边创建多层光晕效果
      const glowContainer = document.createElement('div');
      glowContainer.style.cssText = `
        position: absolute;
        ${Object.entries(styles).map(([k, v]) => `${k}: ${v}`).join('; ')};
      `;
      
      // 创建多层光晕效果 - 营造高级黑客感
      const glowLayers = [
        { spread: 60, blur: 80, opacity: 0.3, intensity: 0.05 },
        { spread: 40, blur: 60, opacity: 0.5, intensity: 0.1 },
        { spread: 20, blur: 40, opacity: 0.7, intensity: 0.2 },
        { spread: 10, blur: 20, opacity: 0.9, intensity: 0.3 }
      ];
      
      glowLayers.forEach((layer, index) => {
        const glowLayer = document.createElement('div');
        glowLayer.className = `glow-layer-${index}`;
        
        glowLayer.style.cssText = `
          position: absolute;
          ${position === 'top' || position === 'bottom' ? 
            `left: -${layer.spread}px; right: -${layer.spread}px; height: ${2 + layer.spread * 2}px;` : 
            `top: -${layer.spread}px; bottom: -${layer.spread}px; width: ${2 + layer.spread * 2}px;`}
          ${position === 'top' ? `top: -${layer.spread}px;` : ''}
          ${position === 'bottom' ? `bottom: -${layer.spread}px;` : ''}
          ${position === 'left' ? `left: -${layer.spread}px;` : ''}
          ${position === 'right' ? `right: -${layer.spread}px;` : ''}
          background: linear-gradient(${gradient}, 
            transparent 0%,
            rgba(0, 255, 200, ${layer.intensity}) 15%,
            rgba(0, 242, 234, ${layer.intensity * 2}) 50%,
            rgba(0, 255, 200, ${layer.intensity}) 85%,
            transparent 100%
          );
          filter: blur(${layer.blur}px);
          opacity: ${layer.opacity};
          animation: glowBreath${index} ${3 + index * 0.5}s ease-in-out infinite;
          pointer-events: none;
        `;
        glowContainer.appendChild(glowLayer);
      });
      
      // 核心边框线
      border.style.cssText = `
        position: absolute;
        ${Object.entries(styles).map(([k, v]) => `${k}: ${v}`).join('; ')};
        background: linear-gradient(${gradient}, 
          transparent 0%,
          rgba(255, 0, 106, 0.6) 15%,
          rgba(255, 0, 170, 1) 30%,
          rgba(242, 0, 93, 1) 50%,
          rgba(255, 0, 149, 1) 70%,
          rgba(255, 0, 128, 0.6) 85%,
          transparent 100%
        );
        box-shadow: 
          0 0 20px rgba(255, 0, 149, 1),
          0 0 40px rgba(242, 0, 113, 0.9),
          0 0 60px rgba(255, 0, 179, 0.7),
          0 0 80px rgba(242, 0, 141, 0.5),
          inset 0 0 15px rgba(255, 0, 170, 1);
        filter: brightness(1.8) contrast(1.4);
      `;
      
      // 添加扫描和呼吸动画
      if (position === 'top' || position === 'bottom') {
        border.style.backgroundSize = '200% 100%';
        border.style.animation = 'scanHorizontal 4s linear infinite, borderBreath 2s ease-in-out infinite';
      } else {
        border.style.backgroundSize = '100% 200%';
        border.style.animation = 'scanVertical 4s linear infinite, borderBreath 2s ease-in-out infinite';
      }
      
      borderContainer.appendChild(glowContainer);
      borderContainer.appendChild(border);
    });


    // 添加标识文字 - 更醒目的样式
    const label = document.createElement('div');
    label.className = 'cleartok-label';
    label.textContent = 'YukiRem Active';
    label.style.cssText = `
      position: absolute;
      bottom: 15px;
      left: 15px;
      padding: 6px 16px;
      background: linear-gradient(135deg, 
        rgba(0, 0, 0, 0.95) 0%,
        rgba(0, 20, 20, 0.9) 100%
      );
      border: 2px solid rgba(255, 0, 149, 0.8);
      border-radius: 6px;
      color: #ff0080ff;
      font-family: 'Courier New', monospace;
      font-size: 12px;
      font-weight: bold;
      letter-spacing: 3px;
      text-shadow: 
        0 0 20px rgba(255, 0, 98, 1),
        0 0 40px rgba(242, 0, 101, 0.8),
        0 0 60px rgba(255, 0, 85, 0.6);
      /* 取消文字框呼吸动画，保持稳定光晕 */
      box-shadow: 
        0 0 15px rgba(255, 0, 106, 0.6),
        0 0 30px rgba(242, 0, 32, 0.4);
      pointer-events: none;
      backdrop-filter: blur(10px);
    `;
    borderContainer.appendChild(label);

    // 注入完整的CSS动画 - 营造高级黑客感
    const style = document.createElement('style');
    style.id = 'cleartok-border-styles';
    style.textContent = `
      @keyframes scanHorizontal {
        0% { background-position: -100% 0; }
        100% { background-position: 100% 0; }
      }
      
      @keyframes scanVertical {
        0% { background-position: 0 -100%; }
        100% { background-position: 0 100%; }
      }
      
      @keyframes borderBreath {
        0%, 100% { 
          filter: brightness(1.4) contrast(1.2);
          opacity: 0.75;
          box-shadow:
            0 0 8px rgba(242, 0, 121, 0.25),
            inset 0 0 6px rgba(242, 0, 101, 0.15),
            0 0 2px rgba(255, 0, 98, 0.45),
            inset 0 0 6px rgba(59, 2, 15, 0.8);
        }
        50% { 
          filter: brightness(2.6) contrast(1.8) saturate(1.3);
          opacity: 1;
          box-shadow:
            0 0 18px rgba(242, 0, 81, 0.45),
            inset 0 0 12px rgba(242, 0, 81, 0.25),
            0 0 6px rgba(255, 0, 85, 0.9),
            inset 0 0 12px rgba(255, 0, 106, 1);
        }
      }
      
      @keyframes glowBreath0 { 0%, 100% { opacity: 0.25; transform: scale(1); } 50% { opacity: 0.6; transform: scale(1.07); } }
      
      @keyframes glowBreath1 { 0%, 100% { opacity: 0.45; transform: scale(1); } 50% { opacity: 0.8; transform: scale(1.05); } }
      
      @keyframes glowBreath2 { 0%, 100% { opacity: 0.65; transform: scale(1); } 50% { opacity: 0.95; transform: scale(1.03); } }
      
      @keyframes glowBreath3 { 0%, 100% { opacity: 0.85; } 50% { opacity: 1; } }
    `;
    document.head.appendChild(style);

    // 添加到页面
    document.body.appendChild(borderContainer);
    console.log('[YukiRem] Hacker border activated | ClearTok Cracked by Yuki');
  }

  // 移除边框
  function removeHackerBorder() {
    const border = document.getElementById('cleartok-hacker-border');
    const styles = document.getElementById('cleartok-border-styles');
    if (border) {
      border.remove();
      console.log('[YukiRem] Hacker border removed | ClearTok Cracked by Yuki');
    }
    if (styles) {
      styles.remove();
    }
  }

  // 更新边框状态 - 只改变文字，保持颜色不变
  function updateBorderState(isPaused) {
    const border = document.getElementById('cleartok-hacker-border');
    if (border) {
      const label = border.querySelector('.cleartok-label');
      if (label) {
        // 只改变文字，提供状态反馈
        label.textContent = isPaused ? 'YukiRem Paused' : 'YukiRem Active';
        
        // 可选：暂停时略微降低整体亮度，但保持同色系
        if (isPaused) {
          border.style.opacity = '0.85';
        } else {
          border.style.opacity = '1';
        }
      }
    }
  }

  // 同步创建关键组件，确保消息处理器立即可用
  const stateStore = window.clearTokStateStore || new StateStore();
  const tempMessageBus = new MessageBus(null, stateStore);

  // 立即注册暂停/恢复处理器（不依赖任何异步操作）
  tempMessageBus.on('PING', () => 'PONG');

  tempMessageBus.on('PAUSE_REMOVAL', async () => {
    console.log('[YukiRem] Handling PAUSE_REMOVAL');
    await stateStore.setPaused(true);
    if (window.clearTokBorder) {
      window.clearTokBorder.updateState(true);
    }
    // 使用全局 messageBus（如果存在）或临时的 tempMessageBus
    const bus = window.messageBus || tempMessageBus;
    await bus.broadcast('STATUS_UPDATE', { status: 'Paused by user.' });
    return { success: true, paused: true };
  });

  tempMessageBus.on('RESUME_REMOVAL', async () => {
    console.log('[YukiRem] Handling RESUME_REMOVAL');
    await stateStore.setPaused(false);
    if (window.clearTokBorder) {
      window.clearTokBorder.updateState(false);
    }
    // 使用全局 messageBus（如果存在）或临时的 tempMessageBus
    const bus = window.messageBus || tempMessageBus;
    await bus.broadcast('STATUS_UPDATE', { status: 'Resuming process...' });
    return { success: true, resumed: true };
  });

  // 立即导出，确保消息可以被处理
  window.clearTokStateStore = stateStore;
  window.messageBus = tempMessageBus;

  (async () => {
    console.log('[YukiRem] Starting initialization...');

    try {
      // 1. 初始化模块
      console.log('[YukiRem] Loading config...');
      const config = new ConfigManager();
      await config.init(); // 必须等待配置加载
      console.log('[YukiRem] Config loaded');

      // 初始化状态存储
      console.log('[YukiRem] Initializing state store...');
      await stateStore.init();
      console.log('[YukiRem] State store initialized');

      const ui = new UIManager(config);

      // 使用已经创建的 messageBus
      const messageBus = tempMessageBus;
      console.log('[YukiRem] MessageBus ready with handlers');

      // 创建工作流管理器
      const workflow = new WorkflowManager(config, ui, stateStore, messageBus);
      console.log('[YukiRem] WorkflowManager created');
      // 设置消息总线的workflow引用
      messageBus.workflow = workflow;

      // 注册需要 workflow 的处理器
      messageBus.on('START_REMOVAL', async () => {
        await workflow.start();
      });

      messageBus.on('CHECK_LOGIN_STATUS', async () => {
        await workflow.runInitialChecks();
      });

      messageBus.on('NAVIGATE_TO_REPOSTS', async () => {
        await workflow.step_navigateToRepostsTab();
      });

      // 导出全局引用（更新已有的引用）
      window.workflow = workflow;

      // 2. 执行页面加载后的初始检查
      // 智能等待页面加载完成
      async function waitForPageReady() {
        // 等待DOM完全加载
        if (document.readyState !== 'complete') {
          await new Promise(resolve => {
            window.addEventListener('load', resolve, { once: true });
          });
        }
        
        // 等待关键元素出现（最多5秒）
        const profileElement = await ui.waitForElement('loginStatus.profileLink', 5000);
        
        if (profileElement) {
          // 元素已出现，执行检查
          workflow.runInitialChecks();
        } else {
          // 元素未出现，仍尝试检查（可能是未登录状态）
          workflow.runInitialChecks();
        }
      }
      
      waitForPageReady();
      
      // 暴露边框控制函数给全局
      window.clearTokBorder = {
        create: createHackerBorder,
        remove: removeHackerBorder,
        updateState: updateBorderState
      };

      console.log('[YukiRem] ✅ Initialization complete. Ready for commands.');
    
    } catch (error) {
        console.error('[YukiRem] 💥 Failed to initialize extension:', error);
    }

  })();
}
