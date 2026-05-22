/**
 * charts.js — Chart creation helpers for the AI vs Human LoC Dashboard.
 * All functions accept processed data objects and return Chart.js instances.
 */

'use strict';

/* ── Shared Chart.js defaults ─────────────────────────────── */

Chart.defaults.color = '#8b949e';
Chart.defaults.borderColor = '#30363d';
Chart.defaults.font.family =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
Chart.defaults.font.size = 12;

const COLORS = {
  human:   '#4CAF50',
  copilot: '#0078D4',
  gemini:  '#EA4335',
};

const COLORS_ALPHA = {
  human:   'rgba(76, 175, 80, 0.15)',
  copilot: 'rgba(0, 120, 212, 0.15)',
  gemini:  'rgba(234, 67, 53, 0.15)',
};

/** Destroy a chart instance if it already exists on a canvas. */
function destroyChart(canvas) {
  const existing = Chart.getChart(canvas);
  if (existing) existing.destroy();
}

/* ── Team Overview — Horizontal Stacked Bar ──────────────── */

/**
 * @param {HTMLCanvasElement} canvas
 * @param {Array<{name: string, human: number, copilot: number, gemini: number}>} rows
 */
function createTeamOverviewChart(canvas, rows) {
  destroyChart(canvas);

  const labels = rows.map(r => r.name);

  return new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Human',
          data: rows.map(r => r.human),
          backgroundColor: COLORS.human,
          borderRadius: { topLeft: 0, topRight: 0, bottomLeft: 4, bottomRight: 0 },
          borderSkipped: false,
        },
        {
          label: 'Copilot',
          data: rows.map(r => r.copilot),
          backgroundColor: COLORS.copilot,
          borderRadius: 0,
          borderSkipped: false,
        },
        {
          label: 'Gemini',
          data: rows.map(r => r.gemini),
          backgroundColor: COLORS.gemini,
          borderRadius: { topLeft: 0, topRight: 4, bottomLeft: 0, bottomRight: 4 },
          borderSkipped: false,
        },
      ],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          backgroundColor: '#1c2129',
          borderColor: '#30363d',
          borderWidth: 1,
          titleColor: '#e6edf3',
          bodyColor: '#8b949e',
          callbacks: {
            label(ctx) {
              return ` ${ctx.dataset.label}: ${ctx.parsed.x.toLocaleString()} lines`;
            },
          },
        },
      },
      scales: {
        x: {
          stacked: true,
          grid: { color: '#21262d' },
          ticks: {
            callback: v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v,
          },
        },
        y: {
          stacked: true,
          grid: { display: false },
          ticks: { color: '#e6edf3' },
        },
      },
    },
  });
}

/* ── Donut Chart (per user card) ─────────────────────────── */

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{human: number, copilot: number, gemini: number}} totals
 */
function createDonutChart(canvas, totals) {
  destroyChart(canvas);

  const total = totals.human + totals.copilot + totals.gemini || 1;

  return new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: ['Human', 'Copilot', 'Gemini'],
      datasets: [
        {
          data: [totals.human, totals.copilot, totals.gemini],
          backgroundColor: [COLORS.human, COLORS.copilot, COLORS.gemini],
          borderColor: '#161b22',
          borderWidth: 2,
          hoverBorderWidth: 2,
        },
      ],
    },
    options: {
      responsive: false,
      cutout: '68%',
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1c2129',
          borderColor: '#30363d',
          borderWidth: 1,
          titleColor: '#e6edf3',
          bodyColor: '#8b949e',
          callbacks: {
            label(ctx) {
              const pct = ((ctx.parsed / total) * 100).toFixed(1);
              return ` ${ctx.label}: ${ctx.parsed.toLocaleString()} (${pct}%)`;
            },
          },
        },
      },
    },
  });
}

/* ── Sparkline (per user card) ───────────────────────────── */

/**
 * @param {HTMLCanvasElement} canvas
 * @param {number[]} values  — last 14 days of combined AI LoC
 */
