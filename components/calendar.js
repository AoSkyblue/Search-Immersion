// Calendar Component - ES Module
// カレンダー機能を独立したモジュールとして提供

// 現在表示中の年・月を管理
let displayYear = new Date().getFullYear();
let displayMonth = new Date().getMonth();
let currentEventKey = null;

// Googleカレンダーイベントのキャッシュ
let googleEventsCache = {};
let isGoogleAuthenticated = false;

// 翻訳関数（setupCalendarで設定される）
// 翻訳関数
let t = (key) => key;

async function openCalendarSettingsModal() {
    try {
        console.log("openCalendarSettingsModal called"); // Debug
        // モーダルHTMLがなければ作成
        let modal = document.getElementById('cal-settings-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'cal-settings-modal';
            modal.className = 'cal-settings-modal';
            modal.innerHTML = `
            <div class="cal-settings-content">
                <div class="cal-settings-title">Calendar Settings</div>
                <div id="cal-list-container" class="cal-list-container">Loading...</div>
                <div class="cal-settings-actions">
                    <button class="st-btn" id="cal-settings-cancel">Cancel</button>
                    <button class="st-btn" id="cal-settings-save">Save</button>
                </div>
            </div>
        `;
            document.body.appendChild(modal);

            const close = () => modal.classList.remove('show');
            modal.querySelector('#cal-settings-cancel').onclick = close;
            modal.onclick = (e) => { if (e.target === modal) close(); };
        }

        // リスト取得
        const container = modal.querySelector('#cal-list-container');
        container.innerHTML = '<div style="color:#aaa;text-align:center;padding:10px;">Loading calendars...</div>';

        modal.classList.add('show');

        const calendars = await fetchCalendarList();
        const settings = loadCalendarSettings();
        const selectedSet = new Set(settings.selectedCalendars);

        container.innerHTML = '';

        if (calendars.length === 0) {
            container.innerHTML = '<div style="color:#aaa;text-align:center;padding:10px;">No calendars found or API error.</div>';
        }

        calendars.forEach(cal => {
            const item = document.createElement('div');
            item.className = 'cal-list-item';
            const isSelected = selectedSet.has(cal.id) || (cal.primary && selectedSet.has('primary'));
            const color = cal.backgroundColor || '#4285f4';

            item.innerHTML = `
            <input type="checkbox" data-id="${cal.id}" data-color="${color}" ${isSelected ? 'checked' : ''}>
            <span class="cal-color-dot" style="background:${color}"></span>
            <span class="cal-name" title="${cal.summary}">${cal.summary}</span>
        `;
            container.appendChild(item);
        });

        const saveBtn = modal.querySelector('#cal-settings-save');
        saveBtn.onclick = () => {
            const checkboxes = container.querySelectorAll('input[type="checkbox"]');
            const newSelected = [];
            const newColors = {};

            checkboxes.forEach(cb => {
                if (cb.checked) {
                    const id = cb.getAttribute('data-id');
                    newSelected.push(id);
                    newColors[id] = cb.getAttribute('data-color');
                }
            });

            saveCalendarSettings({
                selectedCalendars: newSelected,
                calendarColors: newColors
            });

            modal.classList.remove('show');
            renderCalendar(); // 再描画
        };
    } catch (e) {
        console.error("Error opening settings modal:", e);
    }
}

// デフォルト設定（content.jsと同期）
const defaultSettings = {
    language: 'auto',
    googleCalendarEnabled: true
};

// カレンダー設定の読み込み
function loadCalendarSettings() {
    return JSON.parse(localStorage.getItem('immersion_calendar_settings')) || {
        selectedCalendars: ['primary'],
        calendarColors: { 'primary': '#4285f4' }
    };
}

// カレンダー設定の保存
function saveCalendarSettings(settings) {
    localStorage.setItem('immersion_calendar_settings', JSON.stringify(settings));
}

// カレンダーリスト取得
async function fetchCalendarList() {
    return new Promise((resolve) => {
        try {
            chrome.runtime.sendMessage({ action: "fetchGoogleCalendarList" }, (response) => {
                if (chrome.runtime.lastError || response?.error) {
                    resolve([]);
                } else {
                    resolve(response?.calendars || []);
                }
            });
        } catch (e) {
            resolve([]);
        }
    });
}

