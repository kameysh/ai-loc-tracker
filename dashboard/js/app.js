/**
 * app.js — Data loading, processing and DOM orchestration for the
 * AI vs Human LoC Dashboard.
 */

'use strict';

/* ── Config ─────────────────────────────────────────────── */

const DATA_URL         = 'https://raw.githubusercontent.com/kameysh/ai-loc-tracker/main/data/stats.json';
const REFRESH_INTERVAL = 60_000; // 60 s

/* ── State ──────────────────────────────────────────────── */

let statsData       = null;
let refreshTimer    = null;
let isFirstLoad     = true;

/* ── DOM refs (resolved once) ──────────────────────────── */

const $ = id => document.getElementById(id);

const DOM = {
  errorBanner:       $('error-banner'),
  lastUpdated:       $('last-updated'),
  refreshDot:        $('refresh-dot'),
  // Summary cards
  totalLines:        $('total-lines'),
  totalAi:           $('total-ai'),
  totalHuman:        $('total-human'),
  aiRate:            $('ai-rate'),
  // Containers
  teamChartCanvas:   $('team-chart'),
  userCardsContainer:$('user-cards-container'),
  langChartCanvas:   $('lang-chart'),
  timelineChartCanvas:$('timeline-chart'),
  // Empty state
  dashboardContent:  $('dashboard-content'),
  emptyState:        $('empty-state'),
};

/* ── Utility helpers ────────────────────────────────────── */

function formatNumber(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatPercent(frac) {
  return `${(frac * 100).toFixed(1)}%`;
}

function timeAgo(ts) {
  const diffMs  = Date.now() - ts;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60)  return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60)  return `${diffMin} minute${diffMin === 1 ? '' : 's'} ago`;
  const diffHr  = Math.floor(diffMin / 60);
  if (diffHr < 24)   return `${diffHr} hour${diffHr === 1 ? '' : 's'} ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay} day${diffDay === 1 ? '' : 's'} ago`;
}

function userInitials(name) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0])
    .join('')
    .toUpperCase();
}

/**
 * Return sorted array of last N calendar dates as "YYYY-MM-DD" strings
 * relative to today.
 */
