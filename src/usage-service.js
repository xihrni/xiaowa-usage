const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { DatabaseSync } = require('node:sqlite');

const DAY_MS = 86400000;
const root = path.join(os.homedir(), '.workbuddy');
const dbPath = path.join(root, 'workbuddy.db');
const projectsPath = path.join(root, 'projects');
const fileCache = new Map();

function localDay(timestamp) {
  const d = new Date(timestamp);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function readDatabase() {
  if (!fs.existsSync(dbPath)) throw new Error('未找到 WorkBuddy 本地数据。请先安装并登录 WorkBuddy，创建一次会话后再启动小哇。');
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const rows = db.prepare(`
      SELECT s.id, s.title, s.custom_title, s.status, s.model, s.created_at,
             s.updated_at, s.last_activity_at, s.deleted_at,
             u.used, u.size, u.updated_at AS usage_updated_at, u.credit_json
      FROM sessions s
      LEFT JOIN session_usage u ON u.session_id = s.id
      WHERE s.deleted_at IS NULL
    `).all();
    return rows.map(row => {
      let credits = {};
      try { credits = JSON.parse(row.credit_json || '{}'); } catch {}
      return {
        id: row.id,
        title: row.custom_title || row.title || '未命名会话',
        status: row.status,
        model: row.model,
        createdAt: Number(row.created_at || 0),
        updatedAt: Number(row.last_activity_at || row.usage_updated_at || row.updated_at || 0),
        used: Number(row.used || 0),
        size: Number(row.size || 0),
        credits,
        creditTotal: Object.values(credits).reduce((sum, value) => sum + Number(value || 0), 0)
      };
    });
  } finally {
    db.close();
  }
}

function listJsonlFiles(dir, output = []) {
  if (!fs.existsSync(dir)) return output;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listJsonlFiles(full, output);
    else if (entry.isFile() && entry.name.endsWith('.jsonl') && !full.includes(`${path.sep}modify_backup${path.sep}`)) output.push(full);
  }
  return output;
}

function parseUsageFile(file) {
  const stat = fs.statSync(file);
  const cacheKey = `${stat.mtimeMs}:${stat.size}`;
  if (fileCache.get(file)?.key === cacheKey) return fileCache.get(file).value;
  const requests = new Map();
  let currentRequestId = null;
  let currentTimestamp = 0;
  const content = fs.readFileSync(file, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let item;
    try { item = JSON.parse(line); } catch { continue; }
    const timestamp = Number(item.timestamp || item.createdAt || 0);
    if (timestamp) currentTimestamp = timestamp;
    const provider = item.providerData || {};
    const requestId = provider.conversationRequestId || item.conversationRequestId;
    if (requestId) {
      currentRequestId = requestId;
      if (!requests.has(requestId)) requests.set(requestId, { requestId, timestamp: currentTimestamp, model: provider.model || item.model || null });
    }
    const usage = provider.usage || item.message?.usage;
    if (!usage) continue;
    const input = Number(usage.inputTokens ?? usage.input_tokens ?? 0);
    const output = Number(usage.outputTokens ?? usage.output_tokens ?? 0);
    if (!input && !output) continue;
    const id = currentRequestId || `unlinked:${item.message?.id || item.uuid || currentTimestamp || requests.size}`;
    const existing = requests.get(id) || { requestId: id, timestamp: currentTimestamp, model: provider.model || item.model || null };
    const raw = provider.rawUsage || {};
    existing.timestamp = existing.timestamp || currentTimestamp;
    existing.model = existing.model || provider.model || item.model || null;
    existing.inputTokens = Number(existing.inputTokens || 0) + input;
    existing.outputTokens = Number(existing.outputTokens || 0) + output;
    existing.totalTokens = Number(existing.totalTokens || 0) + Number(usage.totalTokens ?? usage.total_tokens ?? input + output);
    existing.cachedTokens = Number(existing.cachedTokens || 0) + Number(raw.prompt_cache_hit_tokens ?? usage.cache_read_input_tokens ?? usage.inputTokensDetails?.[0]?.cached_tokens ?? 0);
    existing.reasoningTokens = Number(existing.reasoningTokens || 0) + Number(raw.completion_thinking_tokens ?? usage.outputTokensDetails?.[0]?.reasoning_tokens ?? 0);
    requests.set(id, existing);
  }
  const sessionId = path.basename(file, '.jsonl');
  const value = { sessionId, requests: [...requests.values()] };
  fileCache.set(file, { key: cacheKey, value });
  return value;
}

