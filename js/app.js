// Metric display config
const METRIC_CONFIG = {
    brent_oil:    { color: '#3b82f6', bg: 'rgba(59,130,246,0.08)' },
    ta125:        { color: '#10b981', bg: 'rgba(16,185,129,0.08)' },
    sp500:        { color: '#f59e0b', bg: 'rgba(245,158,11,0.08)' },
    stoxx600:     { color: '#f97316', bg: 'rgba(249,115,22,0.08)' },
    asia_pacific: { color: '#8b5cf6', bg: 'rgba(139,92,246,0.08)' },
};

const IL_TZ = 'Asia/Jerusalem';

// State
let metricsData = null;
let events = [];
let selectedMetrics = ['brent_oil'];
let timeRange = 'all';
let chart = null;
let hoveredEventId = null;
let eventPixelPositions = [];
let metricDescriptions = {};
let siteTitle = '';
let siteSubtitle = '';

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

// --- 3h averaging (buckets in Israel time) ---

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
        .map(b => ({
            x: new Date(b.tsSum / b.count).toISOString(),
            y: Math.round(b.sum / b.count * 100) / 100,
        }))
        .sort((a, b) => a.x.localeCompare(b.x));
}

// --- Custom Chart.js plugin: event flags and vertical lines ---

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

            // Vertical dashed line
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

            // Flag marker below the x-axis labels
            const poleH = 20;
            const flagW = 12;
            const flagH = 9;
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

// --- LocalStorage persistence ---

const STORAGE_KEY = 'widget_edits';

function saveToLocalStorage() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(buildFullJson()));
}

function loadFromLocalStorage() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch { return null; }
}

// --- Data loading ---

async function loadData() {
    try {
        const resp = await fetch('data/metrics.json');
        metricsData = await resp.json();
    } catch (e) {
        console.error('Failed to load data:', e);
    }
}

async function loadEvents() {
    // Try localStorage first (user edits), fall back to events.json
    const saved = loadFromLocalStorage();
    let data;

    if (saved) {
        data = saved;
    } else {
        try {
            const resp = await fetch('data/events.json');
            data = await resp.json();
        } catch (e) {
            console.warn('No events data found');
            events = [];
            return;
        }
    }

    events = data.events || [];
    eventsDescription = data.description || '';
    metricDescriptions = data.metricDescriptions || {};
    siteTitle = data.title || '';
    siteSubtitle = data.subtitle || '';

    // Set title
    if (siteTitle) document.querySelector('h1').textContent = siteTitle;
}

// --- UI controls ---

function renderMetricButtons() {
    const container = document.getElementById('metricButtons');
    container.innerHTML = '';
    if (!metricsData) return;

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
    if (idx !== -1) {
        selectedMetrics.splice(idx, 1);
    } else if (selectedMetrics.length < 2) {
        selectedMetrics.push(key);
    }
    renderMetricButtons();
    renderChart();
    updateMetricDescriptions();
}

function updateMetricDescriptions() {
    const container = document.getElementById('metricDescriptions');
    const emptyState = document.getElementById('emptyState');
    container.innerHTML = '';

    // Empty state CTA
    if (selectedMetrics.length === 0) {
        emptyState.style.display = 'block';
    } else {
        emptyState.style.display = 'none';
    }

    // Per-metric descriptions
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
    // Feb 25 00:00 Israel time = Feb 24 22:00 UTC
    const ALL_PERIOD_CUTOFF = new Date('2026-02-24T22:00:00Z');

    if (timeRange === '24h') {
        const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
        return dataPoints.filter(d => new Date(d.timestamp) >= cutoff);
    }
    if (timeRange === '7d') {
        const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        return dataPoints.filter(d => new Date(d.timestamp) >= cutoff);
    }
    // "all" period: start from Feb 25
    return dataPoints.filter(d => new Date(d.timestamp) >= ALL_PERIOD_CUTOFF);
}

// --- Popup management ---

function showPopup(canvasXPos, title, description, color) {
    const popup = document.getElementById('annotationPopup');
    const wrapper = document.querySelector('.chart-wrapper');
    const canvas = document.getElementById('mainChart');

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
    document.getElementById('annotationPopup').style.display = 'none';
}

// --- Event flag interaction (hover + click) ---

function isNearFlag(x, y) {
    if (!chart) return null;
    const xAxisBottom = chart.scales.x ? chart.scales.x.bottom : chart.chartArea.bottom + 28;
    const flagBottom = xAxisBottom + 4;
    for (const ep of eventPixelPositions) {
        if (Math.abs(x - ep.xPos) < 20 && y >= flagBottom - 5 && y <= flagBottom + 30) {
            return ep;
        }
    }
    return null;
}

function setupCanvasEvents() {
    const canvas = document.getElementById('mainChart');

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
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const found = isNearFlag(x, y);
        if (found && found.url) {
            window.open(found.url, '_blank');
        }
    });
}

// --- Chart rendering ---