function lastNDays(n) {
  const days = [];
  const now  = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

/* ── Data processing ────────────────────────────────────── */

function processStats(data) {
  const users       = Object.values(data.users || {});
  const hasUsers    = users.length > 0;

  // ---- Aggregate totals across all users (net = added - removed)
  let aggHuman = 0, aggCopilot = 0, aggGemini = 0;
  for (const u of users) {
    const t = u.totals || {};
    aggHuman   += Math.max(0, (t.human?.added   || 0) - (t.human?.removed   || 0));
    aggCopilot += Math.max(0, (t.copilot?.added || 0) - (t.copilot?.removed || 0));
    aggGemini  += Math.max(0, (t.gemini?.added  || 0) - (t.gemini?.removed  || 0));
  }
  const aggTotal = aggHuman + aggCopilot + aggGemini;
  const aggAI    = aggCopilot + aggGemini;

  // ---- Team overview rows (sorted descending by total)
  const teamRows = users.map(u => {
    const t = u.totals || {};
    return {
      name:    u.name  || u.email,
      human:   Math.max(0, (t.human?.added   || 0) - (t.human?.removed   || 0)),
      copilot: Math.max(0, (t.copilot?.added || 0) - (t.copilot?.removed || 0)),
      gemini:  Math.max(0, (t.gemini?.added  || 0) - (t.gemini?.removed  || 0)),
    };
  }).sort((a, b) =>
    (b.human + b.copilot + b.gemini) - (a.human + a.copilot + a.gemini)
  );

  // ---- Language breakdown (top 5 across all users, sorted by total)
  const langMap = {};
  for (const u of users) {
    for (const [lang, vals] of Object.entries(u.byLanguage || {})) {
      if (!langMap[lang]) langMap[lang] = { human: 0, copilot: 0, gemini: 0 };
      langMap[lang].human   += vals.human   || 0;
      langMap[lang].copilot += vals.copilot || 0;
      langMap[lang].gemini  += vals.gemini  || 0;
    }
  }
  const langRows = Object.entries(langMap)
    .map(([lang, vals]) => ({ lang, ...vals }))
    .sort((a, b) =>
      (b.human + b.copilot + b.gemini) - (a.human + a.copilot + a.gemini)
    )
    .slice(0, 5);

  // ---- Timeline: last 30 days, aggregated across users
  const days30   = lastNDays(30);
  const timeline = {
    labels:  days30,
    human:   days30.map(() => 0),
    copilot: days30.map(() => 0),
    gemini:  days30.map(() => 0),
  };
  for (const u of users) {
    for (const [date, vals] of Object.entries(u.dailyStats || {})) {
      const idx = days30.indexOf(date);
      if (idx === -1) continue;
      timeline.human[idx]   += vals.human   || 0;
      timeline.copilot[idx] += vals.copilot || 0;
      timeline.gemini[idx]  += vals.gemini  || 0;
    }
  }

  // ---- Per-user sparkline (last 14 days combined AI)
  const days14 = lastNDays(14);
  const perUser = users.map(u => {
    const t   = u.totals || {};
    const sparkData = days14.map(d => {
      const day = (u.dailyStats || {})[d] || {};
      return (day.copilot || 0) + (day.gemini || 0);
    });
    return {
      name:       u.name  || u.email,
      email:      u.email || '',
      lastActive: u.lastActive || 0,
      human:   Math.max(0, (t.human?.added   || 0) - (t.human?.removed   || 0)),
      copilot: Math.max(0, (t.copilot?.added || 0) - (t.copilot?.removed || 0)),
      gemini:  Math.max(0, (t.gemini?.added  || 0) - (t.gemini?.removed  || 0)),
      sparkData,
    };
  });

  return {
    hasUsers,
    aggTotal, aggAI, aggHuman, aggCopilot, aggGemini,
    teamRows, langRows, timeline, perUser,
    lastUpdated: data.lastUpdated || 0,
  };
}

/* ── Render helpers ─────────────────────────────────────── */

function renderSummaryCards(p) {
  const aiRate = p.aggTotal > 0 ? p.aggAI / p.aggTotal : 0;

  DOM.totalLines.textContent  = formatNumber(p.aggTotal);
  DOM.totalAi.textContent     = formatNumber(p.aggAI);
  DOM.totalHuman.textContent  = formatNumber(p.aggHuman);
  DOM.aiRate.textContent      = formatPercent(aiRate);
}

function renderTeamOverview(p) {
  if (!p.hasUsers) return;

  // Resize the canvas height to fit all rows
  const rowHeight = 40;
  const minHeight = 120;
  const h = Math.max(minHeight, p.teamRows.length * rowHeight + 40);
  DOM.teamChartCanvas.parentElement.style.height = `${h}px`;

  createTeamOverviewChart(DOM.teamChartCanvas, p.teamRows);
}

function renderUserCards(p) {
  const container = DOM.userCardsContainer;
  container.innerHTML = '';

  for (const u of p.perUser) {
    const card = buildUserCard(u);
    container.appendChild(card);
  }
}

function buildUserCard(u) {
  const total  = u.human + u.copilot + u.gemini || 1;
  const aiPct  = ((u.copilot + u.gemini) / total * 100).toFixed(0);
  const humPct = (u.human / total * 100).toFixed(0);

  const card = document.createElement('div');
  card.className = 'user-card';

  card.innerHTML = `
    <div class="user-card-header">
      <div class="user-avatar" aria-hidden="true">${userInitials(u.name)}</div>
      <div class="user-info">
        <div class="user-name" title="${u.name}">${u.name}</div>
        <div class="user-email" title="${u.email}">${u.email}</div>
      </div>
    </div>

    <div class="user-card-charts">
      <div class="donut-wrapper">
        <canvas id="donut-${sanitizeId(u.email)}" width="88" height="88" aria-label="${u.name} contribution breakdown"></canvas>
        <div class="donut-center-label" aria-hidden="true">
          <span class="pct">${aiPct}%</span>
          <span class="pct-label">AI</span>
        </div>
      </div>
      <div class="sparkline-wrapper">
        <div class="sparkline-label">14-day AI trend</div>
        <canvas id="spark-${sanitizeId(u.email)}" aria-label="${u.name} 14-day trend"></canvas>
      </div>
    </div>

    <div class="user-card-stats">
      <span class="stat-pill"><span class="dot human"></span>${formatNumber(u.human)} human</span>
      <span class="stat-pill"><span class="dot copilot"></span>${formatNumber(u.copilot)} Copilot</span>
      <span class="stat-pill"><span class="dot gemini"></span>${formatNumber(u.gemini)} Gemini</span>
    </div>

    <div class="user-card-footer">
      <span class="active-dot"></span>
      Last active: ${u.lastActive ? timeAgo(u.lastActive) : 'unknown'}
      &nbsp;·&nbsp; ${formatNumber(u.human + u.copilot + u.gemini)} total lines
    </div>
  `;

  // Charts are rendered after the card is in the DOM
  requestAnimationFrame(() => {
    const donutCanvas = card.querySelector(`#donut-${sanitizeId(u.email)}`);
    const sparkCanvas  = card.querySelector(`#spark-${sanitizeId(u.email)}`);
    if (donutCanvas) createDonutChart(donutCanvas, u);
    if (sparkCanvas)  createSparklineChart(sparkCanvas, u.sparkData);
  });

  return card;
}

function sanitizeId(str) {
  return str.replace(/[^a-z0-9]/gi, '-');
}

function renderLanguageChart(p) {
  if (p.langRows.length === 0) return;
  createLanguageChart(DOM.langChartCanvas, p.langRows);
}

function renderTimelineChart(p) {
  createTimelineChart(
    DOM.timelineChartCanvas,
    p.timeline.labels,
    { human: p.timeline.human, copilot: p.timeline.copilot, gemini: p.timeline.gemini }
  );
}

function renderLastUpdated(ts) {
  if (!ts) {
    DOM.lastUpdated.textContent = 'No data yet';
    return;
  }
  const d = new Date(ts);
  DOM.lastUpdated.textContent =
    `Updated ${timeAgo(ts)} · ${d.toLocaleString(undefined, {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    })}`;
}

/* ── Empty / Error states ───────────────────────────────── */

function showEmpty() {
  DOM.dashboardContent.style.display = 'none';
  DOM.emptyState.style.display       = 'flex';
}

function showDashboard() {
  DOM.dashboardContent.style.display = 'block';
  DOM.emptyState.style.display       = 'none';
}

function showError(msg) {
  DOM.errorBanner.textContent = `Error loading data: ${msg}`;
  DOM.errorBanner.classList.add('visible');
}

function clearError() {
  DOM.errorBanner.classList.remove('visible');
}

/* ── Data loading ───────────────────────────────────────── */

async function loadData() {
  // Show loading indicator
  DOM.refreshDot.classList.add('loading');

  try {
    const res = await fetch(`${DATA_URL}?_=${Date.now()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

    const data = await res.json();
    statsData = data;
    clearError();
    renderDashboard(data);
  } catch (err) {
    console.error('[Dashboard] Failed to load stats:', err);
    if (isFirstLoad) {
      showError(err.message);
      showEmpty();
    } else {
      // Non-fatal: keep showing stale data, just show a banner
      showError(err.message + ' — showing last known data.');
    }
  } finally {
    DOM.refreshDot.classList.remove('loading');
    isFirstLoad = false;
  }
}

/* ── Render orchestration ───────────────────────────────── */

function renderDashboard(data) {
  const p = processStats(data);

  renderLastUpdated(p.lastUpdated);
  renderSummaryCards(p);

  if (!p.hasUsers) {
    showEmpty();
    return;
  }

  showDashboard();
  renderTeamOverview(p);
  renderUserCards(p);
  renderLanguageChart(p);
  renderTimelineChart(p);
}

/* ── Bootstrap ──────────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', () => {
  loadData();
  refreshTimer = setInterval(loadData, REFRESH_INTERVAL);
});

// Clean up timer if the page is hidden (optional optimization)
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    clearInterval(refreshTimer);
  } else {
    loadData();
    refreshTimer = setInterval(loadData, REFRESH_INTERVAL);
  }
});
