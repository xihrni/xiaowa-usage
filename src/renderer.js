const state = { data: null, selectedId: null, locked: false, expanded: false, tab: 'current', previousCredits: null, petMode: 'greeting', dateRange: null, sessionPage: 1, requestPage: 1, requestSessionId: '__all__' };
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const fmt = (value, digits = 0) => Number(value || 0).toLocaleString('zh-CN', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
const credit = value => fmt(value, 2);
const token = value => Number(value || 0) >= 10000 ? `${fmt(Number(value || 0) / 1000, 1)}K` : fmt(value);
const time = value => value ? new Date(Number(value)).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '--';
const metric = (label, value, cls = '', note = '') => `<div class="metric"><span>${label}</span><strong class="${cls}">${value}</strong>${note ? `<small>${note}</small>` : ''}</div>`;

const ALL_SESSIONS = '__all__';
const emptyStats = () => ({ credits: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedTokens: 0, reasoningTokens: 0, requests: 0 });
const dayString = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const inSelectedRange = day => !state.dateRange || (day >= state.dateRange.start && day <= state.dateRange.end);

function filteredSessions() {
  if (!state.data) return [];
  if (!state.dateRange) return state.data.sessions;
  return state.data.sessions.map(session => {
    const requests = session.requests.filter(request => inSelectedRange(request.day));
    const metrics = emptyStats();
    for (const request of requests) {
      metrics.credits += request.credits || 0;
      metrics.inputTokens += request.inputTokens || 0;
      metrics.outputTokens += request.outputTokens || 0;
      metrics.totalTokens += request.totalTokens || 0;
      metrics.cachedTokens += request.cachedTokens || 0;
      metrics.reasoningTokens += request.reasoningTokens || 0;
      metrics.requests += 1;
    }
    if (inSelectedRange(session.unlinkedDay)) metrics.credits += session.unlinkedCredits || 0;
    return { ...session, requests, metrics };
  });
}

function aggregateStats(sessions) {
  return sessions.reduce((total, session) => {
    for (const key of Object.keys(total)) total[key] += Number(session.metrics[key] || 0);
    return total;
  }, emptyStats());
}

function selectedSession() {
  if (!state.data) return null;
  if (state.selectedId === ALL_SESSIONS) {
    const sessions = state.data.sessions;
    const metrics = {};
    for (const key of ['credits', 'inputTokens', 'outputTokens', 'totalTokens', 'cachedTokens', 'reasoningTokens', 'requests']) {
      metrics[key] = sessions.reduce((sum, s) => sum + Number(s.metrics[key] || 0), 0);
    }
    return {
      id: ALL_SESSIONS,
      title: '全部会话',
      status: `${sessions.length} 个会话`,
      metrics,
      used: sessions.reduce((sum, s) => sum + s.used, 0),
      size: sessions.reduce((sum, s) => sum + s.size, 0),
      requests: sessions.flatMap(s => s.requests.map(r => ({ ...r, sessionTitle: s.title, model: r.model || s.model }))).sort((a, b) => b.timestamp - a.timestamp)
    };
  }
  const sessions = state.data.sessions;
  return sessions.find(s => s.id === state.selectedId) || sessions[0];
}

const taskState = { initialized: false, active: new Map(), foregroundId: null, phase: 'hidden', timer: null, callback: null, remaining: 0, startedAt: 0, batch: null };
const isWorking = session => ['working', 'running', 'processing'].includes(String(session?.status || '').toLowerCase());
const outcomeFor = session => {
  const status = String(session?.status || '').toLowerCase();
  if (['error', 'failed', 'failure'].includes(status)) return 'failed';
  if (['cancelled', 'canceled', 'stopped'].includes(status)) return 'canceled';
  return 'completed';
};
const isDnd = () => {
  if (!savedSettings.dndEnabled) return false;
  const [sh, sm] = savedSettings.dndStart.split(':').map(Number);
  const [eh, em] = savedSettings.dndEnd.split(':').map(Number);
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  const start = sh * 60 + sm;
  const end = eh * 60 + em;
  return start === end ? true : (start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end);
};

function clearBubbleTimer() {
  clearTimeout(taskState.timer);
  taskState.timer = null;
  taskState.callback = null;
}

function scheduleBubble(callback, duration) {
  clearBubbleTimer();
  taskState.callback = callback;
  taskState.remaining = duration;
  taskState.startedAt = Date.now();
  taskState.timer = setTimeout(() => {
    const run = taskState.callback;
    clearBubbleTimer();
    run?.();
  }, duration);
}

function playCompletionSound() {
  if (!savedSettings.soundEnabled || isDnd()) return;
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const context = new AudioContext();
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.055, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.28);
    gain.connect(context.destination);
    for (const [index, frequency] of [660, 880].entries()) {
      const oscillator = context.createOscillator();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      oscillator.connect(gain);
      oscillator.start(context.currentTime + index * 0.1);
      oscillator.stop(context.currentTime + 0.28);
    }
    setTimeout(() => context.close(), 400);
  } catch {}
}

function taskDelta(item) {
  return {
    credits: Math.max(0, item.session.metrics.credits - Number(item.baseline?.credits || 0)),
    tokens: Math.max(0, item.session.metrics.totalTokens - Number(item.baseline?.totalTokens || 0))
  };
}