function emptyMetrics() {
  return { credits: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedTokens: 0, reasoningTokens: 0, requests: 0 };
}

function addRequest(metrics, request, credits) {
  metrics.requests += 1;
  metrics.inputTokens += request.inputTokens || 0;
  metrics.outputTokens += request.outputTokens || 0;
  metrics.totalTokens += request.totalTokens || 0;
  metrics.cachedTokens += request.cachedTokens || 0;
  metrics.reasoningTokens += request.reasoningTokens || 0;
  if (credits && Number.isFinite(Number(credits[request.requestId]))) metrics.credits += Number(credits[request.requestId]);
}

function finalizeMetrics(metrics) {
  for (const key of Object.keys(metrics)) metrics[key] = Math.round(metrics[key] * 100) / 100;
  return metrics;
}

function getUsageData() {
  const sessions = readDatabase();
  const byId = new Map(sessions.map(session => [session.id, session]));
  const requestsBySession = new Map();
  for (const file of listJsonlFiles(projectsPath)) {
    try {
      const parsed = parseUsageFile(file);
      if (!byId.has(parsed.sessionId)) continue;
      requestsBySession.set(parsed.sessionId, parsed.requests);
    } catch (error) {
      console.warn(`Skip unreadable usage file: ${file}`, error.message);
    }
  }

  const today = localDay(Date.now());
  const daily = new Map();
  const models = new Map();
  for (const session of sessions) {
    const metrics = emptyMetrics();
    const requests = requestsBySession.get(session.id) || [];
    const linkedIds = new Set();
    for (const request of requests) {
      addRequest(metrics, request, session.credits);
      linkedIds.add(request.requestId);
      const day = localDay(request.timestamp || session.updatedAt || Date.now());
      if (!daily.has(day)) daily.set(day, emptyMetrics());
      addRequest(daily.get(day), request, session.credits);
      const model = request.model || session.model || '未知模型';
      if (!models.has(model)) models.set(model, emptyMetrics());
      addRequest(models.get(model), request, session.credits);
    }
    let unlinkedCredits = 0;
    for (const [requestId, credit] of Object.entries(session.credits)) {
      if (linkedIds.has(requestId)) continue;
      unlinkedCredits += Number(credit || 0);
      metrics.credits += Number(credit || 0);
      const day = localDay(session.updatedAt || Date.now());
      if (!daily.has(day)) daily.set(day, emptyMetrics());
      daily.get(day).credits += Number(credit || 0);
    }
    session.metrics = finalizeMetrics(metrics);
    session.unlinkedCredits = unlinkedCredits;
    session.unlinkedDay = localDay(session.updatedAt || Date.now());
    session.requests = requests.map(request => ({
      ...request,
      credits: Number(session.credits[request.requestId] || 0),
      day: localDay(request.timestamp || session.updatedAt || Date.now())
    })).sort((a, b) => b.timestamp - a.timestamp);
  }

  sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  const isWorking = session => ['working', 'running', 'processing'].includes(String(session.status || '').toLowerCase());
  const active = sessions.filter(isWorking).sort((a, b) => b.updatedAt - a.updatedAt)[0] || sessions[0] || null;
  const dailyRows = [...daily.entries()].map(([day, metrics]) => ({ day, ...finalizeMetrics(metrics) })).sort((a, b) => b.day.localeCompare(a.day));
  const modelRows = [...models.entries()].map(([model, metrics]) => ({ model, ...finalizeMetrics(metrics) })).sort((a, b) => b.credits - a.credits);
  return {
    generatedAt: Date.now(),
    activeSessionId: active?.id || null,
    today: finalizeMetrics(daily.get(today) || emptyMetrics()),
    daily: dailyRows,
    models: modelRows,
    sessions: sessions.map(session => ({ ...session, credits: undefined })),
    totalSessions: sessions.length,
    workbuddyRunning: sessions.some(isWorking)
  };
}

module.exports = { getUsageData, localDay, startOfToday, DAY_MS };
