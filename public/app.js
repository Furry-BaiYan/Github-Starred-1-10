(() => {
  'use strict';

  const state = {
    items: [],
    fetchedAt: null,
    sourceLabel: 'GitHub.com 实时数据',
    rateLimit: null,
    query: '',
    language: '全部',
    sort: 'stars',
    loading: false,
    chatOpen: false,
    messages: [],
    unread: 0
  };

  const $ = (selector) => document.querySelector(selector);
  const elements = {
    leaderboard: $('#leaderboard'),
    refresh: $('#refresh-button'),
    sourceLabel: $('#source-label'),
    livePill: $('#live-pill'),
    totalStars: $('#total-stars'),
    leaderName: $('#leader-name'),
    leaderStars: $('#leader-stars'),
    fetchedTime: $('#fetched-time'),
    rateLimit: $('#rate-limit'),
    search: $('#search-input'),
    languages: $('#language-filters'),
    sort: $('#sort-select'),
    resultsCount: $('#results-count'),
    filterSummary: $('#filter-summary'),
    sseStatus: $('#sse-status'),
    chatDock: $('#chat-dock'),
    chatPanel: $('#chat-panel'),
    chatToggle: $('#chat-toggle'),
    chatClose: $('#chat-close'),
    chatMessages: $('#chat-messages'),
    chatForm: $('#chat-form'),
    chatInput: $('#chat-input'),
    chatSend: $('#chat-send'),
    unread: $('#unread-badge'),
    toastRegion: $('#toast-region')
  };

  const numberFormatter = new Intl.NumberFormat('en-US');
  const languageColors = {
    JavaScript: '#f1df55', TypeScript: '#4f8fc9', Python: '#4d84b5', Java: '#b07219',
    Go: '#65bdd3', Rust: '#d78455', C: '#78889a', 'C++': '#e46f92', 'C#': '#9a78cc',
    HTML: '#e34c26', CSS: '#654dca', Shell: '#89e051', Vue: '#41b883', Svelte: '#ff3e00',
    Ruby: '#a91401', PHP: '#777bb3', Swift: '#f05138', Kotlin: '#a97bff', Dart: '#00b4ab',
    Jupyter: '#da5b0b', 'Jupyter Notebook': '#da5b0b', Markdown: '#83a8bd', TeX: '#3d6117',
    Lua: '#6969d8', Zig: '#ec915c', Elixir: '#6e4a7e', Haskell: '#5e5086', Dockerfile: '#384d54'
  };

  function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[char]);
  }

  function safeExternalUrl(value, fallback = 'https://github.com') {
    try {
      const url = new URL(value || fallback);
      return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : fallback;
    } catch {
      return fallback;
    }
  }

  function formatNumber(value) {
    return numberFormatter.format(Number(value) || 0);
  }

  function formatRank(rank) {
    return String(rank).padStart(2, '0');
  }

  function formatTimestamp(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '时间未知';
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    }).format(date).replaceAll('/', '.');
  }

  function relativeTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '更新时间未知';
    const seconds = Math.round((date.getTime() - Date.now()) / 1000);
    const formatter = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' });
    const ranges = [
      ['year', 31536000], ['month', 2592000], ['day', 86400],
      ['hour', 3600], ['minute', 60]
    ];
    for (const [unit, size] of ranges) {
      if (Math.abs(seconds) >= size) return formatter.format(Math.round(seconds / size), unit);
    }
    return '刚刚更新';
  }

  function icon(name) {
    const icons = {
      fork: '<path d="M7 4v5m10-5v5M7 9c0 3 5 2 5 5m5-5c0 3-5 2-5 5v6"/><circle cx="7" cy="3" r="2"/><circle cx="17" cy="3" r="2"/><circle cx="12" cy="21" r="2"/>',
      issue: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 4h.01"/>',
      license: '<path d="M7 3h8l3 3v15H7zM15 3v4h4M10 11h5m-5 4h5"/>'
    };
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || ''}</svg>`;
  }

  function avatarMarkup(item) {
    const owner = item.owner || {};
    const initial = String(owner.login || item.name || 'G').charAt(0);
    return `<span class="avatar-wrap"><img class="avatar" src="${escapeHTML(safeExternalUrl(owner.avatarUrl, ''))}" alt="" loading="lazy" referrerpolicy="no-referrer"><span class="avatar-fallback" hidden>${escapeHTML(initial)}</span></span>`;
  }

  function topicsMarkup(item) {
    const topics = Array.isArray(item.topics) ? item.topics : [];
    if (!topics.length) return '<div class="topics"><span class="topic-pill">open-source</span></div>';
    return `<div class="topics">${topics.map((topic) => `<span class="topic-pill">#${escapeHTML(topic)}</span>`).join('')}</div>`;
  }

  function starVisualMarkup(item, maxStars) {
    const stars = Number(item.stars) || 0;
    const ratio = maxStars > 0 ? Math.max((stars / maxStars) * 100, 0.4) : 0;
    return `<div class="star-visual">
      <div class="star-visual-head"><span class="star-total">${formatNumber(stars)}<small>STARS</small></span><span class="star-ratio">${ratio.toFixed(1)}% / #01</span></div>
      <div class="star-track" role="img" aria-label="星标数为第一名的 ${ratio.toFixed(1)}%"><div class="star-fill" style="width:${ratio.toFixed(2)}%"></div></div>
    </div>`;
  }

  function statsMarkup(item) {
    return `<div class="repo-stats">
      <span class="stat">${icon('fork')}Fork <strong>${formatNumber(item.forks)}</strong></span>
      <span class="stat">${icon('issue')}Issues <strong>${formatNumber(item.openIssues)}</strong></span>
    </div>`;
  }

  function labelsMarkup(item) {
    const language = item.language || '多语言';
    const color = languageColors[language] || '#8da895';
    return `<div class="repo-labels"><span class="language-badge"><span class="language-dot" style="--language-color:${color}"></span>${escapeHTML(language)}</span><span class="license-badge">${escapeHTML(item.license || 'NO LICENSE')}</span></div>`;
  }

  function podiumCard(item, maxStars) {
    const url = safeExternalUrl(item.url);
    const owner = item.owner || {};
    return `<article class="repo-card podium-card rank-${item.rank}" data-rank="${formatRank(item.rank)}">
      <div class="card-top"><span class="rank-badge">RANK / ${formatRank(item.rank)}</span><a class="owner-mini" href="${escapeHTML(safeExternalUrl(owner.url))}" target="_blank" rel="noopener noreferrer" aria-label="在新标签页打开 ${escapeHTML(owner.login || '项目作者')} 的 GitHub 主页">${avatarMarkup(item)}<span>${escapeHTML(owner.login || 'GitHub')}</span></a></div>
      <div class="repo-heading"><a class="repo-name-link" href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer">${escapeHTML(item.name)}</a></div>
      <p class="repo-description">${escapeHTML(item.description || '这个开源项目暂未提供简介。')}</p>
      ${starVisualMarkup(item, maxStars)}
      ${statsMarkup(item)}
      <div class="repo-bottom">${labelsMarkup(item)}${topicsMarkup(item)}<div class="repo-labels" style="margin-top:12px"><span class="update-time" title="${escapeHTML(formatTimestamp(item.updatedAt))}">${escapeHTML(relativeTime(item.updatedAt))}</span><a class="direct-link" href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer">直达仓库 ↗</a></div></div>
    </article>`;
  }

  function listCard(item, maxStars) {
    const url = safeExternalUrl(item.url);
    const owner = item.owner || {};
    return `<article class="repo-card list-card rank-${item.rank}">
      <div class="list-rank">#${formatRank(item.rank)}<small>REPOSITORY</small></div>
      <div class="list-main">
        <div class="repo-heading"><a class="repo-name-link" href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer">${escapeHTML(item.name)}</a></div>
        <div class="list-owner-row"><a class="owner-mini" href="${escapeHTML(safeExternalUrl(owner.url))}" target="_blank" rel="noopener noreferrer">${avatarMarkup(item)}<span>${escapeHTML(owner.login || 'GitHub')}</span></a><span class="update-time" title="${escapeHTML(formatTimestamp(item.updatedAt))}">${escapeHTML(relativeTime(item.updatedAt))}</span><a class="direct-link" href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer">直达仓库 ↗</a></div>
        <p class="repo-description">${escapeHTML(item.description || '这个开源项目暂未提供简介。')}</p>
      </div>
      <div class="list-data">${starVisualMarkup(item, maxStars)}${statsMarkup(item)}<div class="repo-bottom">${labelsMarkup(item)}${topicsMarkup(item)}</div></div>
    </article>`;
  }

  function bindAvatarFallbacks() {
    elements.leaderboard.querySelectorAll('.avatar').forEach((image) => {
      image.addEventListener('error', () => {
        image.hidden = true;
        const fallback = image.nextElementSibling;
        if (fallback) fallback.hidden = false;
      }, { once: true });
    });
  }

  function filteredItems() {
    const needle = state.query.trim().toLocaleLowerCase();
    return state.items.filter((item) => {
      const matchesLanguage = state.language === '全部' || (item.language || '多语言') === state.language;
      const searchable = [item.name, item.fullName, item.description, item.owner?.login, item.language, ...(item.topics || [])].join(' ').toLocaleLowerCase();
      return matchesLanguage && (!needle || searchable.includes(needle));
    }).sort((a, b) => state.sort === 'forks'
      ? (Number(b.forks) || 0) - (Number(a.forks) || 0)
      : (Number(b.stars) || 0) - (Number(a.stars) || 0));
  }

  function renderLeaderboard() {
    const items = filteredItems();
    const maxStars = Math.max(...state.items.map((item) => Number(item.stars) || 0), 0);
    elements.resultsCount.textContent = `显示 ${items.length} / ${state.items.length} 个开源项目`;
    elements.filterSummary.textContent = state.sort === 'forks' ? 'SORTED BY FORKS' : 'SORTED BY STARS';
    elements.leaderboard.setAttribute('aria-busy', 'false');

    if (!items.length) {
      elements.leaderboard.innerHTML = '<div class="empty-state"><span class="empty-mark">[ ∅ ]</span><p>这片星域暂无匹配结果</p><small>TRY ANOTHER KEYWORD OR LANGUAGE</small></div>';
      return;
    }

    const podium = items.filter((item) => Number(item.rank) <= 3);
    const rest = items.filter((item) => Number(item.rank) > 3);
    let html = '';
    if (podium.length) html += `<div class="podium-grid">${podium.map((item) => podiumCard(item, maxStars)).join('')}</div>`;
    if (rest.length) html += `<div class="repository-list">${rest.map((item) => listCard(item, maxStars)).join('')}</div>`;
    elements.leaderboard.innerHTML = html;
    bindAvatarFallbacks();
  }

  function renderLanguages() {
    const languages = [...new Set(state.items.map((item) => item.language || '多语言'))].sort((a, b) => a.localeCompare(b));
    if (state.language !== '全部' && !languages.includes(state.language)) state.language = '全部';
    elements.languages.innerHTML = ['全部', ...languages].map((language) => `<button class="filter-pill${state.language === language ? ' active' : ''}" type="button" data-language="${escapeHTML(language)}" aria-pressed="${state.language === language}">${escapeHTML(language)}</button>`).join('');
  }

  function renderSummary() {
    const total = state.items.reduce((sum, item) => sum + (Number(item.stars) || 0), 0);
    const leader = [...state.items].sort((a, b) => b.stars - a.stars)[0];
    elements.totalStars.textContent = formatNumber(total);
    if (leader) {
      elements.leaderName.innerHTML = `${escapeHTML(leader.name)} <span>↗</span>`;
      elements.leaderName.href = safeExternalUrl(leader.url);
      elements.leaderName.setAttribute('aria-label', `在新标签页打开领航项目 ${leader.fullName || leader.name}`);
      elements.leaderStars.textContent = `${formatNumber(leader.stars)} STARS / RANK 01`;
    }
    elements.fetchedTime.textContent = formatTimestamp(state.fetchedAt);
    elements.fetchedTime.title = state.fetchedAt || '';
    const remaining = state.rateLimit?.remaining;
    const limit = state.rateLimit?.limit;
    elements.rateLimit.textContent = Number.isFinite(remaining) && Number.isFinite(limit)
      ? `API QUOTA ${remaining} / ${limit} REMAINING`
      : 'GITHUB LIVE TELEMETRY';
    elements.sourceLabel.textContent = state.sourceLabel || 'GitHub.com 实时数据';
    elements.livePill.classList.remove('error');
  }

  function applySnapshot(payload) {
    if (!payload || !Array.isArray(payload.items)) throw new Error('数据格式无效');
    state.items = payload.items;
    state.fetchedAt = payload.fetchedAt || new Date().toISOString();
    state.sourceLabel = payload.sourceLabel || 'GitHub.com 实时数据';
    state.rateLimit = payload.rateLimit || null;
    renderSummary();
    renderLanguages();
    renderLeaderboard();
  }

  function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast${type === 'error' ? ' error' : ''}`;
    toast.textContent = message;
    elements.toastRegion.append(toast);
    window.setTimeout(() => {
      toast.classList.add('leaving');
      window.setTimeout(() => toast.remove(), 220);
    }, 2800);
  }

  async function loadTop10(refresh = false) {
    if (state.loading) return;
    state.loading = true;
    elements.refresh.disabled = true;
    elements.refresh.classList.add('loading');
    elements.refresh.querySelector('span').textContent = refresh ? '同步星轨中' : '连接中';
    try {
      const response = await fetch(refresh ? '/api/top10?refresh=1' : '/api/top10', {
        headers: { Accept: 'application/json' }, cache: 'no-store'
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (!payload.ok) throw new Error(payload.error || '数据获取失败');
      applySnapshot(payload);
      if (refresh) showToast(`星轨已更新 · ${payload.items.length} 个项目完成同步`);
    } catch (error) {
      elements.livePill.classList.add('error');
      elements.sourceLabel.textContent = '数据连接异常';
      if (!state.items.length) {
        elements.leaderboard.innerHTML = `<div class="error-state"><span class="error-mark">[ ! ]</span><p>暂时无法连接观测数据源</p><small>${escapeHTML(error.message)} · PLEASE TRY AGAIN</small><button class="retry-button" id="retry-load" type="button">重新连接</button></div>`;
        elements.leaderboard.setAttribute('aria-busy', 'false');
        $('#retry-load')?.addEventListener('click', () => loadTop10(false));
      }
      showToast(refresh ? '刷新失败，请稍后重试' : '数据同步失败，请重新连接', 'error');
    } finally {
      state.loading = false;
      elements.refresh.disabled = false;
      elements.refresh.classList.remove('loading');
      elements.refresh.querySelector('span').textContent = '实时刷新';
    }
  }

  function normalizeMessage(message, index = 0) {
    if (typeof message === 'string') return { role: 'assistant', text: message, id: `remote-${index}` };
    const roleValue = String(message.role || message.sender || message.from || message.source || 'assistant').toLowerCase();
    const isUser = ['user', 'web', 'human', 'cli', 'cmd', 'client'].some((role) => roleValue.includes(role));
    return {
      role: isUser ? 'user' : 'assistant',
      text: String(message.text ?? message.message ?? message.content ?? message.reply ?? ''),
      time: message.createdAt || message.timestamp || message.time,
      id: message.id ?? `${message.createdAt || message.timestamp || 'message'}-${index}`
    };
  }

  function messageSourceLabel(message) {
    return message.role === 'user' ? 'YOU / TERMINAL' : 'OBSERVATORY AI';
  }

  function renderChat() {
    const wasNearBottom = elements.chatMessages.scrollHeight - elements.chatMessages.scrollTop - elements.chatMessages.clientHeight < 80;
    if (!state.messages.length) {
      elements.chatMessages.innerHTML = '<div class="chat-empty"><span class="chat-empty-mark">›_</span><p>与终端保持同一频道</p><small>询问排行榜，或查看来自 CMD 的消息。</small></div>';
      return;
    }
    elements.chatMessages.innerHTML = state.messages.map((message) => {
      const normalized = normalizeMessage(message);
      if (!normalized.text) return '';
      return `<div class="chat-message ${normalized.role}"><div class="message-meta"><span class="message-author">${messageSourceLabel(normalized)}</span>${normalized.time ? `<span>${escapeHTML(formatTimestamp(normalized.time).split(' ').pop())}</span>` : ''}</div><div class="message-bubble">${escapeHTML(normalized.text)}</div></div>`;
    }).join('');
    if (wasNearBottom || state.chatOpen) elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
  }

  function updateUnread() {
    elements.unread.hidden = state.unread === 0 || state.chatOpen;
    elements.unread.textContent = state.unread > 99 ? '99+' : String(state.unread);
  }

  function setChatOpen(open) {
    state.chatOpen = open;
    elements.chatPanel.hidden = !open;
    elements.chatDock.classList.toggle('open', open);
    elements.chatToggle.setAttribute('aria-expanded', String(open));
    if (open) {
      state.unread = 0;
      updateUnread();
      window.setTimeout(() => elements.chatInput.focus(), 60);
      renderChat();
    }
  }

  async function loadChat() {
    try {
      const response = await fetch('/api/chat', { headers: { Accept: 'application/json' }, cache: 'no-store' });
      if (!response.ok) return;
      const payload = await response.json();
      if (Array.isArray(payload.messages)) {
        state.messages = payload.messages;
        renderChat();
      }
    } catch {
      // Leaderboard remains fully functional if chat history is unavailable.
    }
  }

  async function sendChat(event) {
    event.preventDefault();
    const text = elements.chatInput.value.trim();
    if (!text || elements.chatSend.disabled) return;
    elements.chatSend.disabled = true;
    elements.chatInput.disabled = true;
    try {
      const response = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ text })
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (!payload.ok) throw new Error(payload.error || '发送失败');
      if (Array.isArray(payload.messages)) state.messages = payload.messages;
      else if (payload.reply) state.messages.push({ role: 'user', text }, { role: 'assistant', text: payload.reply });
      elements.chatInput.value = '';
      renderChat();
    } catch (error) {
      showToast(`消息未发送 · ${error.message}`, 'error');
    } finally {
      elements.chatSend.disabled = false;
      elements.chatInput.disabled = false;
      if (state.chatOpen) elements.chatInput.focus();
    }
  }

  function connectEvents() {
    if (!('EventSource' in window)) {
      elements.sseStatus.textContent = '当前浏览器不支持实时事件流';
      return;
    }
    const events = new EventSource('/api/events');
    events.addEventListener('open', () => { elements.sseStatus.textContent = '实时事件流已连接'; });
    events.addEventListener('top10', (event) => {
      try {
        const payload = JSON.parse(event.data);
        applySnapshot(payload.data || payload);
        showToast('收到实时观测 · 排行榜已同步');
      } catch {
        showToast('收到无效的实时排行榜数据', 'error');
      }
    });
    events.addEventListener('chat', (event) => {
      try {
        const payload = JSON.parse(event.data);
        const previousCount = state.messages.length;
        if (Array.isArray(payload.messages)) state.messages = payload.messages;
        else if (Array.isArray(payload.data?.messages)) state.messages = payload.data.messages;
        else {
          const message = payload.message || payload.data || payload;
          if (message && typeof message === 'object') state.messages.push(message);
        }
        if (!state.chatOpen && state.messages.length > previousCount) state.unread += state.messages.length - previousCount;
        updateUnread();
        renderChat();
      } catch {
        // Ignore malformed auxiliary chat events without affecting the leaderboard.
      }
    });
    events.addEventListener('error', () => { elements.sseStatus.textContent = '实时事件流重连中'; });
  }

  elements.refresh.addEventListener('click', () => loadTop10(true));
  elements.search.addEventListener('input', (event) => {
    state.query = event.target.value;
    renderLeaderboard();
  });
  elements.sort.addEventListener('change', (event) => {
    state.sort = event.target.value;
    renderLeaderboard();
  });
  elements.languages.addEventListener('click', (event) => {
    const button = event.target.closest('[data-language]');
    if (!button) return;
    state.language = button.dataset.language;
    elements.languages.querySelectorAll('.filter-pill').forEach((pill) => {
      const active = pill === button;
      pill.classList.toggle('active', active);
      pill.setAttribute('aria-pressed', String(active));
    });
    renderLeaderboard();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
      event.preventDefault();
      elements.search.focus();
    }
    if (event.key === 'Escape' && state.chatOpen) setChatOpen(false);
  });
  elements.chatToggle.addEventListener('click', () => setChatOpen(!state.chatOpen));
  elements.chatClose.addEventListener('click', () => setChatOpen(false));
  elements.chatForm.addEventListener('submit', sendChat);

  renderChat();
  loadTop10();
  loadChat();
  connectEvents();
})();