function paintStats(items) {
  if (welcomeActive) return;
  const first = items[0]?.session;
  if (!first) return hideBubble();
  taskState.phase = 'stats';
  const bubble = $('#petBubble');
  bubble.className = 'pet-bubble visible stats';
  bubble.dataset.session = items.length === 1 ? first.id : ALL_SESSIONS;
  $('#activeTitle').textContent = items.length === 1 ? first.title : `${items.length} 个任务用量统计`;
  $('#activeTitle').title = items.map(item => item.session.title).join('、');
  const totals = items.reduce((sum, item) => {
    const delta = taskDelta(item);
    sum.credits += delta.credits;
    sum.tokens += delta.tokens;
    return sum;
  }, { credits: 0, tokens: 0 });
  $('#petCredits').textContent = `+${credit(totals.credits)}`;
  $('#petToday').textContent = token(totals.tokens);
  $('#petTokens').textContent = items.length === 1
    ? `会话累计 ${credit(first.metrics.credits)} 积分 · ${token(first.metrics.totalTokens)} Tokens`
    : `已合并 ${items.length} 个任务的本次消耗`;
}

function paintBatch() {
  if (welcomeActive) return;
  const batch = taskState.batch;
  if (!batch?.items.length) return hideBubble();
  const items = batch.items;
  const failed = items.some(item => item.outcome === 'failed');
  const canceled = !failed && items.every(item => item.outcome === 'canceled');
  const phase = failed ? 'failed' : canceled ? 'canceled' : 'completed';
  taskState.phase = phase;
  const bubble = $('#petBubble');
  bubble.className = `pet-bubble visible ${phase}`;
  bubble.dataset.session = items.length === 1 ? items[0].session.id : ALL_SESSIONS;
  const title = failed ? (items.length > 1 ? `${items.length} 个任务处理中断` : '任务处理中断') : canceled ? '任务已停止' : (items.length > 1 ? `${items.length} 个任务已处理完成` : '任务已处理完成');
  $('#activeTitle').textContent = title;
  $('#activeTitle').title = items.map(item => item.session.title).join('、');
  $('#bubbleMessage').textContent = items.length === 1 ? items[0].session.title : items.map(item => item.session.title).join('、');
}

function hideBubble() {
  clearBubbleTimer();
  taskState.phase = 'hidden';
  taskState.batch = null;
  $('#petBubble').className = 'pet-bubble';
  setPetMode(taskState.active.size ? 'working' : 'idle');
}

let welcomeTimer = null;
let welcomeActive = false;
function greetingForNow() {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 9) return { title: '早上好，主人！', message: '新的一天，也一起加油吧。' };
  if (hour >= 9 && hour < 12) return { title: '上午好，主人。', message: '先看看今天的用量吧。' };
  if (hour >= 12 && hour < 14) return { title: '中午好，主人。', message: '记得吃饭和休息一下。' };
  if (hour >= 14 && hour < 18) return { title: '下午好，主人。', message: '小哇陪你把事情做完。' };
  if (hour >= 18 && hour < 23) return { title: '晚上好，主人。', message: '今天辛苦啦，看看今天的收获吧。' };
  return { title: '夜深了，主人。', message: '注意休息，小哇明天再陪你。' };
}

function showWelcomeGreeting() {
  if (welcomeActive) return;
  const greeting = greetingForNow();
  const bubble = $('#petBubble');
  clearBubbleTimer();
  clearTimeout(welcomeTimer);
  welcomeActive = true;
  bubble.className = 'pet-bubble visible welcome';
  bubble.dataset.session = '';
  $('#activeTitle').textContent = greeting.title;
  $('#activeTitle').title = greeting.title;
  $('#bubbleMessage').textContent = greeting.message;
  setPetMode('greeting');
  welcomeTimer = setTimeout(() => {
    welcomeActive = false;
    if (bubble.classList.contains('welcome')) bubble.className = 'pet-bubble';
    setPetMode(taskState.active.size ? 'working' : 'idle');
  }, 5000);
}

const PAT_ACTIONS = [
  {
    id: 'gentle',
    src: '../assets/pat-animation.webp',
    duration: 2268,
    messages: [
      { title: '喵～', message: '再摸一下嘛' },
      { title: '嘿嘿', message: '好舒服呀' },
      { title: '收到摸摸头', message: '主人今天也要顺利' },
      { title: '呼噜呼噜…', message: '再摸就要融化啦' },
      { title: '耳朵好痒', message: '但可以再摸一下' },
      { title: '小哇很开心', message: '今天也陪着你' }
    ]
  },
  {
    id: 'happy',
    src: '../assets/action-happy.webp',
    duration: 2016,
    messages: [
      { title: '开心到跳起来', message: '嘿嘿，今天运气不错' },
      { title: '小哇蹦给你看', message: '接住我呀' },
      { title: '充满电啦', message: '又可以继续陪你' },
      { title: '蹦蹦跳跳', message: '今天的烦恼都弹走' },
      { title: '转个圈', message: '继续加油呀' }
    ]
  },
  {
    id: 'shy',
    src: '../assets/action-shy.webp',
    duration: 2016,
    messages: [
      { title: '诶…别一直摸啦', message: '脸有点热' },
      { title: '耳朵都软了', message: '再摸就害羞了' },
      { title: '主人，看别处啦', message: '这样太犯规了' },
      { title: '捂住脸', message: '但可以再来一下' },
      { title: '小哇不好意思', message: '尾巴都藏不住' }
    ]
  }
];
let patActive = false;
let patCooldownUntil = 0;
let patTimer = null;
let lastActionIndex = -1;

function showPetOverlay(title, message, duration, onHide) {
  clearTimeout(patTimer);
  $('#patBubbleTitle').textContent = title;
  $('#patBubbleMessage').textContent = message;
  $('#patBubble').classList.add('visible');
  patTimer = setTimeout(() => {
    $('#patBubble').classList.remove('visible');
    if (onHide) onHide();
  }, duration);
}

function spawnPetHearts() {
  const container = $('#petHearts');
  container.innerHTML = '';
  for (let i = 0; i < 4; i++) {
    const heart = document.createElement('span');
    heart.className = 'pet-heart';
    heart.textContent = '♥';
    heart.style.left = `${18 + Math.random() * 64}%`;
    heart.style.fontSize = `${14 + Math.random() * 7}px`;
    heart.style.animationDelay = `${i * 90}ms`;
    container.appendChild(heart);
  }
}

