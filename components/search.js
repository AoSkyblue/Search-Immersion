// Search Component - ES Module
// 検索機能を独立したモジュールとして提供

/**
 * ユーティリティ: debounce関数
 */
function debounce(func, wait) {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), wait);
    };
}

/**
 * ショートカットキーで検索窓にフォーカスする機能
 * @param {HTMLInputElement} input - 検索入力要素
 */
function setupSearchShortcut(input) {
    // 設定からショートカットキーを取得
    const getShortcutKey = () => {
        try {
            const prefs = JSON.parse(localStorage.getItem('immersion_prefs')) || {};
            return prefs.searchShortcut || '/';
        } catch {
            return '/';
        }
    };

    document.addEventListener('keydown', (e) => {
        const shortcutKey = getShortcutKey();

        // 入力中は無視（input, textarea, contenteditable）
        const activeEl = document.activeElement;
        const isEditable = activeEl.tagName === 'INPUT' ||
            activeEl.tagName === 'TEXTAREA' ||
            activeEl.isContentEditable;

        // モーダルが開いているときは無視
        const modalOpen = document.querySelector('.overlay-modal.show');

        if (isEditable || modalOpen) return;

        // IME変換中は無視
        if (e.isComposing || e.keyCode === 229) return;

        // ショートカットキーが押されたら検索窓にフォーカス
        if (e.key === shortcutKey) {
            e.preventDefault();
            input.focus();
            input.select(); // 既存のテキストを選択状態にする
        }
    });
}


/**
 * 検索機能のセットアップ
 * @param {Function} t - 翻訳関数
 */
export function setupSearch(t) {
    const input = document.getElementById('search-input');
    const clearBtn = document.getElementById('search-clear');

    if (!input || !clearBtn) return;

    const updateClearBtn = () => {
        if (input.value) clearBtn.style.display = 'block';
        else clearBtn.style.display = 'none';
    };

    input.addEventListener('input', updateClearBtn);
    updateClearBtn();

    clearBtn.onclick = () => {
        input.value = '';
        input.focus();
        updateClearBtn();
    };

    input.addEventListener('keydown', (e) => {
        // IME変換中（日本語入力など）の場合は検索を実行しない
        if (e.isComposing || e.keyCode === 229) {
            return;
        }
        if (e.key === 'Enter' && input.value) {
            const activeItem = document.querySelector('.suggestion-item.active');
            if (activeItem) {
                return;
            }

            const val = input.value.trim();

            const hasProtocol = /^[a-zA-Z]+:\/\//.test(val);
            const isDomain = /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(:[0-9]+)?(\/.*)?$/.test(val);
            const noSpaces = !val.includes(' ');

            if (hasProtocol) {
                window.location.href = val;
                return;
            }
            if (noSpaces && (val.startsWith('www.') || isDomain)) {
                window.location.href = 'https://' + val;
                return;
            }

            window.location.href = `https://www.google.com/search?q=${encodeURIComponent(val)}`;
        }
    });

    // ショートカットキーで検索窓にフォーカス
    setupSearchShortcut(input);

    setupSearchAutocomplete(input, t);
}

/**
 * 検索オートコンプリート機能
 * @param {HTMLInputElement} input - 検索入力要素
 * @param {Function} t - 翻訳関数
 */
