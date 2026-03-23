// Embed-only widget JS (no editor UI)
const METRIC_CONFIG = {
    brent_oil:    { color: '#3b82f6', bg: 'rgba(59,130,246,0.08)' },
    ta125:        { color: '#10b981', bg: 'rgba(16,185,129,0.08)' },
    sp500:        { color: '#f59e0b', bg: 'rgba(245,158,11,0.08)' },
    stoxx600:     { color: '#f97316', bg: 'rgba(249,115,22,0.08)' },
    asia_pacific: { color: '#8b5cf6', bg: 'rgba(139,92,246,0.08)' },
};

const IL_TZ = 'Asia/Jerusalem';

let metricsData = null;
let events = [];
let selectedMetrics = ['brent_oil'];
let timeRange = 'all';
let chart = null;
let hoveredEventId = null;
let eventPixelPositions = [];
let metricDescriptions = {};
let siteTitle = '';
let eventsDescription = '';

// --- Israel timezone formatting ---

function formatILDate(d) {
    return d.toLocaleDateString('he-IL', { timeZone: IL_TZ, day: '2-digit', month: '2-digit' });
}

function formatILDateTime(d) {
    return d.toLocaleString('he-IL', {
        timeZone: IL_TZ,
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });
}

function formatILTime(d) {
    return d.toLocaleTimeString('he-IL', { timeZone: IL_TZ, hour: '2-digit', minute: '2-digit' });
}

function formatILDateShort(d) {
    return d.toLocaleString('he-IL', {
        timeZone: IL_TZ,
        day: '2-digit', month: '2-digit',
        hour: '2-digit', minute: '2-digit',
    });
}

// --- 3h averaging ---

function getILHour(d) {
    return parseInt(d.toLocaleString('en-US', { timeZone: IL_TZ, hour: 'numeric', hour12: false }));
}

function getILDateStr(d) {
    return d.toLocaleDateString('en-CA', { timeZone: IL_TZ });
}

function aggregateTo3h(points) {
    if (points.length <= 1) return points;
    const buckets = new Map();
    points.forEach(p => {
        const d = new Date(p.x);
        const ilDate = getILDateStr(d);
        const ilHour = getILHour(d);
        const bucket3h = Math.floor(ilHour / 3) * 3;
        const key = `${ilDate}-${bucket3h}`;
        if (!buckets.has(key)) buckets.set(key, { sum: 0, count: 0, tsSum: 0 });
        const b = buckets.get(key);
        b.sum += p.y;
        b.count += 1;
        b.tsSum += d.getTime();
    });
    return Array.from(buckets.values())
        .map(b => ({ x: new Date(b.tsSum / b.count).toISOString(), y: Math.round(b.sum / b.count * 100) / 100 }))
        .sort((a, b) => a.x.localeCompare(b.x));
}

// --- Chart.js plugin ---

const eventAnnotationPlugin = {
    id: 'eventAnnotations',
    afterDatasetsDraw(chartInstance) {
        const { ctx, chartArea, scales } = chartInstance;
        const xScale = scales.x;
        if (!xScale) return;

        eventPixelPositions = [];

        events.forEach(event => {
            const dateMs = new Date(event.date).getTime();
            const xPos = xScale.getPixelForValue(dateMs);
            if (xPos < chartArea.left - 10 || xPos > chartArea.right + 10) return;

            eventPixelPositions.push({ ...event, xPos });
            const showLine = event.alwaysVisible || hoveredEventId === event.id;

            if (showLine) {
                ctx.save();
                ctx.strokeStyle = event.color;
                ctx.lineWidth = 1.5;
                ctx.setLineDash([6, 4]);
                ctx.globalAlpha = 0.6;
                ctx.beginPath();
                ctx.moveTo(xPos, chartArea.top);
                ctx.lineTo(xPos, chartArea.bottom);
                ctx.stroke();
                ctx.restore();
            }

            const poleH = 20, flagW = 12, flagH = 9;
            const xAxisBottom = scales.x ? scales.x.bottom : chartArea.bottom + 28;
            const flagBottom = xAxisBottom + 4;

            ctx.save();
            ctx.setLineDash([]);
            ctx.strokeStyle = event.color;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(xPos, flagBottom);
            ctx.lineTo(xPos, flagBottom + poleH);
            ctx.stroke();
            ctx.fillStyle = event.color;
            ctx.globalAlpha = showLine ? 0.9 : 0.5;
            ctx.fillRect(xPos + 1, flagBottom, flagW, flagH);
            ctx.restore();
        });
    },
};

Chart.register(eventAnnotationPlugin);

// --- Data loading ---

// Allow configuring base path for when embedded in other pages
const WIDGET_BASE = document.currentScript?.dataset?.base || '';

async function loadData() {
    try {
        const resp = await fetch(WIDGET_BASE + 'data/metrics.json');
        metricsData = await resp.json();
    } catch (e) { console.error('Failed to load data:', e); }
}