function patPet() {
  const now = Date.now();
  if (patActive || now < patCooldownUntil) return;
  patActive = true;
  const stage = $('#petStage');
  const animation = $('#patAnimation');
  const previousMode = state.petMode;
  let actionIndex = Math.floor(Math.random() * PAT_ACTIONS.length);
  if (PAT_ACTIONS.length > 1 && actionIndex === lastActionIndex) actionIndex = (actionIndex + 1) % PAT_ACTIONS.length;
  lastActionIndex = actionIndex;
  const action = PAT_ACTIONS[actionIndex];
  let messageIndex = Math.floor(Math.random() * action.messages.length);
  if (action.messages.length > 1 && messageIndex === action.lastMessageIndex) messageIndex = (messageIndex + 1) % action.messages.length;
  action.lastMessageIndex = messageIndex;
  const reaction = action.messages[messageIndex];
  const restoreMode = () => {
    if (taskState.active.size) return 'working';
    if (previousMode === 'greeting' && !welcomeActive) return 'idle';
    return previousMode;
  };
  setPetMode('greeting', true);
  stage.classList.remove('returning');
  stage.classList.add('patting', 'animating');
  animation.style.display = 'block';
  animation.classList.remove('visible');
  animation.removeAttribute('src');
  void animation.offsetWidth;
  animation.src = action.src;
  animation.classList.add('visible');
  spawnPetHearts();
  let animationDone = false;
  const finishAnimation = () => {
    if (animationDone) return;
    animationDone = true;
    animation.onerror = null;
    setPetMode(restoreMode(), true);
    stage.classList.remove('animating');
    stage.classList.add('returning');
    animation.classList.remove('visible');
    animation.style.display = 'none';
    setTimeout(() => {
          stage.classList.remove('returning');
      animation.removeAttribute('src');
    }, 380);
  };
  const animationTimer = setTimeout(finishAnimation, action.duration);
  animation.onerror = () => {
    clearTimeout(animationTimer);
    finishAnimation();
  };
  showPetOverlay(reaction.title, reaction.message, action.duration + 570, () => {
    patActive = false;
    patCooldownUntil = Date.now() + 700;
    stage.classList.remove('patting', 'animating', 'returning');
    animation.classList.remove('visible');
    animation.style.display = 'none';
    animation.removeAttribute('src');
    $('#petHearts').innerHTML = '';
    setPetMode(restoreMode(), true);
  });
}

function showPetNotice(notice = {}) {
  if (patActive) return;
  showPetOverlay(notice.title || '小哇', notice.message || '暂时无法完成操作。', 4200);
}

function showTaskStats(sessionOrItems) {
  const items = Array.isArray(sessionOrItems)
    ? sessionOrItems
    : [{ session: sessionOrItems, baseline: taskState.active.get(sessionOrItems?.id)?.baseline, outcome: outcomeFor(sessionOrItems) }];
  if (!items[0]?.session || !savedSettings.statsEnabled || isDnd()) return hideBubble();
  paintStats(items);
  setPetMode(taskState.active.size ? 'working' : 'idle');
  scheduleBubble(hideBubble, savedSettings.statsDuration);
}

function showBatchStats() {
  if (taskState.batch) showTaskStats(taskState.batch.items);
}

function queueCompletion(session, outcome, baseline) {
  if (!session || isDnd()) return;
  const now = Date.now();
  if (!taskState.batch || now - taskState.batch.startedAt > 2000) {
    taskState.batch = { startedAt: now, items: [] };
    if (outcome === 'completed') playCompletionSound();
  }
  taskState.batch.items.push({ session, outcome, baseline });
  setPetMode(outcome === 'completed' ? 'completed' : (taskState.active.size ? 'working' : 'idle'));
  if (!savedSettings.completionEnabled) return showBatchStats();
  paintBatch();
  scheduleBubble(showBatchStats, savedSettings.completionDuration);
}

function beginForeground(session) {
  clearBubbleTimer();
  taskState.batch = null;
  taskState.foregroundId = session.id;
  setPetMode('working');
  if (!savedSettings.processingEnabled || isDnd()) {
    taskState.phase = 'hidden';
    if (!welcomeActive) $('#petBubble').className = 'pet-bubble';
    return;
  }
  taskState.phase = 'waiting';
  scheduleBubble(() => {
    if (welcomeActive || taskState.foregroundId !== session.id || isDnd()) return;
    taskState.phase = 'processing';
    const bubble = $('#petBubble');
    bubble.className = 'pet-bubble visible processing';
    bubble.dataset.session = session.id;
    $('#activeTitle').textContent = session.title;
    $('#activeTitle').title = session.title;
    $('#bubbleMessage').textContent = `正在处理「${session.title}」…`;
    }, savedSettings.processingDelay);
}

function syncTaskBubble(data) {
  const working = data.sessions.filter(isWorking).sort((a, b) => b.updatedAt - a.updatedAt);
  const workingIds = new Set(working.map(s => s.id));
  const foreground = working[0] || null;
  for (const session of working) {
    if (!taskState.active.has(session.id)) {
      taskState.active.set(session.id, {
        baseline: { credits: session.metrics.credits, totalTokens: session.metrics.totalTokens, requestIds: new Set(session.requests.map(r => r.requestId)) },
        foreground: session.id === foreground?.id
      });
    }
    const tracked = taskState.active.get(session.id);
    tracked.foreground = session.id === foreground?.id;
  }
  if (taskState.initialized) {
    for (const [id, tracked] of [...taskState.active]) {
      if (workingIds.has(id)) continue;
      taskState.active.delete(id);
      const session = data.sessions.find(s => s.id === id);
      if (tracked.foreground || savedSettings.backgroundNotifications) queueCompletion(session, outcomeFor(session), tracked.baseline);
    }
  }
  taskState.initialized = true;
  if (foreground) {
    if (foreground.id !== taskState.foregroundId || (taskState.phase === 'hidden' && !taskState.timer)) beginForeground(foreground);
  } else {
    taskState.foregroundId = null;
    if (!taskState.batch && !taskState.active.size && taskState.phase === 'processing') hideBubble();
  }
}

