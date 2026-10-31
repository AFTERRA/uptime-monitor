const state = { monitors: [], refreshing: false };
const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
let toastTimer;

function toast(message, error = false) {
  const element = $('#toast');
  element.textContent = message;
  element.className = `toast show${error ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { element.className = 'toast'; }, 3000);
}

function relativeTime(value) {
  if (!value) return 'Never';
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 5) return 'Just now';
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.floor(seconds / 60)}m ago`;
}

function averageResponse(monitor) {
  const successful = monitor.history.filter((item) => item.status === 'up');
  if (!successful.length) return '—';
  const average = successful.reduce((sum, item) => sum + item.latencyMs, 0) / successful.length;
  return `${Math.round(average)} ms`;
}

function monitoringTime(monitor) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(monitor.createdAt).getTime()) / 1000));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function updateStats() {
  const total = state.monitors.length;
  const up = state.monitors.filter((monitor) => monitor.status === 'up').length;
  const down = state.monitors.filter((monitor) => monitor.status === 'down').length;
  $('#stat-total').textContent = total;
  $('#stat-up').textContent = up;
  $('#stat-down').textContent = down;
  $('#monitor-count').textContent = `${total} SITE${total === 1 ? '' : 'S'}`;
}

function historyChart(monitor) {
  if (!monitor.history.length) return '<div class="history-empty">Waiting for the first check…</div>';
  const values = monitor.history.slice(-24);
  const maximum = Math.max(...values.map((item) => item.latencyMs), 1);
  return `<div class="history">${values.map((item) => {
    const height = Math.max(12, Math.round((item.latencyMs / maximum) * 100));
    const title = `${item.status.toUpperCase()} · ${item.latencyMs} ms · ${new Date(item.checkedAt).toLocaleTimeString()}`;
    return `<span class="history-bar ${item.status}" style="height:${height}%" title="${escapeHtml(title)}"></span>`;
  }).join('')}</div><div class="history-caption"><span>OLDER</span><span>LAST ${values.length} CHECKS</span><span>NEWER</span></div>`;
}

function render() {
  updateStats();
  if (!state.monitors.length) {
    $('#monitor-grid').innerHTML = '<div class="empty-state"><span>⌁</span><h3>No websites monitored yet</h3><p>Add a URL above or start with a demo site.</p></div>';
    return;
  }
  $('#monitor-grid').innerHTML = state.monitors.map((monitor) => `
    <article class="monitor-card" data-id="${escapeHtml(monitor.id)}">
      <div class="card-top"><div><h3 class="site-name">${escapeHtml(monitor.name)}</h3><span class="site-url" title="${escapeHtml(monitor.url)}">${escapeHtml(monitor.url)}</span></div><span class="status ${escapeHtml(monitor.status)}">${escapeHtml(monitor.status)}</span></div>
      <div class="metrics">
        <div class="metric"><span>AVG. RESPONSE TIME</span><strong>${averageResponse(monitor)}</strong></div>
        <div class="metric"><span>TOTAL ERRORS</span><strong>${monitor.totalErrors ?? 0}</strong></div>
        <div class="metric"><span>LAST CHECK</span><strong>${escapeHtml(relativeTime(monitor.lastCheckedAt))}</strong></div>
        <div class="metric"><span>TOTAL MONITOR TIME</span><strong>${monitoringTime(monitor)}</strong></div>
      </div>
      ${historyChart(monitor)}
      <div class="card-footer"><div><div class="schedule">EVERY ${monitor.intervalMs / 1000} SEC</div>${monitor.lastError ? `<div class="last-error" title="${escapeHtml(monitor.lastError)}">${escapeHtml(monitor.lastError)}</div>` : ''}</div><div class="card-actions"><button class="action check" ${monitor.status === 'checking' ? 'disabled' : ''}>Check now</button><button class="action delete">Remove</button></div></div>
    </article>`).join('');
}

async function refresh() {
  if (state.refreshing) return;
  state.refreshing = true;
  try {
    const response = await fetch('/api/monitors');
    const data = await response.json();
    state.monitors = data.monitors;
    render();
  } finally {
    state.refreshing = false;
  }
}

async function addMonitor(name, url, intervalSeconds = 10) {
  const response = await fetch('/api/monitors', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, url, intervalSeconds }) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not add monitor');
  await refresh();
}

$('#add-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.target.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await addMonitor($('#name').value, $('#url').value, Number($('#interval').value));
    event.target.reset();
    $('#interval').value = '30';
    toast('Monitoring started');
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
  }
});

document.querySelectorAll('[data-demo]').forEach((button) => button.addEventListener('click', async () => {
  const kind = button.dataset.demo;
  button.disabled = true;
  try {
    await addMonitor(`Demo · ${kind[0].toUpperCase()}${kind.slice(1)}`, `${window.location.origin}/demo/${kind}`, 10);
    toast(`${kind} demo added`);
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
  }
}));

$('#monitor-grid').addEventListener('click', async (event) => {
  const button = event.target.closest('button');
  const card = event.target.closest('.monitor-card');
  if (!button || !card) return;
  const id = card.dataset.id;
  button.disabled = true;
  try {
    if (button.classList.contains('delete')) {
      const response = await fetch(`/api/monitors/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Could not remove monitor');
      toast('Monitor removed');
    } else {
      const response = await fetch(`/api/monitors/${id}/check`, { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Check failed');
      toast('Check completed');
    }
    await refresh();
  } catch (error) {
    toast(error.message, true);
    button.disabled = false;
  }
});

refresh();
setInterval(refresh, 2000);