async function loadEvents() {
    try {
        const saved = localStorage.getItem('widget_edits');
        let data;
        if (saved) {
            data = JSON.parse(saved);
        } else {
            const resp = await fetch(WIDGET_BASE + 'data/events.json');
            data = await resp.json();
        }
        events = data.events || [];
        metricDescriptions = data.metricDescriptions || {};
        siteTitle = data.title || '';
        eventsDescription = data.description || '';

        const h1 = document.querySelector('.widget-root h1, .widget-root .widget-title');
        if (h1 && siteTitle) h1.textContent = siteTitle;
    } catch (e) {
        console.warn('No events data found');
        events = [];
    }
}

// --- UI ---

function renderMetricButtons() {
    const container = document.getElementById('metricButtons');
    if (!container || !metricsData) return;
    container.innerHTML = '';

    Object.keys(metricsData.metrics).forEach(key => {
        if (!METRIC_CONFIG[key]) return;
        const metric = metricsData.metrics[key];
        const btn = document.createElement('button');
        btn.className = 'metric-btn';
        btn.textContent = metric.name;
        btn.dataset.key = key;

        const isActive = selectedMetrics.includes(key);
        const isFull = selectedMetrics.length >= 2;
        if (isActive) {
            btn.classList.add('active');
            btn.style.borderColor = METRIC_CONFIG[key].color;
            btn.style.background = METRIC_CONFIG[key].bg;
        }
        if (!isActive && isFull) btn.disabled = true;
        btn.addEventListener('click', () => toggleMetric(key));
        container.appendChild(btn);
    });
}

function toggleMetric(key) {
    const idx = selectedMetrics.indexOf(key);
    if (idx !== -1) selectedMetrics.splice(idx, 1);
    else if (selectedMetrics.length < 2) selectedMetrics.push(key);
    renderMetricButtons();
    renderChart();
    updateMetricDescriptions();
}

function updateMetricDescriptions() {
    const container = document.getElementById('metricDescriptions');
    const emptyState = document.getElementById('emptyState');
    if (!container) return;
    container.innerHTML = '';

    if (emptyState) {
        emptyState.style.display = selectedMetrics.length === 0 ? 'block' : 'none';
    }

    selectedMetrics.forEach(key => {
        const desc = metricDescriptions[key];
        if (!desc) return;
        const config = METRIC_CONFIG[key];
        const p = document.createElement('p');
        p.className = 'metric-desc-line';
        p.style.borderColor = config.color;
        p.textContent = desc;
        container.appendChild(p);
    });
}

function setupTimeRange() {
    const buttons = document.querySelectorAll('#timeRange .toggle-btn');
    buttons.forEach(btn => {
        btn.addEventListener('click', () => {
            buttons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            timeRange = btn.dataset.range;
            renderChart();
        });
    });
}

function filterData(dataPoints) {
    const ALL_PERIOD_CUTOFF = new Date('2026-02-24T22:00:00Z');
    if (timeRange === '24h') {
        const cutoff = new Date(Date.now() - 24 * 3600 * 1000);
        return dataPoints.filter(d => new Date(d.timestamp) >= cutoff);
    }
    if (timeRange === '7d') {
        const cutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000);
        return dataPoints.filter(d => new Date(d.timestamp) >= cutoff);
    }
    return dataPoints.filter(d => new Date(d.timestamp) >= ALL_PERIOD_CUTOFF);
}

// --- Popup ---

function showPopup(canvasXPos, title, description, color) {
    const popup = document.getElementById('annotationPopup');
    const wrapper = document.querySelector('.chart-wrapper');
    const canvas = document.getElementById('mainChart');
    if (!popup || !wrapper || !canvas) return;

    document.getElementById('popupTitle').textContent = title;
    document.getElementById('popupTitle').style.color = color || '#e4e4e7';
    document.getElementById('popupDesc').textContent = description;
    popup.style.display = 'block';

    const wrapperRect = wrapper.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const canvasLeft = canvasRect.left - wrapperRect.left;
    const popupWidth = popup.offsetWidth || 280;
    let left = canvasLeft + canvasXPos - popupWidth / 2;
    left = Math.max(8, Math.min(left, wrapperRect.width - popupWidth - 8));
    popup.style.left = left + 'px';
}

function hidePopup() {
    const popup = document.getElementById('annotationPopup');
    if (popup) popup.style.display = 'none';
}

function isNearFlag(x, y) {
    if (!chart) return null;
    const xAxisBottom = chart.scales.x ? chart.scales.x.bottom : chart.chartArea.bottom + 28;
    const flagBottom = xAxisBottom + 4;
    for (const ep of eventPixelPositions) {
        if (Math.abs(x - ep.xPos) < 20 && y >= flagBottom - 5 && y <= flagBottom + 30) return ep;
    }
    return null;
}