function setPetMode(mode, instant = false) {
  if (state.petMode === mode) return;
  state.petMode = mode;
  const image = $('#petImage');
  if (instant) {
    image.style.opacity = '1';
    image.src = `../assets/${mode}.png`;
    return;
  }
  image.style.opacity = '.25';
  setTimeout(() => { image.src = `../assets/${mode}.png`; image.style.opacity = '1'; }, 130);
}

function renderPet() {
  if (taskState.phase === 'stats' && taskState.batch?.items.length) paintStats(taskState.batch.items);
}

function renderCurrent() {
  const session = selectedSession();
  if (!session) return;
  $('#currentMetrics').innerHTML = [
    metric('会话积分', credit(session.metrics.credits), 'teal'),
    metric('累计总 Token', token(session.metrics.totalTokens)),
    metric('模型请求', fmt(session.metrics.requests), '', '次')
  ].join('');
  const percent = session.size ? Math.min(100, session.used / session.size * 100) : 0;
  $('#contextUsage').innerHTML = `<div class="context-number"><span>已使用 ${token(session.used)} / ${token(session.size)}</span><strong>${fmt(percent, 1)}%</strong></div><div class="progress"><i style="width:${percent}%"></i></div><div class="break-row"><span>该数值为上下文占用，不是积分或累计 Token</span></div>`;
  const m = session.metrics;
  $('#tokenBreakdown').innerHTML = `<div class="break-row"><span>输入 Token</span><strong>${token(m.inputTokens)}</strong></div><div class="break-row"><span>输出 Token</span><strong>${token(m.outputTokens)}</strong></div><div class="break-row"><span>缓存命中</span><strong>${token(m.cachedTokens)}</strong></div><div class="break-row"><span>推理 Token</span><strong>${token(m.reasoningTokens)}</strong></div>`;
  $('#recentRequests').innerHTML = session.requests.slice(0, 5).map(request => `<div class="list-row"><div><span class="truncate">${time(request.timestamp)} · ${esc(request.model || session.model || '未知模型')}</span><small>${token(request.totalTokens)} Tokens</small></div><strong>${credit(request.credits)} 积分</strong></div>`).join('') || '<div class="list-row"><span>当前日期区间暂无请求</span></div>';
}

function renderToday() {
  const today = dayString(new Date());
  const sessions = state.data.sessions.map(session => {
    const requests = session.requests.filter(request => request.day === today);
    const metrics = emptyStats();
    for (const request of requests) {
      for (const key of ['credits', 'inputTokens', 'outputTokens', 'totalTokens', 'cachedTokens', 'reasoningTokens']) metrics[key] += request[key] || 0;
      metrics.requests += 1;
    }
    if (session.unlinkedDay === today) metrics.credits += session.unlinkedCredits || 0;
    return { ...session, requests, metrics };
  }).filter(session => session.metrics.requests || session.metrics.credits).sort((a, b) => b.metrics.credits - a.metrics.credits);
  const m = aggregateStats(sessions);
  $('.hero-metric>span').textContent = '今日累计消耗';
  $('#todaySessionsTitle').textContent = '今日活跃会话';
  $('#todayCredits').textContent = credit(m.credits);
  $('#todayMetrics').innerHTML = [metric('总 Token', token(m.totalTokens)), metric('输入 Token', token(m.inputTokens)), metric('输出 Token', token(m.outputTokens)), metric('模型请求', fmt(m.requests), '', '次')].join('');
  $('#todaySessions').innerHTML = sessions.length ? sessions.map(s => `<div class="list-row"><div><span class="truncate">${esc(s.title)}</span><small>${s.metrics.requests} 次请求</small></div><strong>${credit(s.metrics.credits)} 积分</strong></div>`).join('') : '<div class="list-row"><span>今日暂无请求记录</span></div>';
  const models = new Map();
  for (const session of sessions) for (const request of session.requests) {
    const name = request.model || session.model || '未知模型';
    if (!models.has(name)) models.set(name, { credits: 0, tokens: 0, requests: 0 });
    const row = models.get(name);
    row.credits += request.credits || 0;
    row.tokens += request.totalTokens || 0;
    row.requests += 1;
  }
  $('#todayModels').innerHTML = [...models.entries()].sort((a, b) => b[1].credits - a[1].credits).map(([name, row]) => `<div class="list-row"><div><span class="truncate">${esc(name)}</span><small>${token(row.tokens)} Tokens · ${row.requests} 次</small></div><strong>${credit(row.credits)}</strong></div>`).join('') || '<div class="list-row"><span>暂无模型数据</span></div>';
  $('#todayTokenBreakdown').innerHTML = `<div class="break-row"><span>缓存命中</span><strong>${token(m.cachedTokens)}</strong></div><div class="break-row"><span>推理 Token</span><strong>${token(m.reasoningTokens)}</strong></div><div class="break-row"><span>输出占比</span><strong>${fmt(m.totalTokens ? m.outputTokens / m.totalTokens * 100 : 0, 1)}%</strong></div>`;
}

