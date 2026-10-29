const { getUsageData } = require('./usage-service');
const data = getUsageData();
const active = data.sessions.find(s => s.id === data.activeSessionId);
console.log(JSON.stringify({
  generatedAt: new Date(data.generatedAt).toISOString(),
  totalSessions: data.totalSessions,
  activeSession: active ? { title: active.title, ...active.metrics } : null,
  today: data.today,
  recentDays: data.daily.slice(0, 3),
  models: data.models.slice(0, 5),
  sessionsWithCredits: data.sessions.filter(s => s.metrics.credits > 0).length,
  sessionsWithTokens: data.sessions.filter(s => s.metrics.totalTokens > 0).length
}, null, 2));