function setupCanvasEvents() {
    const canvas = document.getElementById('mainChart');
    if (!canvas) return;

    canvas.addEventListener('mousemove', (e) => {
        if (!chart) return;
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const found = isNearFlag(x, y);

        if (found && hoveredEventId !== found.id) {
            hoveredEventId = found.id;
            showPopup(found.xPos, found.title, found.description, found.color);
            chart.draw();
            canvas.style.cursor = found.url ? 'pointer' : 'default';
        } else if (!found && hoveredEventId) {
            hoveredEventId = null;
            hidePopup();
            chart.draw();
            canvas.style.cursor = 'default';
        }
    });

    canvas.addEventListener('mouseleave', () => {
        if (hoveredEventId) {
            hoveredEventId = null;
            hidePopup();
            if (chart) chart.draw();
        }
        canvas.style.cursor = 'default';
    });

    canvas.addEventListener('click', (e) => {
        if (!chart) return;
        const rect = canvas.getBoundingClientRect();
        const found = isNearFlag(e.clientX - rect.left, e.clientY - rect.top);
        if (found && found.url) window.open(found.url, '_blank');
    });
}

// --- Chart ---

function renderChart() {
    if (!metricsData) return;

    const use3hAvg = timeRange === 'all' || timeRange === '7d';
    const datasets = [];
    const scales = {
        x: {
            type: 'time',
            time: { unit: timeRange === 'all' ? 'day' : 'hour' },
            ticks: {
                callback: function(value) {
                    const d = new Date(value);
                    if (timeRange === 'all') return formatILDate(d);
                    if (timeRange === '7d') return formatILDateShort(d);
                    return formatILTime(d);
                },
                color: '#71717a',
                maxTicksLimit: 12,
            },
            grid: { color: 'rgba(255,255,255,0.04)' },
        },
    };

    const ALL_PERIOD_MIN = '2026-02-24T22:00:00Z';
    if (timeRange === 'all') scales.x.min = ALL_PERIOD_MIN;

    if (selectedMetrics.length === 0) {
        const now = new Date().toISOString();
        if (timeRange === '24h') scales.x.min = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
        else if (timeRange === '7d') scales.x.min = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
        scales.x.max = now;
        scales.y = { display: false };
    }

    selectedMetrics.forEach((key, index) => {
        const metric = metricsData.metrics[key];
        const config = METRIC_CONFIG[key];
        const yAxisID = index === 0 ? 'y' : 'y1';

        let points = filterData(metric.data).map(d => ({ x: d.timestamp, y: d.value }));
        if (use3hAvg) points = aggregateTo3h(points);

        datasets.push({
            label: `${metric.name} (${metric.unit})`,
            data: points,
            borderColor: config.color,
            backgroundColor: config.bg,
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.2,
            fill: false,
            yAxisID,
        });

        scales[yAxisID] = {
            type: 'linear',
            display: true,
            position: index === 0 ? 'left' : 'right',
            title: {
                display: true,
                text: `${metric.name} (${metric.unit})`,
                color: config.color,
                font: { family: "'Heebo', sans-serif", size: 12 },
            },
            ticks: { color: config.color },
            grid: { drawOnChartArea: index === 0, color: 'rgba(255,255,255,0.04)' },
        };
    });

    if (chart) chart.destroy();
    hidePopup();
    hoveredEventId = null;

    const ctx = document.getElementById('mainChart').getContext('2d');
    chart = new Chart(ctx, {
        type: 'line',
        data: { datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: { padding: { bottom: 36, right: 20 } },
            interaction: { mode: 'index', intersect: false },
            plugins: {
                tooltip: {
                    enabled: selectedMetrics.length > 0,
                    backgroundColor: '#1a1d27',
                    borderColor: '#27272a',
                    borderWidth: 1,
                    titleColor: '#e4e4e7',
                    bodyColor: '#e4e4e7',
                    titleFont: { family: "'Heebo', sans-serif" },
                    bodyFont: { family: "'Heebo', sans-serif" },
                    rtl: true,
                    textDirection: 'rtl',
                    callbacks: {
                        title: function(context) {
                            return formatILDateTime(new Date(context[0].parsed.x));
                        },
                    },
                },
                legend: {
                    display: selectedMetrics.length > 0,
                    labels: { color: '#e4e4e7', font: { family: "'Heebo', sans-serif" } },
                },
            },
            scales,
        },
    });
}

function updateTimestamp() {
    if (!metricsData || !metricsData.last_updated) return;
    const el = document.getElementById('lastUpdated');
    if (!el) return;
    const date = new Date(metricsData.last_updated);
    el.textContent = `עדכון אחרון: ${formatILDateTime(date)}`;
}

// Init
document.addEventListener('DOMContentLoaded', async () => {
    await Promise.all([loadData(), loadEvents()]);
    renderMetricButtons();
    setupTimeRange();
    setupCanvasEvents();
    renderChart();
    updateMetricDescriptions();
    updateTimestamp();
});