function renderAllSessions() {
  const allSessions = filteredSessions();
  const sessions = state.dateRange ? allSessions.filter(s => s.requests.length || s.metrics.credits) : allSessions;
  const m = aggregateStats(sessions);
  $('#allMetrics').innerHTML = [metric('全部积分', credit(m.credits), 'teal'), metric('全部 Token', token(m.totalTokens)), metric('模型请求', fmt(m.requests), '', '次'), metric('会话数量', fmt(sessions.length), '', '个')].join('');
  $('#allTokenBreakdown').innerHTML = `<div class="break-row"><span>输入 Token</span><strong>${token(m.inputTokens)}</strong></div><div class="break-row"><span>输出 Token</span><strong>${token(m.outputTokens)}</strong></div><div class="break-row"><span>缓存命中</span><strong>${token(m.cachedTokens)}</strong></div><div class="break-row"><span>推理 Token</span><strong>${token(m.reasoningTokens)}</strong></div>`;
  const usedSessions = sessions.filter(s => s.metrics.credits || s.metrics.totalTokens).length;
  const models = new Set(sessions.flatMap(s => s.requests.map(r => r.model || s.model || '未知模型')));
  $('#allSessionSummary').innerHTML = `<div class="list-row"><span>有用量记录会话</span><strong>${usedSessions} 个</strong></div><div class="list-row"><span>平均每会话积分</span><strong>${credit(usedSessions ? m.credits / usedSessions : 0)}</strong></div><div class="list-row"><span>已使用模型</span><strong>${models.size} 个</strong></div>`;
}

function renderTrends() {
  const sessions = filteredSessions();
  const daily = new Map();
  const models = new Map();
  for (const session of sessions) for (const request of session.requests) {
    if (!daily.has(request.day)) daily.set(request.day, emptyStats());
    const day = daily.get(request.day);
    for (const key of ['credits', 'inputTokens', 'outputTokens', 'totalTokens', 'cachedTokens', 'reasoningTokens']) day[key] += request[key] || 0;
    day.requests += 1;
    const name = request.model || session.model || '未知模型';
    if (!models.has(name)) models.set(name, emptyStats());
    const model = models.get(name);
    for (const key of ['credits', 'inputTokens', 'outputTokens', 'totalTokens', 'cachedTokens', 'reasoningTokens']) model[key] += request[key] || 0;
    model.requests += 1;
  }
  let rows = [...daily.entries()].map(([day, metrics]) => ({ day, ...metrics })).sort((a, b) => a.day.localeCompare(b.day));
  if (!state.dateRange) rows = rows.slice(-14);
  const max = Math.max(...rows.map(r => r.credits), 1);
  $('#dailyChartTitle').textContent = state.dateRange ? '区间每日积分' : '近 14 天积分';
  $('#dailyChart').classList.toggle('dense', rows.length > 14);
  $('#dailyChart').innerHTML = rows.length ? rows.map(r => `<div class="bar-item" title="${r.day}：${credit(r.credits)} 积分"><strong>${credit(r.credits)}</strong><i style="height:${Math.max(2, r.credits / max * 82)}%"></i><span>${r.day.slice(5)}</span></div>`).join('') : '<span>当前日期区间暂无数据</span>';
  $('#modelStats').innerHTML = [...models.entries()].map(([model, metrics]) => ({ model, ...metrics })).sort((a, b) => b.credits - a.credits).map(m => `<div class="list-row"><div><span class="truncate">${esc(m.model)}</span><small>${token(m.totalTokens)} Tokens · ${m.requests} 次</small></div><strong>${credit(m.credits)}</strong></div>`).join('') || '<div class="list-row"><span>暂无模型数据</span></div>';
  const total = aggregateStats(sessions);
  const activeDays = daily.size;
  $('#trendSummary').innerHTML = [metric('区间积分', credit(total.credits), 'teal'), metric('活跃天数', fmt(activeDays), '', '天'), metric('日均积分', credit(activeDays ? total.credits / activeDays : 0)), metric('区间请求', fmt(total.requests), '', '次')].join('');
}

const TABLE_PAGE_SIZE = 13;
function renderPagination(id, total, page, onChange) {
  const pages = Math.max(1, Math.ceil(total / TABLE_PAGE_SIZE));
  const current = Math.min(page, pages);
  $(`#${id}`).innerHTML = total > TABLE_PAGE_SIZE ? `<span>共 ${total} 条</span><button data-page="${current - 1}" ${current <= 1 ? 'disabled' : ''}>‹</button><strong>${current} / ${pages}</strong><button data-page="${current + 1}" ${current >= pages ? 'disabled' : ''}>›</button>` : `<span>共 ${total} 条</span>`;
  $$(`#${id} button`).forEach(button => button.onclick = () => onChange(Number(button.dataset.page)));
}

function renderSessions() {
  const sessions = filteredSessions().filter(session => !state.dateRange || session.requests.length || session.metrics.credits).sort((a, b) => b.metrics.credits - a.metrics.credits);
  const pages = Math.max(1, Math.ceil(sessions.length / TABLE_PAGE_SIZE));
  state.sessionPage = Math.max(1, Math.min(state.sessionPage, pages));
  const visible = sessions.slice((state.sessionPage - 1) * TABLE_PAGE_SIZE, state.sessionPage * TABLE_PAGE_SIZE);
  $('#sessionRows').innerHTML = visible.map(s => `<tr data-session="${s.id}"><td title="${esc(s.title)}">${esc(s.title)}</td><td>${credit(s.metrics.credits)}</td><td>${token(s.metrics.totalTokens)}</td><td>${s.metrics.requests}</td><td>${time(s.updatedAt)}</td></tr>`).join('');
  renderPagination('sessionPagination', sessions.length, state.sessionPage, page => { state.sessionPage = page; renderSessions(); });
  $$('#sessionRows tr').forEach(row => row.onclick = () => {
    state.selectedId = row.dataset.session;
    state.locked = true;
    state.requestPage = 1;
    acceptSelectionUI();
    switchTab('current');
    renderAll();
  });
}

