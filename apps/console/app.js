const state = {
  orgs: [],
  orgId: localStorage.getItem('mm_org_id') || '',
};

const API_ORIGIN = window.MONKEYS_MEMORY_API_URL
  || (window.location.port === '8080' ? `${window.location.protocol}//${window.location.hostname}:3000` : '');

const $ = (id) => document.getElementById(id);

function toast(message, type = 'info') {
  const box = $('toast');
  box.textContent = message;
  box.className = `toast show ${type === 'error' ? 'error' : ''}`;
  window.setTimeout(() => {
    box.className = 'toast';
  }, 2800);
}

async function api(path, options = {}, config = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  if (config.withOrg !== false && state.orgId) headers['X-Org-Id'] = state.orgId;

  const response = await fetch(`${API_ORIGIN}/api/v1${path}`, {
    ...options,
    headers,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed: ${response.status}`);
  return data;
}

function renderOrgs() {
  const select = $('orgSelect');
  select.innerHTML = '';
  for (const org of state.orgs) {
    const option = document.createElement('option');
    option.value = org.id;
    option.textContent = `${org.name} (${org.role})`;
    select.append(option);
  }
  if (state.orgs.length > 0) {
    if (!state.orgs.some((org) => org.id === state.orgId)) state.orgId = state.orgs[0].id;
    select.value = state.orgId;
    localStorage.setItem('mm_org_id', state.orgId);
  } else {
    state.orgId = '';
    localStorage.removeItem('mm_org_id');
  }
}

function renderRepos(repos) {
  const list = $('repoList');
  list.innerHTML = '';
  if (!repos.length) {
    list.innerHTML = '<div class="list-item"><strong>No repositories yet</strong><span>Add one to start capturing memory.</span></div>';
    return;
  }
  for (const repo of repos) {
    const item = document.createElement('div');
    item.className = 'list-item';
    item.innerHTML = `
      <strong>${escapeHtml(repo.name)}</strong>
      <span>${repo.experience_count || 0} experiences · ${repo.last_compiled_at ? `compiled ${new Date(repo.last_compiled_at).toLocaleString()}` : 'not compiled yet'}</span>
    `;
    list.append(item);
  }
}

function formatPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0%';
  return `${Math.round(number * 100)}%`;
}

function gradeLabel(grade) {
  return ({
    strong: 'Strong signal',
    positive: 'Positive signal',
    emerging: 'Emerging signal',
    weak: 'Weak signal',
    'no-signal': 'No signal yet',
  })[grade] || grade || 'No signal yet';
}

function renderEffectiveness(effectiveness = {}) {
  const evaluated = Number(effectiveness.evaluated_memory_count || 0);
  $('effectivenessScore').textContent = String(effectiveness.score || 0);
  $('effectivenessGrade').textContent = gradeLabel(effectiveness.grade);
  $('effectivenessEvaluated').textContent = String(evaluated);
  $('effectivenessAdoption').textContent = formatPercent(effectiveness.adoption_rate);
  $('effectivenessVerified').textContent = formatPercent(effectiveness.verified_success_rate);
  $('effectivenessCoverage').textContent = formatPercent(effectiveness.evaluation_coverage_rate);
  $('effectivenessEmpty').classList.toggle('hidden', evaluated > 0);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

async function refreshOrgs() {
  const data = await api('/orgs', {}, { withOrg: false });
  state.orgs = data.organizations || [];
  renderOrgs();
  await refreshRepos().catch(() => {});
  await refreshAnalytics().catch(() => {});
  return data;
}

async function refreshRepos() {
  if (!state.orgId) {
    renderRepos([]);
    return;
  }
  const data = await api('/repos');
  renderRepos(data.repos || []);
}

async function refreshAnalytics() {
  if (!state.orgId) {
    renderEffectiveness();
    return;
  }
  const data = await api('/analytics/overview');
  renderEffectiveness(data.impact?.agent_effectiveness || {});
}

async function checkHealth() {
  try {
    const res = await fetch(`${API_ORIGIN}/health`);
    if (!res.ok) throw new Error('API unavailable');
    $('healthStatus').textContent = 'API online';
    $('healthStatus').className = 'status ok';
  } catch {
    $('healthStatus').textContent = 'API offline';
    $('healthStatus').className = 'status error';
  }
}

$('orgForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = $('orgNameInput').value.trim();
  if (!name) return;
  try {
    const data = await api('/orgs', { method: 'POST', body: JSON.stringify({ name }) }, { withOrg: false });
    state.orgId = data.organization.id;
    $('orgNameInput').value = '';
    await refreshOrgs();
    toast('Organization created');
  } catch (error) {
    toast(error.message, 'error');
  }
});

$('orgSelect').addEventListener('change', async (event) => {
  state.orgId = event.target.value;
  localStorage.setItem('mm_org_id', state.orgId);
  await refreshRepos();
  await refreshAnalytics().catch(() => {});
});

$('repoForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = $('repoNameInput').value.trim();
  if (!name) return;
  try {
    await api('/repos', { method: 'POST', body: JSON.stringify({ name }) });
    $('repoNameInput').value = '';
    $('captureRepoInput').value = name;
    $('retrieveRepoInput').value = name;
    await refreshRepos();
    await refreshAnalytics().catch(() => {});
    toast('Repository added');
  } catch (error) {
    toast(error.message, 'error');
  }
});

$('captureForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const repo = $('captureRepoInput').value.trim();
  const body = {
    repo,
    title: $('captureTitleInput').value.trim(),
    claim: $('captureClaimInput').value.trim(),
    scope: {
      paths: $('capturePathsInput').value.split(',').map((item) => item.trim()).filter(Boolean),
      task_types: $('captureTasksInput').value.split(',').map((item) => item.trim()).filter(Boolean),
    },
  };
  try {
    await api('/capture', { method: 'POST', body: JSON.stringify(body) });
    await refreshRepos();
    await refreshAnalytics().catch(() => {});
    $('retrieveRepoInput').value = repo;
    toast('Memory captured');
  } catch (error) {
    toast(error.message, 'error');
  }
});

$('retrieveForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const body = {
    repo: $('retrieveRepoInput').value.trim(),
    path: $('retrievePathInput').value.trim() || undefined,
    task: $('retrieveTaskInput').value.trim() || undefined,
    limit: 5,
  };
  try {
    const data = await api('/retrieve', { method: 'POST', body: JSON.stringify(body) });
    $('retrieveOutput').textContent = JSON.stringify(data, null, 2);
    await refreshAnalytics().catch(() => {});
  } catch (error) {
    toast(error.message, 'error');
  }
});

$('refreshAnalyticsButton').addEventListener('click', async () => {
  try {
    await refreshAnalytics();
    toast('Effectiveness refreshed');
  } catch (error) {
    toast(error.message, 'error');
  }
});

checkHealth();
refreshOrgs().catch(() => {});