/**
 * Googleカレンダーの認証状態を確認
 */
async function checkGoogleAuth() {
    return new Promise((resolve) => {
        try {
            chrome.runtime.sendMessage({ action: "checkGoogleCalendarAuth" }, (response) => {
                if (chrome.runtime.lastError) {
                    resolve(false);
                    return;
                }
                isGoogleAuthenticated = response?.authenticated || false;
                resolve(isGoogleAuthenticated);
            });
        } catch (e) {
            resolve(false);
        }
    });
}

/**
 * Googleカレンダーにログイン
 */
async function loginToGoogle() {
    return new Promise((resolve) => {
        try {
            chrome.runtime.sendMessage({ action: "googleCalendarAuth", interactive: true }, (response) => {
                if (chrome.runtime.lastError) {
                    alert("Extension context invalidated. Please reload the page.");
                    resolve(false);
                    return;
                }
                if (response?.token) {
                    isGoogleAuthenticated = true;
                    renderCalendar();
                    resolve(true);
                } else {
                    if (response?.error) {
                        alert("Google Calendar Login Error:\n" + response.error + "\n\nPlease check your extension ID in manifest.json or Google Cloud Console settings.");
                    }
                    resolve(false);
                }
            });
        } catch (e) {
            alert("Extension error: " + e.message + "\nPlease reload the page.");
            resolve(false);
        }
    });
}

/**
 * Googleカレンダーからログアウト
 */
async function logoutFromGoogle() {
    return new Promise((resolve) => {
        try {
            chrome.runtime.sendMessage({ action: "googleCalendarLogout" }, (response) => {
                if (chrome.runtime.lastError) {
                    resolve(false);
                    return;
                }
                isGoogleAuthenticated = false;
                googleEventsCache = {};
                renderCalendar();
                resolve(response?.success || false);
            });
        } catch (e) {
            resolve(false);
        }
    });
}

/**
 * Googleカレンダーイベントを取得
 */
/**
 * 複数カレンダーのイベントを取得してマージ
 */
async function fetchMergedGoogleEvents(year, month) {
    const settings = loadCalendarSettings();
    const calendarIds = settings.selectedCalendars.length > 0 ? settings.selectedCalendars : ['primary'];
    const allEvents = [];
    const colors = settings.calendarColors || {};

    const promises = calendarIds.map(id => {
        return new Promise(resolve => {
            const cacheKey = `${year}_${month}_${id}`;
            // キャッシュロジックは簡易化のため省略し、常に取得する（または別で管理）
            // ここではfetchGoogleEventsをID付きで呼ぶ
            // fetchGoogleEvents関数をID受け入れ可能に拡張する必要があるが、
            // コード重複を避けるため直接shimする

            chrome.runtime.sendMessage({
                action: "fetchGoogleCalendarEvents",
                year: year,
                month: month,
                calendarId: id
            }, (response) => {
                if (!response?.error && response?.events) {
                    // 色情報を付与
                    const color = colors[id] || '#4285f4';
                    const events = response.events.map(e => ({ ...e, backgroundColor: color }));
                    resolve(events);
                } else {
                    if (response?.needsAuth) isGoogleAuthenticated = false;
                    resolve([]);
                }
            });
        });
    });

    const results = await Promise.all(promises);
    results.forEach(events => allEvents.push(...events));
    return allEvents;
}

/**
 * Googleカレンダーイベントを取得 (Legacy / Single)
 */
async function fetchGoogleEvents(year, month, calendarId = 'primary') {
    // ... existing implementation if needed or kept for compatibility
    // 今回はfetchMergedGoogleEventsを主に使用する
    return [];
}

/**
 * Googleイベントを日付ごとにグループ化
 */