function renderRequests() {
  const sessions = filteredSessions();
  const session = state.requestSessionId === ALL_SESSIONS ? { title: '全部会话', requests: [] } : (sessions.find(s => s.id === state.requestSessionId) || sessions[0]);
  const requests = state.requestSessionId === ALL_SESSIONS
    ? sessions.flatMap(s => s.requests.map(r => ({ ...r, sessionTitle: s.title, model: r.model || s.model }))).sort((a, b) => b.timestamp - a.timestamp)
    : (session?.requests || []);
  const pages = Math.max(1, Math.ceil(requests.length / TABLE_PAGE_SIZE));
  state.requestPage = Math.max(1, Math.min(state.requestPage, pages));
  const visible = requests.slice((state.requestPage - 1) * TABLE_PAGE_SIZE, state.requestPage * TABLE_PAGE_SIZE);
  $('#requestRows').innerHTML = visible.map(r => `<tr><td>${time(r.timestamp)}</td><td title="${esc(r.sessionTitle || session.title)}">${esc(r.sessionTitle ? `${r.sessionTitle} · ${r.model || '未知模型'}` : (r.model || session.model || '未知模型'))}</td><td>${credit(r.credits)}</td><td>${token(r.inputTokens)}</td><td>${token(r.outputTokens)}</td><td>${token(r.cachedTokens)}</td></tr>`).join('') || '<tr><td colspan="6">暂无可关联的请求明细</td></tr>';
  renderPagination('requestPagination', requests.length, state.requestPage, page => { state.requestPage = page; renderRequests(); });
}

function renderAll() {
  if (!state.data) return;
  renderPet(); renderCurrent(); renderToday(); renderAllSessions(); renderTrends(); renderSessions(); renderRequests();
}

function acceptSelectionUI() {
  $('#sessionSelectLabel').textContent = selectedSession()?.title || '全部会话';
  $$('.session-option').forEach(option => option.classList.toggle('selected', option.dataset.session === state.selectedId));
}

function showDataNotice(message) {
  const notice = $('#dataNotice');
  notice.textContent = message;
  notice.hidden = !message;
}

function acceptData(data) {
  if (data.error) return showDataNotice(data.error);
  showDataNotice(data.totalSessions ? '' : '还没有可统计的 WorkBuddy 会话。请先创建会话，数据出现后小哇会自动更新。');
  state.data = data;
  if (!state.selectedId || (!state.locked && data.activeSessionId)) state.selectedId = data.activeSessionId || data.sessions[0]?.id;
  if (state.selectedId === ALL_SESSIONS) state.selectedId = data.activeSessionId || data.sessions[0]?.id;
  const options = data.sessions;
  $('#sessionMenuInner').innerHTML = options.map(s => `<button class="session-option ${s.id === state.selectedId ? 'selected' : ''}" data-session="${s.id}" role="option" title="${esc(s.title)}">${esc(s.title)}</button>`).join('');
  $('#sessionSelectLabel').textContent = selectedSession()?.title || '全部会话';
  $$('.session-option').forEach(option => option.onclick = () => {
    state.selectedId = option.dataset.session;
    state.locked = true;
    state.requestPage = 1;
    $('#sessionSelect').classList.remove('open');
    $('#sessionSelectButton').setAttribute('aria-expanded', 'false');
    renderAll();
    acceptSelectionUI();
  });
  const requestOptions = [{ id: ALL_SESSIONS, title: '全部会话' }, ...data.sessions];
  $('#requestSessionMenuInner').innerHTML = requestOptions.map(s => `<button class="session-option ${s.id === state.requestSessionId ? 'selected' : ''}" data-request-session="${s.id}" role="option" title="${esc(s.title)}">${esc(s.title)}</button>`).join('');
  $('#requestSessionSelectLabel').textContent = requestOptions.find(s => s.id === state.requestSessionId)?.title || '全部会话';
  $$('[data-request-session]').forEach(option => option.onclick = () => {
    state.requestSessionId = option.dataset.requestSession;
    state.requestPage = 1;
    $('#requestSessionSelectLabel').textContent = option.title;
    $('#requestSessionSelect').classList.remove('open');
    $('#requestSessionSelectButton').setAttribute('aria-expanded', 'false');
    $$('[data-request-session]').forEach(item => item.classList.toggle('selected', item === option));
    renderRequests();
  });
  $('#updatedAt').textContent = `${new Date(data.generatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} 已同步`;
  $('#petStatus').textContent = `本地只读 · ${data.totalSessions} 个会话 · 5 秒刷新`;
  syncTaskBubble(data);
  renderAll();
}

function switchTab(tab) {
  if (tab === 'trends' && state.tab !== 'trends') {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - 14);
    setRange(dayString(start), dayString(end), '15');
  }
  if (tab === 'all' && !state.dateRange) $('#rangePreset').value = 'all';
  state.tab = tab;
  document.body.dataset.tab = tab;
  $('#dateFilter').style.display = ['all', 'trends', 'sessions', 'requests'].includes(tab) ? 'flex' : 'none';
  $$('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  $$('.tab-page').forEach(p => p.classList.toggle('active', p.id === `tab-${tab}`));
}

function togglePanel(show) {
  window.petAPI.togglePanel(typeof show === 'boolean' ? show : !state.expanded);
}