function createSparklineChart(canvas, values) {
  destroyChart(canvas);

  const maxVal = Math.max(...values, 1);

  return new Chart(canvas, {
    type: 'line',
    data: {
      labels: values.map((_, i) => i),
      datasets: [
        {
          data: values,
          borderColor: '#58a6ff',
          borderWidth: 1.5,
          pointRadius: 0,
          fill: {
            target: 'origin',
            above: 'rgba(88, 166, 255, 0.12)',
          },
          tension: 0.4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false },
      },
      scales: {
        x: { display: false },
        y: {
          display: false,
          min: 0,
          max: maxVal * 1.2,
        },
      },
    },
  });
}

/* ── Language Breakdown — Grouped Bar ───────────────────────*/

/**
 * @param {HTMLCanvasElement} canvas
 * @param {Array<{lang: string, human: number, copilot: number, gemini: number}>} rows
 */
function createLanguageChart(canvas, rows) {
  destroyChart(canvas);

  return new Chart(canvas, {
    type: 'bar',
    data: {
      labels: rows.map(r => r.lang),
      datasets: [
        {
          label: 'Human',
          data: rows.map(r => r.human),
          backgroundColor: COLORS.human,
          borderRadius: 3,
        },
        {
          label: 'Copilot',
          data: rows.map(r => r.copilot),
          backgroundColor: COLORS.copilot,
          borderRadius: 3,
        },
        {
          label: 'Gemini',
          data: rows.map(r => r.gemini),
          backgroundColor: COLORS.gemini,
          borderRadius: 3,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1c2129',
          borderColor: '#30363d',
          borderWidth: 1,
          titleColor: '#e6edf3',
          bodyColor: '#8b949e',
          callbacks: {
            label(ctx) {
              return ` ${ctx.dataset.label}: ${ctx.parsed.y.toLocaleString()} lines`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: '#e6edf3' },
        },
        y: {
          grid: { color: '#21262d' },
          ticks: {
            callback: v => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v,
          },
        },
      },
    },
  });
}

/* ── Timeline — Multi-line ───────────────────────────────── */

/**
 * @param {HTMLCanvasElement} canvas
 * @param {string[]} labels  — date strings "YYYY-MM-DD"
 * @param {{human: number[], copilot: number[], gemini: number[]}} series
 */
function createTimelineChart(canvas, labels, series) {
  destroyChart(canvas);

  function makeGradient(ctx, color) {
    const gradient = ctx.createLinearGradient(0, 0, 0, 300);
    gradient.addColorStop(0, color.replace(')', ', 0.3)').replace('rgb', 'rgba'));
    gradient.addColorStop(1, color.replace(')', ', 0)').replace('rgb', 'rgba'));
    return gradient;
  }

  const sharedLineOpts = {
    borderWidth: 2,
    pointRadius: 0,
    pointHoverRadius: 4,
    tension: 0.4,
    fill: false,
  };

  return new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Human',
          data: series.human,
          borderColor: COLORS.human,
          ...sharedLineOpts,
        },
        {
          label: 'Copilot',
          data: series.copilot,
          borderColor: COLORS.copilot,
          ...sharedLineOpts,
        },
        {
          label: 'Gemini',
          data: series.gemini,
          borderColor: COLORS.gemini,
          ...sharedLineOpts,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false,
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1c2129',
          borderColor: '#30363d',
          borderWidth: 1,
          titleColor: '#e6edf3',
          bodyColor: '#8b949e',
          callbacks: {
            label(ctx) {
              return ` ${ctx.dataset.label}: ${ctx.parsed.y.toLocaleString()} lines`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { color: '#21262d' },
          ticks: {
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 8,
            callback(val, idx) {
              const d = labels[idx];
              if (!d) return '';
              const parts = d.split('-');
              return `${parts[1]}/${parts[2]}`;
            },
          },
        },
        y: {
          grid: { color: '#21262d' },
          ticks: {
            callback: v => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v,
          },
        },
      },
    },
  });
}