function renderChart() {
    if (!metricsData) return;

    const use3hAvg = timeRange === 'all' || timeRange === '7d';
    const datasets = [];
    const scales = {
        x: {
            type: 'time',
            time: {
                unit: timeRange === 'all' ? 'day' : 'hour',
            },
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

    // Feb 25 00:00 Israel time = Feb 24 22:00 UTC
    const ALL_PERIOD_MIN = '2026-02-24T22:00:00Z';

    // Clamp "all" period to start at Feb 25
    if (timeRange === 'all') {
        scales.x.min = ALL_PERIOD_MIN;
    }

    // When no metrics selected, set explicit x-axis range for the timeline
    if (selectedMetrics.length === 0) {
        const now = new Date().toISOString();
        if (timeRange === '24h') {
            scales.x.min = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
        } else if (timeRange === '7d') {
            scales.x.min = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
        }
        scales.x.max = now;
        scales.y = { display: false };
    }

    selectedMetrics.forEach((key, index) => {
        const metric = metricsData.metrics[key];
        const config = METRIC_CONFIG[key];
        const yAxisID = index === 0 ? 'y' : 'y1';

        let points = filterData(metric.data).map(d => ({
            x: d.timestamp,
            y: d.value,
        }));

        if (use3hAvg) {
            points = aggregateTo3h(points);
        }

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
            grid: {
                drawOnChartArea: index === 0,
                color: 'rgba(255,255,255,0.04)',
            },
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
                            const d = new Date(context[0].parsed.x);
                            return formatILDateTime(d);
                        },
                    },
                },
                legend: {
                    display: selectedMetrics.length > 0,
                    labels: {
                        color: '#e4e4e7',
                        font: { family: "'Heebo', sans-serif" },
                    },
                },
            },
            scales,
        },
    });
}

function updateTimestamp() {
    if (!metricsData || !metricsData.last_updated) return;
    const el = document.getElementById('lastUpdated');
    const date = new Date(metricsData.last_updated);
    el.textContent = `עדכון אחרון: ${formatILDateTime(date)}`;
}

// --- Event editor ---

let editingEventId = null;
let selectedColor = '#ef4444';
let eventsDescription = '';

function utcToILInput(utcIso) {
    const d = new Date(utcIso);
    const ilStr = d.toLocaleString('sv-SE', { timeZone: IL_TZ });
    return ilStr.slice(0, 16).replace(' ', 'T');
}