$('#closePanel').onclick = () => togglePanel(false);
$('#refreshButton').onclick = async () => acceptData(await window.petAPI.refresh());
$('#closeApp').onclick = () => window.petAPI.close();
$('#sessionSelectButton').onclick = () => {
  const open = $('#sessionSelect').classList.toggle('open');
  $('#sessionSelectButton').setAttribute('aria-expanded', String(open));
};
document.addEventListener('pointerdown', event => {
  if (!$('#sessionSelect').contains(event.target)) {
    $('#sessionSelect').classList.remove('open');
    $('#sessionSelectButton').setAttribute('aria-expanded', 'false');
  }
  if (!$('#requestSessionSelect').contains(event.target)) {
    $('#requestSessionSelect').classList.remove('open');
    $('#requestSessionSelectButton').setAttribute('aria-expanded', 'false');
  }
});
$$('.tabs button').forEach(button => button.onclick = () => switchTab(button.dataset.tab));

function setRange(start, end, preset) {
  state.dateRange = { start, end };
  state.sessionPage = 1;
  state.requestPage = 1;
  $('#rangePreset').value = preset;
  $('#startDate').value = start;
  $('#endDate').value = end;
  renderAll();
}
function applyCustomRange() {
  let start = $('#startDate').value;
  let end = $('#endDate').value;
  if (!start || !end) return;
  if (start > end) [start, end] = [end, start];
  setRange(start, end, 'custom');
}
$('#rangePreset').onchange = event => {
  const preset = event.target.value;
  const now = new Date();
  if (preset === 'all') {
    state.dateRange = null;
    $('#startDate').value = '';
    $('#endDate').value = '';
    state.sessionPage = state.requestPage = 1;
    renderAll();
    return;
  }
  if (preset === 'custom') return;
  let start = new Date(now);
  let end = new Date(now);
  if (preset === '7') start.setDate(now.getDate() - 6);
  if (preset === '15') start.setDate(now.getDate() - 14);
  if (preset === '30') start.setDate(now.getDate() - 29);
  if (preset === 'billing') {
    start = new Date(now.getFullYear(), now.getMonth() - 1, 16);
    end = new Date(now.getFullYear(), now.getMonth(), 15);
  }
  setRange(dayString(start), dayString(end), preset);
};
$('#requestSessionSelectButton').onclick = () => {
  const open = $('#requestSessionSelect').classList.toggle('open');
  $('#requestSessionSelectButton').setAttribute('aria-expanded', String(open));
};
$('#applyRange').onclick = applyCustomRange;
$('#clearRange').onclick = () => {
  state.dateRange = null;
  state.sessionPage = state.requestPage = 1;
  $('#rangePreset').value = 'all';
  $('#startDate').value = '';
  $('#endDate').value = '';
  renderAll();
};

let savedSettings = { scale: 0.8, opacity: 0.96, processingEnabled: true, processingDelay: 500, completionEnabled: true, completionDuration: 2000, statsEnabled: true, statsDuration: 6000, hoverPause: true, backgroundNotifications: false, soundEnabled: false, dndEnabled: false, dndStart: '22:00', dndEnd: '08:00', autoCheckUpdates: true, bubbleFontSize: 12 };
function applySettings(settings) {
  savedSettings = settings;
  if (isDnd() && taskState.phase !== 'hidden') hideBubble();
  document.documentElement.style.setProperty('--pet-scale', settings.scale);
  $('#scaleSlider').value = Math.round(settings.scale * 100);
  $('#scaleValue').textContent = `${Math.round(settings.scale * 100)}%`;
  document.documentElement.style.setProperty('--bubble-font-size', `${settings.bubbleFontSize}px`);
  $('#bubbleFontSlider').value = settings.bubbleFontSize;
  $('#bubbleFontValue').textContent = `${settings.bubbleFontSize}px`;
  $('#opacitySlider').value = Math.round(settings.opacity * 100);
  $('#opacityValue').textContent = `${Math.round(settings.opacity * 100)}%`;
  for (const key of ['processingEnabled', 'completionEnabled', 'statsEnabled', 'hoverPause', 'backgroundNotifications', 'soundEnabled', 'dndEnabled', 'autoCheckUpdates']) $(`#${key}`).checked = Boolean(settings[key]);
  $('#dndStart').value = settings.dndStart;
  $('#dndEnd').value = settings.dndEnd;
  $('#processingDelay').value = settings.processingDelay;
  $('#completionDuration').value = settings.completionDuration / 1000;
  $('#statsDuration').value = settings.statsDuration / 1000;
  $('#saveSettings').disabled = true;
  $('#settingsHint').textContent = '设置已保存';
}
function previewSettings() {
  const scale = Number($('#scaleSlider').value);
  const bubbleFont = Number($('#bubbleFontSlider').value);
  const opacity = Number($('#opacitySlider').value);
  $('#scaleValue').textContent = `${scale}%`;
  $('#bubbleFontValue').textContent = `${bubbleFont}px`;
  $('#opacityValue').textContent = `${opacity}%`;
  $('#saveSettings').disabled = false;
  $('#settingsHint').textContent = '有未保存的调整';
}
$('#scaleSlider').oninput = previewSettings;
$('#bubbleFontSlider').oninput = previewSettings;
$('#opacitySlider').oninput = previewSettings;
for (const id of ['processingEnabled', 'completionEnabled', 'statsEnabled', 'hoverPause', 'backgroundNotifications', 'soundEnabled', 'dndEnabled', 'autoCheckUpdates', 'dndStart', 'dndEnd', 'processingDelay', 'completionDuration', 'statsDuration']) $(`#${id}`).addEventListener('input', previewSettings);
$('#saveSettings').onclick = () => {
  $('#saveSettings').disabled = true;
  $('#settingsHint').textContent = '正在保存…';
  window.petAPI.updateSettings({
    scale: Number($('#scaleSlider').value) / 100,
    bubbleFontSize: Number($('#bubbleFontSlider').value),
    opacity: Number($('#opacitySlider').value) / 100,
    processingEnabled: $('#processingEnabled').checked,
    processingDelay: Number($('#processingDelay').value),
    completionEnabled: $('#completionEnabled').checked,
    completionDuration: Number($('#completionDuration').value) * 1000,
    statsEnabled: $('#statsEnabled').checked,
    statsDuration: Number($('#statsDuration').value) * 1000,
    hoverPause: $('#hoverPause').checked,
    backgroundNotifications: $('#backgroundNotifications').checked,
    soundEnabled: $('#soundEnabled').checked,
    dndEnabled: $('#dndEnabled').checked,
    dndStart: $('#dndStart').value,
    dndEnd: $('#dndEnd').value,
    autoCheckUpdates: $('#autoCheckUpdates').checked
  });
};
window.petAPI.onSettings(applySettings);
window.petAPI.getSettings().then(applySettings);