function setupSearchAutocomplete(input, t) {
    const container = document.getElementById('search-suggestions');
    if (!container) return;

    let currentFocus = -1;

    const fetchSuggestions = debounce((query) => {
        const isEmp = !query || query.trim() === '';

        const historyPromise = new Promise((resolve) => {
            try {
                if (!chrome.runtime?.id) { resolve([]); return; }
                chrome.runtime.sendMessage({ action: "searchHistory", query: query || "" }, (res) => {
                    if (chrome.runtime.lastError) { resolve([]); return; }
                    resolve(res?.data || []);
                });
            } catch (e) {
                resolve([]);
            }
        });

        const googlePromise = isEmp ? Promise.resolve([]) : fetch(`https://www.google.com/complete/search?client=chrome&q=${encodeURIComponent(query)}`)
            .then(res => res.json())
            .then(data => data[1] || [])
            .catch(() => []);

        Promise.all([historyPromise, googlePromise]).then(([historyItems, googleItems]) => {
            const combined = [];
            const seenTitles = new Set();
            const maxHistory = 8;

            const extractSearchTerm = (url) => {
                try {
                    const u = new URL(url);
                    if (u.hostname.includes('google') && u.pathname === '/search') {
                        return u.searchParams.get('q');
                    }
                } catch (e) { }
                return null;
            };

            historyItems.forEach(h => {
                if (combined.length >= maxHistory) return;

                const term = extractSearchTerm(h.url);
                if (term && !seenTitles.has(term)) {
                    combined.push({ text: term, type: 'history', url: h.url });
                    seenTitles.add(term);
                }
            });

            googleItems.forEach(g => {
                if (combined.length < 8 && !seenTitles.has(g)) {
                    combined.push({ text: g, type: 'search' });
                    seenTitles.add(g);
                }
            });

            if (combined.length > 0) {
                renderSuggestions(combined);
            } else {
                container.style.display = 'none';
            }
        });

    }, 200);

    const renderSuggestions = (items) => {
        container.innerHTML = '';
        items.forEach(item => {
            const div = document.createElement('div');
            div.className = 'suggestion-item';
            div.setAttribute('data-val', item.text);
            const icon = item.type === 'history' ? '🕒' : '🔍';

            let innerHTML = `<div style="display:flex; align-items:center; flex:1; min-width:0;">
        <span style="opacity:0.6; margin-right:10px; flex-shrink:0;">${icon}</span> 
        <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${item.text}</span>
      </div>`;

            if (item.type === 'history') {
                innerHTML += `<span class="suggestion-del" title="${t('ctx_del')}" style="opacity:0.4; padding:0 10px; cursor:pointer;">×</span>`;
            }
            div.innerHTML = innerHTML;

            div.onclick = () => {
                input.value = item.text;
                window.location.href = `https://www.google.com/search?q=${encodeURIComponent(item.text)}`;
            };

            if (item.type === 'history') {
                const delBtn = div.querySelector('.suggestion-del');
                if (delBtn) {
                    delBtn.onclick = (e) => {
                        e.stopPropagation();
                        chrome.runtime.sendMessage({ action: "deleteHistory", url: item.url }, () => {
                            fetchSuggestions(input.value || '');
                        });
                    };
                    delBtn.onmouseenter = () => delBtn.style.opacity = '1';
                    delBtn.onmouseleave = () => delBtn.style.opacity = '0.4';
                }
            }

            container.appendChild(div);
        });
        container.style.display = 'block';
        currentFocus = -1;
    };

    input.addEventListener('input', () => {
        fetchSuggestions(input.value);
        if (!input.value) fetchSuggestions('');
    });

    const trigger = () => { if (!input.value) fetchSuggestions(''); };
    input.addEventListener('focus', trigger);
    input.addEventListener('click', trigger);

    input.addEventListener('keydown', (e) => {
        // IME変換中は何もしない
        if (e.isComposing || e.keyCode === 229) {
            return;
        }

        const items = container.querySelectorAll('.suggestion-item');
        if (e.key === 'ArrowDown') {
            currentFocus++;
            if (currentFocus >= items.length) currentFocus = 0;
            setActive(items);
        } else if (e.key === 'ArrowUp') {
            currentFocus--;
            if (currentFocus < 0) currentFocus = items.length - 1;
            setActive(items);
        } else if (e.key === 'Enter') {
            if (currentFocus > -1 && items[currentFocus]) {
                e.preventDefault();
                items[currentFocus].click();
            }
        } else if (e.key === 'Escape') {
            container.style.display = 'none';
            input.blur();
        }
    });

    const setActive = (items) => {
        if (!items || items.length === 0) return;
        items.forEach(item => item.classList.remove('active'));
        if (currentFocus >= 0 && items[currentFocus]) {
            items[currentFocus].classList.add('active');
            input.value = items[currentFocus].getAttribute('data-val');
        }
    };

    document.addEventListener('click', (e) => {
        if (e.target !== input && e.target !== container) {
            container.style.display = 'none';
        }
    });
}