function ilInputToUtc(ilDateTimeStr) {
    const [datePart, timePart] = ilDateTimeStr.split('T');
    const [y, m, d] = datePart.split('-').map(Number);
    const [h, min] = timePart.split(':').map(Number);

    // Try UTC+2 and UTC+3 (Israel winter/summer), pick the one that round-trips
    for (const offset of [2, 3]) {
        const utc = new Date(Date.UTC(y, m - 1, d, h - offset, min));
        const check = utc.toLocaleString('sv-SE', { timeZone: IL_TZ });
        if (check.startsWith(ilDateTimeStr.replace('T', ' '))) {
            return utc.toISOString().replace(/\.\d{3}Z$/, 'Z');
        }
    }
    // Fallback: UTC+2
    return new Date(Date.UTC(y, m - 1, d, h - 2, min)).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function renderEventList() {
    const container = document.getElementById('eventList');
    container.innerHTML = '';

    events.forEach(ev => {
        const row = document.createElement('div');
        row.className = 'event-row';

        const dot = document.createElement('span');
        dot.className = 'event-color-dot';
        dot.style.background = ev.color;

        const title = document.createElement('span');
        title.className = 'event-row-title';
        title.textContent = ev.title;

        const date = document.createElement('span');
        date.className = 'event-row-date';
        date.textContent = formatILDateTime(new Date(ev.date));

        const linkIndicator = document.createElement('span');
        linkIndicator.className = 'event-row-link';
        linkIndicator.textContent = ev.url ? '[link]' : '';

        const editBtn = document.createElement('button');
        editBtn.className = 'event-action';
        editBtn.textContent = '\u270E';
        editBtn.title = 'עריכה';
        editBtn.addEventListener('click', () => openEditForm(ev.id));

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'event-action delete';
        deleteBtn.textContent = '\u2715';
        deleteBtn.title = 'מחיקה';
        deleteBtn.addEventListener('click', () => deleteEvent(ev.id));

        row.append(dot, title, date, linkIndicator, editBtn, deleteBtn);
        container.appendChild(row);
    });
}

function openAddForm() {
    editingEventId = null;
    document.getElementById('evTitle').value = '';
    document.getElementById('evDesc').value = '';
    document.getElementById('evDate').value = '';
    document.getElementById('evUrl').value = '';
    document.getElementById('evAlwaysVisible').checked = false;
    selectColor('#ef4444');
    document.getElementById('eventForm').style.display = 'block';
}

function openEditForm(id) {
    const ev = events.find(e => e.id === id);
    if (!ev) return;
    editingEventId = id;
    document.getElementById('evTitle').value = ev.title;
    document.getElementById('evDesc').value = ev.description;
    document.getElementById('evDate').value = utcToILInput(ev.date);
    document.getElementById('evUrl').value = ev.url || '';
    document.getElementById('evAlwaysVisible').checked = !!ev.alwaysVisible;
    selectColor(ev.color);
    document.getElementById('eventForm').style.display = 'block';
}

function closeForm() {
    document.getElementById('eventForm').style.display = 'none';
    editingEventId = null;
}

function selectColor(color) {
    selectedColor = color;
    document.querySelectorAll('.color-swatch').forEach(sw => {
        sw.classList.toggle('selected', sw.dataset.color === color);
    });
}

function saveEvent() {
    const title = document.getElementById('evTitle').value.trim();
    const description = document.getElementById('evDesc').value.trim();
    const dateVal = document.getElementById('evDate').value;
    const url = document.getElementById('evUrl').value.trim();
    const alwaysVisible = document.getElementById('evAlwaysVisible').checked;

    if (!title || !dateVal) return;

    const utcDate = ilInputToUtc(dateVal);

    if (editingEventId) {
        const ev = events.find(e => e.id === editingEventId);
        if (ev) {
            ev.title = title;
            ev.description = description;
            ev.date = utcDate;
            ev.url = url;
            ev.color = selectedColor;
            ev.alwaysVisible = alwaysVisible;
        }
    } else {
        const id = 'ev_' + Date.now();
        events.push({ id, date: utcDate, title, description, url, alwaysVisible, color: selectedColor });
    }

    closeForm();
    renderEventList();
    renderChart();
    saveToLocalStorage();
}

function deleteEvent(id) {
    events = events.filter(e => e.id !== id);
    renderEventList();
    renderChart();
    saveToLocalStorage();
}

function buildFullJson() {
    return {
        title: siteTitle,
        subtitle: siteSubtitle,
        description: eventsDescription,
        metricDescriptions: metricDescriptions,
        events: events.map(e => ({
            id: e.id,
            date: e.date,
            title: e.title,
            description: e.description,
            url: e.url || '',
            alwaysVisible: !!e.alwaysVisible,
            color: e.color,
        })),
    };
}

function copyEventsJson() {
    const json = JSON.stringify(buildFullJson(), null, 2);
    const btn = document.getElementById('copyJsonBtn');
    navigator.clipboard.writeText(json).then(() => {
        btn.textContent = 'הועתק!';
        setTimeout(() => { btn.textContent = 'העתק JSON'; }, 2000);
    });
}

function copyTextsJson() {
    const json = JSON.stringify(buildFullJson(), null, 2);
    const btn = document.getElementById('copyTextsBtn');
    navigator.clipboard.writeText(json).then(() => {
        btn.textContent = 'הועתק!';
        setTimeout(() => { btn.textContent = 'העתק JSON'; }, 2000);
    });
}

function setupEditor() {
    document.getElementById('addEventBtn').addEventListener('click', openAddForm);
    document.getElementById('cancelEventBtn').addEventListener('click', closeForm);
    document.getElementById('saveEventBtn').addEventListener('click', saveEvent);
    document.getElementById('copyJsonBtn').addEventListener('click', copyEventsJson);

    document.querySelectorAll('.color-swatch').forEach(sw => {
        sw.addEventListener('click', () => selectColor(sw.dataset.color));
    });

    renderEventList();
}

function setupTextEditor() {
    const titleInput = document.getElementById('editTitle');

    titleInput.value = siteTitle;

    titleInput.addEventListener('input', () => {
        siteTitle = titleInput.value;
        document.querySelector('h1').textContent = siteTitle;
        saveToLocalStorage();
    });

    document.getElementById('copyTextsBtn').addEventListener('click', copyTextsJson);

    // Build per-metric description fields
    renderMetricDescFields();
}

function renderMetricDescFields() {
    const container = document.getElementById('metricDescFields');
    container.innerHTML = '';
    if (!metricsData) return;

    Object.keys(metricsData.metrics).forEach(key => {
        if (!METRIC_CONFIG[key]) return;
        const metric = metricsData.metrics[key];
        const row = document.createElement('div');
        row.className = 'form-row';
        const label = document.createElement('label');
        label.textContent = `תיאור: ${metric.name}`;
        label.setAttribute('for', `desc_${key}`);
        const input = document.createElement('input');
        input.type = 'text';
        input.id = `desc_${key}`;
        input.value = metricDescriptions[key] || '';
        input.addEventListener('input', () => {
            metricDescriptions[key] = input.value;
            updateMetricDescriptions();
            saveToLocalStorage();
        });
        row.append(label, input);
        container.appendChild(row);
    });
}

// Init
document.addEventListener('DOMContentLoaded', async () => {
    await Promise.all([loadData(), loadEvents()]);
    renderMetricButtons();
    setupTimeRange();
    setupCanvasEvents();
    setupEditor();
    setupTextEditor();
    renderChart();
    updateMetricDescriptions();
    updateTimestamp();
});