function renderUpdateState(update = {}) {
  const state = update.state || 'idle';
  const badge = $('#updateBadge');
  const labels = {
    idle: '待检查',
    disabled: '开发模式',
    checking: '检查中',
    available: update.availableVersion ? `v${update.availableVersion}` : '有新版本',
    current: '已是最新',
    downloading: `${update.percent || 0}%`,
    downloaded: '待安装',
    error: '检查失败'
  };
  badge.textContent = labels[state] || '待检查';
  badge.className = `update-badge${['available', 'downloaded'].includes(state) ? ' available' : ''}${state === 'error' ? ' error' : ''}`;
  $('#currentVersion').textContent = `v${update.currentVersion || '0.1.0'}`;
  $('#updateMessage').textContent = update.message || '启动后可在这里检查新版本。';
  const busy = ['checking', 'downloading'].includes(state);
  $('#checkUpdates').disabled = busy || !update.packaged;
  $('#checkUpdates').textContent = state === 'checking' ? '正在检查…' : '检查更新';
  $('#downloadUpdate').hidden = state !== 'available';
  $('#installUpdate').hidden = state !== 'downloaded';
  const progress = $('#updateProgress');
  progress.hidden = !['downloading', 'downloaded'].includes(state);
  const percent = Math.max(0, Math.min(100, Number(update.percent) || 0));
  $('#updateProgressBar').style.width = `${percent}%`;
  $('#updateProgressText').textContent = `${percent}%`;
  if (update.availableVersion) {
    $('#updateReleaseLink').href = `https://github.com/xihrni/xiaowa-usage/releases/tag/v${update.availableVersion}`;
  }
}

$('#checkUpdates').onclick = async () => {
  $('#checkUpdates').disabled = true;
  $('#checkUpdates').textContent = '正在检查…';
  await window.petAPI.checkForUpdates();
};
$('#downloadUpdate').onclick = async () => {
  $('#downloadUpdate').disabled = true;
  await window.petAPI.downloadUpdate();
  $('#downloadUpdate').disabled = false;
};
$('#installUpdate').onclick = () => window.petAPI.installUpdate();
window.petAPI.onUpdateState(renderUpdateState);
['idle', 'greeting', 'working', 'completed', 'sleeping'].forEach(mode => { const image = new Image(); image.src = `../assets/${mode}.png`; });
window.petAPI.getUpdateState().then(renderUpdateState);

const bubble = $('#petBubble');
bubble.addEventListener('mouseenter', () => {
  if (!savedSettings.hoverPause || !taskState.timer) return;
  clearTimeout(taskState.timer);
  taskState.remaining = Math.max(0, taskState.remaining - (Date.now() - taskState.startedAt));
  taskState.timer = null;
});
bubble.addEventListener('mouseleave', () => {
  if (!savedSettings.hoverPause || !taskState.callback || taskState.timer) return;
  const callback = taskState.callback;
  const remaining = taskState.remaining;
  scheduleBubble(callback, remaining);
});
bubble.addEventListener('click', () => {
  const sessionId = bubble.dataset.session;
  if (sessionId === ALL_SESSIONS || (sessionId && state.data.sessions.some(s => s.id === sessionId))) {
    state.selectedId = sessionId;
    state.locked = true;
    state.requestPage = 1;
    acceptSelectionUI();
    switchTab(sessionId === ALL_SESSIONS ? 'all' : 'current');
    renderAll();
  }
  togglePanel(true);
});

const petImage = $('#petImage');
let pointerStart = null;
let dragging = false;
petImage.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  pointerStart = { x: event.clientX, y: event.clientY };
  dragging = false;
  petImage.setPointerCapture(event.pointerId);
  window.petAPI.dragStart();
});
petImage.addEventListener('pointermove', event => {
  if (!pointerStart || state.expanded) return;
  if (Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 5) dragging = true;
  if (dragging) {
    petImage.style.cursor = 'grabbing';
    window.petAPI.dragMove();
  }
});
petImage.addEventListener('pointerup', event => {
  if (!pointerStart) return;
  window.petAPI.dragEnd();
  petImage.releasePointerCapture(event.pointerId);
  petImage.style.cursor = 'grab';
  pointerStart = null;
  if (!dragging) togglePanel();
  dragging = false;
});
petImage.addEventListener('pointercancel', () => { pointerStart = null; dragging = false; window.petAPI.dragEnd(); });
petImage.addEventListener('contextmenu', event => {
  event.preventDefault();
  window.petAPI.openPetMenu();
});
window.petAPI.onUsage(acceptData);
window.petAPI.onError(message => { $('#petStatus').textContent = `读取失败：${message}`; showDataNotice(message); });
window.petAPI.onPanelState(expanded => { state.expanded = expanded; document.body.classList.toggle('expanded', expanded); });
window.petAPI.onPetPat(patPet);
window.petAPI.onPetNotice(showPetNotice);
$('#petImage')
window.petAPI.refresh().then(acceptData).catch(error => { $('#petStatus').textContent = error.message; showDataNotice(error.message); });
setTimeout(showWelcomeGreeting, 700);
