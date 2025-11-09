class I18n {
  constructor() {
    this.messages = {};
    this.fallbackMessages = {};
    this.currentLanguage = 'en';
    this.supportedLanguages = {
      'en': 'English',
      'es': 'Español',
      'it': 'Italiano',
      'de': 'Deutsch',
      'fr': 'Français',
      'id': 'Bahasa Indonesia',
      'ja': '日本語',
      'ko': '한국어',
      'ms': 'Bahasa Melayu',
      'pt_BR': 'Português (Brasil)',
      'tr': 'Türkçe',
      'ar': 'العربية',
      'nl': 'Nederlands',
      'zh_CN': '简体中文'
    };
    
    // Language mapping table for various language codes and locales
    this.languageMapping = {
      // Standard language codes
      'en': 'en', 'en-US': 'en', 'en-GB': 'en', 'en-CA': 'en', 'en-AU': 'en',
      'es': 'es', 'es-ES': 'es', 'es-MX': 'es', 'es-AR': 'es', 'es-CO': 'es',
      'it': 'it', 'it-IT': 'it',
      'de': 'de', 'de-DE': 'de', 'de-AT': 'de', 'de-CH': 'de',
      'fr': 'fr', 'fr-FR': 'fr', 'fr-CA': 'fr', 'fr-BE': 'fr', 'fr-CH': 'fr',
      'id': 'id', 'id-ID': 'id',
      'ja': 'ja', 'ja-JP': 'ja',
      'ko': 'ko', 'ko-KR': 'ko',
      'ms': 'ms', 'ms-MY': 'ms',
      'pt': 'pt_BR', 'pt-BR': 'pt_BR', 'pt-PT': 'pt_BR',
      'tr': 'tr', 'tr-TR': 'tr',
      'ar': 'ar', 'ar-SA': 'ar', 'ar-AE': 'ar', 'ar-EG': 'ar',
      'nl': 'nl', 'nl-NL': 'nl', 'nl-BE': 'nl',
      // Additional mappings for common variants
      'pt_BR': 'pt_BR',
      // Chinese (Simplified)
      'zh': 'zh_CN', 'zh-cn': 'zh_CN', 'zh-CN': 'zh_CN', 'zh-sg': 'zh_CN', 'zh-SG': 'zh_CN',
      // Chinese (Traditional) - map to Simplified for now if requested
      'zh-tw': 'zh_CN', 'zh-TW': 'zh_CN',
      'ru': 'en', 'ru-RU': 'en', // Russian fallback to English for now
      'hi': 'en', 'hi-IN': 'en'  // Hindi fallback to English for now
    };
    
    // Language priority fallback chain
    this.languageFallback = ['en'];
    
    this.readyPromise = new Promise(res => { this._resolveReady = res; });
  }

  async init() {
    // Get saved language or use browser language
    const savedLanguage = localStorage.getItem('tiktokrepostremover_language');
    if (savedLanguage && this.supportedLanguages[savedLanguage]) {
      this.currentLanguage = savedLanguage;
    } else {
      // Try to detect browser language with enhanced logic
      this.currentLanguage = this.detectBrowserLanguage();
    }

    await this.loadMessages();
    this.translatePage();
    this.setupLanguageSelector();
    // Signal that i18n is ready
    if (this._resolveReady) this._resolveReady(true);
  }

  async loadMessages() {
    try {
      // Always try to load current language AND English fallback
      const [curRes, enRes] = await Promise.allSettled([
        fetch(`_locales/${this.currentLanguage}/messages.json`),
        fetch('_locales/en/messages.json')
      ]);

      // Load English fallback first (if available)
      if (enRes.status === 'fulfilled' && enRes.value.ok) {
        this.fallbackMessages = await enRes.value.json();
      } else {
        this.fallbackMessages = {};
      }

      // Load current language, fallback to English if not ok
      if (curRes.status === 'fulfilled' && curRes.value.ok) {
        this.messages = await curRes.value.json();
      } else {
        this.messages = this.fallbackMessages || {};
      }
    } catch (error) {
      console.error('Error loading messages:', error);
      // Use English as ultimate fallback
      try {
        const fallbackResponse = await fetch('_locales/en/messages.json');
        const en = await fallbackResponse.json();
        this.fallbackMessages = en;
        this.messages = en;
      } catch (fallbackError) {
        console.error('Error loading fallback messages:', fallbackError);
      }
    }
  }

  getMessage(key, substitutions = {}) {
    const message = this.messages[key] || this.fallbackMessages[key];
    if (!message) {
      console.warn(`Missing translation for key: ${key}`);
      return key;
    }

    let text = message.message;
    
    // Replace placeholders like {count}, {current}, {total}
    Object.keys(substitutions).forEach(placeholder => {
      text = text.replace(new RegExp(`{${placeholder}}`, 'g'), substitutions[placeholder]);
    });

    return text;
  }

  translatePage() {
    // Translate all elements with data-i18n attribute
    const elements = document.querySelectorAll('[data-i18n]');
    elements.forEach(element => {
      const key = element.getAttribute('data-i18n');
      const translation = this.getMessage(key);
      
      if (element.tagName === 'INPUT' && (element.type === 'button' || element.type === 'submit' || element.type === 'reset')) {
        element.value = translation;
      } else {
        element.textContent = translation;
      }
    });

    // Translate attribute values when data-i18n-* markers are present
    const attrMap = [
      { selector: '[data-i18n-title]', attr: 'title', dataKey: 'data-i18n-title' },
      { selector: '[data-i18n-placeholder]', attr: 'placeholder', dataKey: 'data-i18n-placeholder' },
      { selector: '[data-i18n-aria-label]', attr: 'aria-label', dataKey: 'data-i18n-aria-label' }
    ];
    attrMap.forEach(({ selector, attr, dataKey }) => {
      document.querySelectorAll(selector).forEach(el => {
        const key = el.getAttribute(dataKey);
        if (!key) return;
        const translation = this.getMessage(key);
        if (translation) el.setAttribute(attr, translation);
      });
    });

    // Update document title
    document.title = this.getMessage('appTitle');
  }

  async changeLanguage(languageCode) {
    if (!this.supportedLanguages[languageCode]) {
      console.error(`Unsupported language: ${languageCode}`);
      return;
    }

    this.currentLanguage = languageCode;
    localStorage.setItem('tiktokrepostremover_language', languageCode);
    
    await this.loadMessages();
    this.translatePage();
    
    // Update language selector
    const languageSelector = document.getElementById('languageSelector');
    if (languageSelector) {
      languageSelector.value = languageCode;
    }

    try {
      if (typeof window !== 'undefined' && window.dispatchEvent) {
        window.dispatchEvent(new CustomEvent('i18n-language-changed', { detail: { language: languageCode } }));
      }
    } catch (_) {}
  }

  setupLanguageSelector() {
    // Create language selector if it doesn't exist
    let languageSelector = document.getElementById('languageSelector');
    if (!languageSelector) {
      const selectorContainer = document.getElementById('languageSelectorContainer');
      if (selectorContainer) {
        languageSelector = document.createElement('select');
        languageSelector.id = 'languageSelector';
        languageSelector.className = 'language-selector';
        
        Object.keys(this.supportedLanguages).forEach(langCode => {
          const option = document.createElement('option');
          option.value = langCode;
          option.textContent = this.supportedLanguages[langCode];
          languageSelector.appendChild(option);
        });
        
        selectorContainer.appendChild(languageSelector);
      }
    }

    if (languageSelector) {
      languageSelector.value = this.currentLanguage;
      languageSelector.addEventListener('change', (e) => {
        this.changeLanguage(e.target.value);
      });
    }
  }

  // Enhanced browser language detection
  detectBrowserLanguage() {
    // Get browser language preferences (in order of preference)
    const browserLanguages = [];
    
    // Primary language preference
    if (navigator.language) {
      browserLanguages.push(navigator.language);
    }
    
    // User language (IE fallback)
    if (navigator.userLanguage) {
      browserLanguages.push(navigator.userLanguage);
    }
    
    // All preferred languages
    if (navigator.languages && navigator.languages.length > 0) {
      browserLanguages.push(...navigator.languages);
    }
    
    // Chrome extension API language (if available)
    if (typeof chrome !== 'undefined' && chrome.i18n && chrome.i18n.getUILanguage) {
      try {
        browserLanguages.push(chrome.i18n.getUILanguage());
      } catch (e) {
        // Ignore if not available
      }
    }
    
    // Remove duplicates and normalize
    const uniqueLanguages = [...new Set(browserLanguages)]
      .filter(lang => lang && typeof lang === 'string')
      .map(lang => lang.toLowerCase().trim());
    
    // Try to find a supported language
    for (const browserLang of uniqueLanguages) {
      // Direct mapping check
      if (this.languageMapping[browserLang]) {
        const mappedLang = this.languageMapping[browserLang];
        if (this.supportedLanguages[mappedLang]) {
          console.log(`[I18n] Browser language detected: ${browserLang} → ${mappedLang}`);
          return mappedLang;
        }
      }
      
      // Fallback to base language code (e.g., 'en-US' → 'en')
      const baseLang = browserLang.split('-')[0];
      if (this.languageMapping[baseLang]) {
        const mappedLang = this.languageMapping[baseLang];
        if (this.supportedLanguages[mappedLang]) {
          console.log(`[I18n] Browser base language detected: ${baseLang} → ${mappedLang}`);
          return mappedLang;
        }
      }
    }
    
    // No supported language found, use English as fallback
    console.log(`[I18n] No supported browser language found in [${uniqueLanguages.join(', ')}], using English`);
    return 'en';
  }
  
  // Method to update dynamic content
  updateDynamicText(elementId, key, substitutions = {}) {
    const element = document.getElementById(elementId);
    if (element) {
      element.textContent = this.getMessage(key, substitutions);
    }
  }
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = I18n;
} 