function groupEventsByDate(events, year, month) {
    const grouped = {};
    events.forEach(event => {
        const startDate = new Date(event.start);
        if (startDate.getFullYear() === year && startDate.getMonth() === month) {
            const day = startDate.getDate();
            if (!grouped[day]) grouped[day] = [];
            grouped[day].push(event);
        }
        // 複数日にまたがるイベントの処理
        if (event.allDay && event.end) {
            const endDate = new Date(event.end);
            let current = new Date(startDate);
            current.setDate(current.getDate() + 1);
            while (current < endDate) {
                if (current.getFullYear() === year && current.getMonth() === month) {
                    const day = current.getDate();
                    if (!grouped[day]) grouped[day] = [];
                    if (!grouped[day].find(e => e.id === event.id)) {
                        grouped[day].push(event);
                    }
                }
                current.setDate(current.getDate() + 1);
            }
        }
    });
    return grouped;
}

/**
 * カレンダーをレンダリング
 */
async function renderCalendar() {
    const grid = document.getElementById('cal-grid');
    const eventList = document.getElementById('event-list');
    const now = new Date();

    const year = displayYear;
    const month = displayMonth;

    const months = [t('jan'), t('feb'), t('mar'), t('apr'), t('may'), t('jun'), t('jul'), t('aug'), t('sep'), t('oct'), t('nov'), t('dec')];
    const prefs = JSON.parse(localStorage.getItem('immersion_prefs')) || defaultSettings;

    // 月表示文字列の生成
    let myStr = `${months[month]} ${year}`;
    if (prefs.language === 'ja' || (!prefs.language && navigator.language.startsWith('ja'))) {
        myStr = `${year}年 ${months[month]}`;
    } else if (prefs.language === 'ko' || (!prefs.language && navigator.language.startsWith('ko'))) {
        myStr = `${year}년 ${months[month]}`;
    }

    document.getElementById('cal-month').innerText = myStr;



    // 曜日ヘッダー
    const days = [t('sun'), t('mon'), t('tue'), t('wed'), t('thu'), t('fri'), t('sat')];
    grid.innerHTML = days.map(w => `<div class="cal-head">${w}</div>`).join('');

    // 日付グリッドの生成
    const firstDay = new Date(year, month, 1).getDay();
    const lastDate = new Date(year, month + 1, 0).getDate();

    // Googleカレンダーイベントを取得
    let googleEvents = {};
    if (prefs.googleCalendarEnabled !== false && isGoogleAuthenticated) {
        const events = await fetchMergedGoogleEvents(year, month);
        googleEvents = groupEventsByDate(events, year, month);
    }

    // 月初までの空白セル
    for (let i = 0; i < firstDay; i++) {
        grid.innerHTML += `<div></div>`;
    }

    // 日付セル
    for (let d = 1; d <= lastDate; d++) {
        const cell = document.createElement('div');
        cell.className = 'cal-cell';
        cell.innerText = d;

        // 今日のハイライト（表示中の月が現在の月の場合のみ）
        if (d === now.getDate() && year === now.getFullYear() && month === now.getMonth()) {
            cell.classList.add('cal-today');
        }

        // ローカルイベントがある日のマーク
        const key = `event_${year}_${month}_${d}`;
        if (localStorage.getItem(key)) {
            cell.classList.add('cal-has-event');
        }

        // Googleカレンダーイベントがある日のマーク
        // Googleカレンダーイベントがある日のマーク
        if (googleEvents[d] && googleEvents[d].length > 0) {
            cell.classList.add('cal-has-google-event');
            // 色付きドットを表示 (最初のイベントの色を使用)
            const dotColor = googleEvents[d][0].backgroundColor || '#4285f4';
            cell.style.setProperty('--google-dot-color', dotColor);
        }

        // シングルクリックでスクロール、ダブルクリックで追加（常に新規扱い）
        cell.onclick = () => scrollToEvent(d);
        cell.ondblclick = () => openEventModal(year, month, d, true);

        grid.appendChild(cell);
    }

    // イベントリストの表示
    eventList.innerHTML = '';
    let hasEvent = false;

    // 自動スクロール用のターゲット
    const nowObj = new Date();
    const isCurrentMonth = (year === nowObj.getFullYear() && month === nowObj.getMonth());
    const todayDate = nowObj.getDate();
    let scrollTarget = null;

    // ローカルイベントとGoogleイベントを統合して表示
    for (let d = 1; d <= lastDate; d++) {
        const localKey = `event_${year}_${month}_${d}`;
        const localEvent = localStorage.getItem(localKey);
        const gEvents = googleEvents[d] || [];

        // ローカルイベント
        if (localEvent) {
            hasEvent = true;
            let text = localEvent;
            let timeHtml = '';

            // JSON形式かチェック（新形式）
            try {
                if (localEvent.startsWith('{')) {
                    const parsed = JSON.parse(localEvent);
                    text = parsed.text;
                    if (!parsed.allDay && parsed.time) {
                        timeHtml = `<span class="event-time">${parsed.time}</span>`;
                    }
                }
            } catch (e) {
                // 旧形式（文字列のみ）はそのまま
            }

            const r = document.createElement('div');
            r.className = 'event-row';
            r.setAttribute('data-date', d);
            r.innerHTML = `<span class="event-date-badge">${d}</span><span class="event-content">${timeHtml}${text}</span>`;
            r.onclick = () => openEventModal(year, month, d);
            eventList.appendChild(r);

            if (isCurrentMonth && d === todayDate && !scrollTarget) scrollTarget = r;
        }

        // Googleカレンダーイベント
        gEvents.forEach(event => {
            hasEvent = true;
            const r = document.createElement('div');
            r.className = 'event-row event-row-google';
            r.setAttribute('data-date', d);
            const timeStr = event.allDay ? '' : new Date(event.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const color = event.backgroundColor || '#4285f4';
            r.style.borderLeftColor = color;
            r.innerHTML = `<span class="event-date-badge event-badge-google" style="background:${color}">${d}</span><span class="event-content"><span class="google-icon">📅</span>${timeStr ? `<span class="event-time">${timeStr}</span>` : ''}${event.title}</span>`;
            eventList.appendChild(r);

            if (isCurrentMonth && d === todayDate && !scrollTarget) scrollTarget = r;
        });
    }

    // 今日の予定があればそこへスクロール
    if (scrollTarget) {
        setTimeout(() => {
            scrollTarget.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 300); // レンダリング完了とアニメーションを考慮して少し待つ
    }

    // Googleログインボタン または ログアウトボタン
    if (prefs.googleCalendarEnabled !== false) {
        const authArea = document.createElement('div');
        authArea.className = 'google-auth-area';

        if (!isGoogleAuthenticated) {
            authArea.innerHTML = `<button class="google-login-btn">${t('google_calendar_login')}</button>`;
            authArea.querySelector('.google-login-btn').onclick = loginToGoogle;
        } else {
            authArea.innerHTML = `<button class="google-logout-btn">${t('google_calendar_logout')}</button>`;
            authArea.querySelector('.google-logout-btn').onclick = logoutFromGoogle;
        }
        eventList.appendChild(authArea);
    }

    if (!hasEvent && (!prefs.googleCalendarEnabled || isGoogleAuthenticated)) {
        const noEventsDiv = document.createElement('div');
        noEventsDiv.style.cssText = 'opacity:0.5; font-size:0.8rem; text-align:center; padding:10px;';
        noEventsDiv.innerText = t('no_events');
        eventList.insertBefore(noEventsDiv, eventList.firstChild);
    }
}

/**
 * イベント編集モーダルを開く
 */
function openEventModal(year, month, day, isAddMode = false) {
    const modal = document.getElementById('event-modal');
    const input = document.getElementById('ev-input');
    const timeInput = document.getElementById('ev-time');
    const allDayInput = document.getElementById('ev-allday');
    const dateLabel = document.getElementById('ev-modal-date');
    const closeBtn = document.getElementById('close-event');
    const saveBtn = document.getElementById('ev-save');
    const delBtn = document.getElementById('ev-delete');

    currentEventKey = `event_${year}_${month}_${day}`;
    // 追加モードなら読み込まない、そうでなければ読み込む
    const currentVal = isAddMode ? "" : (localStorage.getItem(currentEventKey) || "");

    // データの読み込みとフォームへの設定
    let text = currentVal;
    let time = '';
    let allDay = false;

    try {
        if (currentVal.startsWith('{')) {
            const parsed = JSON.parse(currentVal);
            text = parsed.text || '';
            time = parsed.time || '';
            allDay = !!parsed.allDay;
        }
    } catch (e) {
        // 旧形式
    }

    dateLabel.innerText = t('date_modal_title', { month: month + 1, day: day });
    input.value = text;
    if (timeInput) timeInput.value = time;
    if (allDayInput) allDayInput.checked = allDay;

    modal.classList.add('show');
    input.focus();

    const close = () => modal.classList.remove('show');
    closeBtn.onclick = close;
    modal.onclick = (e) => { if (e.target === modal) close(); };

    saveBtn.onclick = () => {
        if (input.value) {
            const data = {
                text: input.value,
                time: timeInput ? timeInput.value : '',
                allDay: allDayInput ? allDayInput.checked : false
            };
            localStorage.setItem(currentEventKey, JSON.stringify(data));
        } else {
            localStorage.removeItem(currentEventKey);
        }
        renderCalendar();
        close();
    };

    delBtn.onclick = () => {
        localStorage.removeItem(currentEventKey);
        renderCalendar();
        close();
    };

    input.onkeydown = (e) => {
        if (e.key === 'Enter' && !e.isComposing) saveBtn.click();
    };
}

/**
 * 前月に移動
 */
function goToPrevMonth() {
    displayMonth--;
    if (displayMonth < 0) {
        displayMonth = 11;
        displayYear--;
    }
    renderCalendar();
}

/**
 * 次月に移動
 */
function goToNextMonth() {
    displayMonth++;
    if (displayMonth > 11) {
        displayMonth = 0;
        displayYear++;
    }
    renderCalendar();
}

/**
 * 今月に戻る
 */
function goToCurrentMonth() {
    const now = new Date();
    displayYear = now.getFullYear();
    displayMonth = now.getMonth();
    renderCalendar();
}

/**
 * カレンダー機能のセットアップ
 * @param {Function} translateFn - 翻訳関数
 */
export async function setupCalendar(translateFn) {
    console.log("setupCalendar called"); // Debug
    t = translateFn;

    // Google認証状態を確認
    await checkGoogleAuth();

    // ナビゲーションボタンの設定
    const prevBtn = document.getElementById('cal-prev-month');
    const nextBtn = document.getElementById('cal-next-month');
    const monthLabel = document.getElementById('cal-month');

    if (prevBtn) {
        prevBtn.onclick = goToPrevMonth;
    }

    if (nextBtn) {
        nextBtn.onclick = goToNextMonth;
    }

    // 月表示ラベルをクリックで今月に戻る
    if (monthLabel) {
        monthLabel.style.cursor = 'pointer';
        monthLabel.title = translateFn('go_to_current_month') || 'Go to current month';
        monthLabel.onclick = goToCurrentMonth;
    }

    // 設定ボタンの追加
    const calNav = document.querySelector('.cal-nav');
    if (calNav && !document.getElementById('cal-settings-btn')) {
        const btn = document.createElement('button');
        btn.id = 'cal-settings-btn';
        btn.className = 'cal-settings-btn';
        btn.innerHTML = '⚙️';
        btn.title = 'Calendar Settings';

        // 親のTiltエフェクトを防止するためにイベント伝播を止める
        btn.onmousemove = (e) => e.stopPropagation();
        btn.onmousedown = (e) => e.stopPropagation();

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            console.log("Settings button clicked");
            try {
                openCalendarSettingsModal();
            } catch (error) {
                console.error("Error opening calendar settings modal:", error);
            }
        });

        calNav.appendChild(btn);
    }

    // 初期レンダリング
    renderCalendar();
}

/**
 * イベントリストを指定日のイベントまでスクロール
 * @param {number} day - 対象の日付
 */
function scrollToEvent(day) {
    const list = document.getElementById('event-list');
    if (!list) return;

    let target = null;
    // その日以降のイベントを探す
    for (let d = day; d <= 31; d++) {
        target = list.querySelector(`.event-row[data-date="${d}"]`);
        if (target) break;
    }

    // もし未来になければ、一番近い過去を探す
    if (!target) {
        for (let d = day - 1; d >= 1; d--) {
            target = list.querySelector(`.event-row[data-date="${d}"]`);
            if (target) break;
        }
    }

    if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // ハイライトアニメーション
        target.animate([
            { backgroundColor: 'rgba(255, 255, 255, 0.2)' },
            { backgroundColor: 'transparent' }
        ], { duration: 1000 });
    }
}
