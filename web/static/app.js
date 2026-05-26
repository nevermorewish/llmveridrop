// Mobile nav hamburger toggle. Pure aria-expanded toggling; CSS does the
// rest via the sibling selector. Closes on outside tap, on ESC, and on
// link tap so the dropdown doesn't linger after navigation.
(function () {
  const toggle = document.querySelector('.nav-toggle');
  const nav = document.getElementById('site-nav');
  if (!toggle || !nav) return;

  function setOpen(open) {
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    toggle.setAttribute('aria-label', open ? '关闭菜单' : '打开菜单');
  }

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = toggle.getAttribute('aria-expanded') === 'true';
    setOpen(!isOpen);
  });

  // Close on tap outside the dropdown.
  document.addEventListener('click', (e) => {
    if (toggle.getAttribute('aria-expanded') !== 'true') return;
    if (nav.contains(e.target) || toggle.contains(e.target)) return;
    setOpen(false);
  });

  // Close after a nav link is tapped — otherwise the panel stays open over
  // the new page transition (jarring on mobile).
  nav.addEventListener('click', (e) => {
    if (e.target.tagName === 'A') setOpen(false);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setOpen(false);
  });
})();


// Custom model-name combobox: type-to-filter + tap-to-select.
// Replaces native <datalist> because iOS Safari / WeChat browser don't show
// it reliably on mobile.
(function () {
  const input = document.getElementById('model');
  const list = document.getElementById('model-list');
  if (!input || !list) return;
  let items = Array.from(list.querySelectorAll('.combo-item'));

  // De-emphasize non-matches instead of hiding them. Users repeatedly
  // expected the dropdown to show ALL probed models even after typing a
  // partial name (so they can compare options or pick a sibling). Hiding
  // made the relay's full whitelist invisible — exactly the opposite of
  // what /api/probe was meant to surface. Dimming preserves discoverability
  // while still highlighting the current text query.
  function filter(q) {
    const ql = (q || '').toLowerCase().trim();
    items.forEach((it) => {
      const v = (it.getAttribute('data-value') || '').toLowerCase();
      const match = ql === '' || v.includes(ql);
      it.classList.toggle('no-match', !match);
      it.hidden = false;
    });
    list.hidden = items.length === 0;
  }

  function bindItem(it) {
    // pointerdown beats focus loss; preventDefault keeps input focused so
    // mobile keyboard doesn't close before we set the value.
    it.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      input.value = it.getAttribute('data-value');
      list.hidden = true;
      input.blur();
    });
  }
  items.forEach(bindItem);

  // Exposed so the probe layer can replace the suggestions with whatever
  // the relay actually advertises. Falls back to the static template list
  // if probe fails / relay doesn't expose /v1/models.
  window.veridropSetModelChoices = function (values) {
    list.innerHTML = '';
    values.forEach((v) => {
      const li = document.createElement('li');
      li.className = 'combo-item';
      li.setAttribute('data-value', v);
      li.textContent = v;
      list.appendChild(li);
    });
    items = Array.from(list.querySelectorAll('.combo-item'));
    items.forEach(bindItem);
  };

  input.addEventListener('focus', () => filter(input.value));
  input.addEventListener('input', () => filter(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') list.hidden = true;
  });

  document.addEventListener('pointerdown', (e) => {
    if (e.target === input || list.contains(e.target)) return;
    list.hidden = true;
  });
})();


// Pre-submission probe: hit /api/probe on api_key blur, render an inline
// pill below the api_key input describing what the relay carries, replace
// the model dropdown with the actually-available models, and (when the
// current protocol has 0 matches) offer one-click handoff to a protocol
// the relay DOES carry.
(function () {
  const form = document.getElementById('detect-form');
  if (!form) return;
  const protocol =
    location.pathname.startsWith('/claude') ? 'anthropic' :
    location.pathname.startsWith('/openai') ? 'openai' :
    location.pathname.startsWith('/gemini') ? 'gemini' :
    location.pathname.startsWith('/deepseek') ? 'deepseek' : null;
  if (!protocol) return;

  const baseUrlInput = document.getElementById('base_url');
  const apiKeyInput = document.getElementById('api_key');
  const modelInput = document.getElementById('model');
  const submitBtn = document.getElementById('submit-btn');
  if (!baseUrlInput || !apiKeyInput || !modelInput || !submitBtn) return;

  form.dataset.batch = 'true';
  baseUrlInput.required = false;
  apiKeyInput.required = false;

  const baseField = baseUrlInput.closest('.field');
  const keyField = apiKeyInput.closest('.field');
  if (baseField) baseField.remove();
  if (keyField) keyField.remove();

  const protocolLabel = {
    anthropic: 'Claude',
    openai: 'OpenAI',
    gemini: 'Gemini',
    deepseek: 'DeepSeek',
  }[protocol];
  submitBtn.textContent = '开始批量检测';

  const panel = document.createElement('div');
  panel.className = 'batch-panel';
  panel.innerHTML = `
    <div class="batch-head">
      <div>
        <h2>多家中转站对比检测</h2>
        <p>一次提交多组接口地址和 API key，完成后按分数、结论和 detector 明细并排对比。每一组仍会生成独立永久报告链接。</p>
      </div>
      <div class="batch-actions">
        <button type="button" class="btn btn-ghost" id="batch-import-btn">导入 JSON</button>
        <button type="button" class="btn btn-ghost" id="batch-export-config-btn">导出配置</button>
      </div>
    </div>
    <div class="batch-table-wrap">
      <table class="batch-table" aria-label="${protocolLabel} relays">
        <thead>
          <tr>
            <th>中转站接口地址</th>
            <th>API 密钥</th>
            <th>状态</th>
            <th class="batch-row-actions">操作</th>
          </tr>
        </thead>
        <tbody id="batch-relay-list"></tbody>
      </table>
    </div>
    <div class="batch-toolbar">
      <button type="button" class="btn btn-ghost" id="batch-add-btn">添加中转站</button>
      <span class="batch-note">导出配置会包含明文 API key，只适合保存在你自己的本机环境。</span>
    </div>
    <input type="file" id="batch-import-file" accept="application/json,.json" hidden />
  `;
  form.insertBefore(panel, form.firstElementChild);
  const toolbar = panel.querySelector('.batch-toolbar');
  const toolbarActions = panel.querySelector('.batch-actions');
  const toolbarNote = panel.querySelector('.batch-note');
  if (toolbar && toolbarActions) {
    toolbar.insertBefore(toolbarActions, toolbarNote || null);
  }
  const settingsRow = form.querySelector('.field-row');
  if (settingsRow) {
    const settingsPanel = document.createElement('div');
    settingsPanel.className = 'batch-settings-panel';
    settingsPanel.innerHTML = `
      <div class="batch-step-head">
        <span>步骤 1</span>
        <div>
          <h2>先设置检测参数</h2>
          <p>目标模型和检测深度会应用到下面所有中转站。长上下文选项会显著增加每一组 API key 的消耗。</p>
        </div>
      </div>
    `;
    form.insertBefore(settingsPanel, panel);
    settingsRow.classList.add('batch-settings-grid');
    settingsPanel.appendChild(settingsRow);
    ['include_long_context', 'include_long_context_extreme'].forEach((id) => {
      const option = document.getElementById(id);
      const field = option && option.closest('.field-checkbox');
      if (field) settingsPanel.appendChild(field);
    });
  }
  const batchHead = panel.querySelector('.batch-head');
  if (batchHead) {
    const stepHead = document.createElement('div');
    stepHead.className = 'batch-step-head batch-step-head-compact';
    stepHead.innerHTML = `
      <span>步骤 2</span>
      <div>
        <h2>添加要对比的中转站</h2>
        <p>每一行填写一组接口地址和 API key，可导入 JSON 或继续添加多行。</p>
      </div>
    `;
    batchHead.replaceChildren(stepHead);
  }
  const formError = document.getElementById('form-error');
  if (submitBtn && formError) {
    const submitPanel = document.createElement('div');
    submitPanel.className = 'batch-submit-panel';
    submitPanel.innerHTML = `
      <div class="batch-step-head batch-step-head-submit">
        <span>步骤 3</span>
        <div>
          <h2>开始批量测试</h2>
          <p>确认模型、检测深度和中转站列表后提交。每一组都会生成独立永久报告链接。</p>
        </div>
      </div>
    `;
    form.insertBefore(submitPanel, submitBtn);
    submitPanel.appendChild(submitBtn);
    submitPanel.appendChild(formError);
  }

  const resultPanel = document.createElement('section');
  resultPanel.className = 'batch-results';
  resultPanel.id = 'batch-results';
  resultPanel.hidden = true;
  const formCard = form.closest('.form-card') || form.parentNode;
  formCard.parentNode.insertBefore(resultPanel, formCard.nextSibling);

  const list = document.getElementById('batch-relay-list');
  const importFile = document.getElementById('batch-import-file');
  let rowSeq = 0;
  let activeRun = null;

  function addRow(data) {
    rowSeq += 1;
    const tr = document.createElement('tr');
    tr.className = 'batch-relay-row';
    tr.dataset.rowId = String(rowSeq);
    tr.innerHTML = `
      <td>
        <input class="batch-base-url" type="url" value="${escapeAttr(data && data.base_url || '')}" placeholder="https://api.example.com/v1" />
      </td>
      <td>
        <input class="batch-api-key" type="password" value="${escapeAttr(data && data.api_key || '')}" placeholder="sk-..." autocomplete="off" />
      </td>
      <td class="batch-status" data-state="idle">待检测</td>
      <td class="batch-row-actions">
        <button type="button" class="btn btn-ghost batch-remove">移除</button>
      </td>
    `;
    list.appendChild(tr);
    tr.querySelector('.batch-remove').addEventListener('click', () => {
      if (list.querySelectorAll('tr').length <= 1) {
        clearRow(tr);
        return;
      }
      tr.remove();
      renumberPlaceholders();
    });
  }

  function clearRow(tr) {
    tr.querySelector('.batch-base-url').value = '';
    tr.querySelector('.batch-api-key').value = '';
    setRowStatus(tr, 'idle', '待检测');
  }

  function renumberPlaceholders() {
    return;
  }

  function collectRows() {
    return Array.from(list.querySelectorAll('tr')).map((tr, idx) => {
      const baseUrl = tr.querySelector('.batch-base-url').value.trim();
      return {
        row: tr,
        name: baseUrl || `中转站 ${idx + 1}`,
        base_url: baseUrl,
        api_key: tr.querySelector('.batch-api-key').value.trim(),
      };
    });
  }

  function collectConfig(includeKeys) {
    const cfg = {
      version: 1,
      protocol,
      model: modelInput.value.trim(),
      mode: (form.querySelector('[name="mode"]') || {}).value || '',
      include_long_context: Boolean(form.querySelector('[name="include_long_context"]') && form.querySelector('[name="include_long_context"]').checked),
      include_long_context_extreme: Boolean(form.querySelector('[name="include_long_context_extreme"]') && form.querySelector('[name="include_long_context_extreme"]').checked),
      relays: collectRows()
        .filter((item) => item.base_url || item.api_key)
        .map((item) => ({
          base_url: item.base_url,
          api_key: includeKeys ? item.api_key : undefined,
        })),
    };
    cfg.relays.forEach((relay) => {
      if (relay.api_key === undefined) delete relay.api_key;
    });
    return cfg;
  }

  function applyConfig(cfg) {
    if (!cfg || !Array.isArray(cfg.relays)) {
      throw new Error('JSON 中缺少 relays 数组');
    }
    if (cfg.model && typeof cfg.model === 'string') modelInput.value = cfg.model;
    const mode = form.querySelector('[name="mode"]');
    if (mode && cfg.mode) mode.value = cfg.mode;
    const longContext = form.querySelector('[name="include_long_context"]');
    if (longContext) longContext.checked = Boolean(cfg.include_long_context);
    const extreme = form.querySelector('[name="include_long_context_extreme"]');
    if (extreme) extreme.checked = Boolean(cfg.include_long_context_extreme);

    list.innerHTML = '';
    rowSeq = 0;
    cfg.relays.forEach((relay) => addRow({
      base_url: String(relay.base_url || relay.url || ''),
      api_key: String(relay.api_key || relay.key || ''),
    }));
    if (!list.children.length) addRow();
  }

  function validateRows(rows) {
    const errors = [];
    rows.forEach((item) => {
      if (!/^https?:\/\//.test(item.base_url)) {
        errors.push(`${item.name}: 接口地址必须以 http:// 或 https:// 开头`);
        setRowStatus(item.row, 'error', '地址无效');
      }
      if (!item.api_key || item.api_key.length < 8) {
        errors.push(`${item.name}: API key 不能为空且至少 8 位`);
        setRowStatus(item.row, 'error', 'key 无效');
      }
    });
    return errors;
  }

  function endpointFor() {
    return form.getAttribute('data-endpoint')
      || (protocol === 'anthropic' ? '/api/detect/claude'
        : protocol === 'openai' ? '/api/detect/openai'
        : protocol === 'gemini' ? '/api/detect/gemini'
        : '/api/detect/deepseek');
  }

  async function submitOne(item) {
    setRowStatus(item.row, 'queued', '提交中');
    const fd = new FormData();
    fd.set('base_url', item.base_url);
    fd.set('api_key', item.api_key);
    fd.set('model', modelInput.value.trim());
    fd.set('mode', (form.querySelector('[name="mode"]') || {}).value || 'standard');
    const longContext = form.querySelector('[name="include_long_context"]');
    const extreme = form.querySelector('[name="include_long_context_extreme"]');
    if (longContext && longContext.checked) fd.set('include_long_context', 'true');
    if (extreme && extreme.checked) fd.set('include_long_context_extreme', 'true');
    fd.set('force', '1');

    const r = await fetch(endpointFor(), {method: 'POST', body: fd});
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      const msg = typeof j.detail === 'string' ? j.detail
        : (j.detail && (j.detail.message || j.detail.upstream_error)) || `HTTP ${r.status}`;
      throw new Error(msg);
    }
    const j = await r.json();
    setRowStatus(item.row, 'running', '运行中');
    return j.job_id;
  }

  async function pollJob(item, jobId) {
    while (true) {
      if (activeRun && activeRun.cancelled) throw new Error('已取消');
      const r = await fetch('/api/status/' + encodeURIComponent(jobId), {cache: 'no-store'});
      if (!r.ok) throw new Error('状态查询失败: HTTP ' + r.status);
      const status = await r.json();
      if (status.status === 'queued') setRowStatus(item.row, 'queued', '排队中');
      if (status.status === 'running') setRowStatus(item.row, 'running', '检测中');
      if (status.status === 'error') throw new Error(status.error || '检测失败');
      if (status.status === 'done') {
        const rr = await fetch(status.json_url, {cache: 'no-store'});
        if (!rr.ok) throw new Error('报告读取失败: HTTP ' + rr.status);
        const report = await rr.json();
        setRowStatus(item.row, 'done', `${Math.round(Number(report.total_score || 0))}/100`);
        return {
          name: item.name,
          base_url: item.base_url,
          job_id: jobId,
          result_url: status.result_url,
          image_url: status.image_url,
          json_url: status.json_url,
          report,
        };
      }
      await delay(1600);
    }
  }

  async function runBatch() {
    const errBox = document.getElementById('form-error');
    if (errBox) {
      errBox.hidden = true;
      errBox.textContent = '';
      errBox.classList.remove('form-error-rich');
    }
    const rows = collectRows().filter((item) => item.base_url || item.api_key);
    if (!rows.length) {
      showFormError('至少添加一家中转站');
      return;
    }
    const errors = validateRows(rows);
    if (errors.length) {
      showFormError(errors.join('；'));
      return;
    }

    activeRun = {cancelled: false, started_at: new Date().toISOString()};
    submitBtn.disabled = true;
    submitBtn.textContent = '正在提交批量任务...';

    const submitted = [];
    for (const item of rows) {
      try {
        const jobId = await submitOne(item);
        submitted.push(jobId);
      } catch (e) {
        setRowStatus(item.row, 'error', e.message || '失败');
      }
    }
    if (submitted.length) {
      location.href = '/batch?ids=' + encodeURIComponent(submitted.join(','));
      return;
    }
    showFormError('批量任务提交失败，请检查接口地址和 API key。');
    submitBtn.disabled = false;
    submitBtn.textContent = '开始批量检测';
    activeRun = null;
  }

  function renderBatchShell(rows) {
    resultPanel.hidden = false;
    resultPanel.innerHTML = `
      <div class="batch-results-head">
        <div>
          <h2>检测对比</h2>
          <p>已提交 ${rows.length} 家中转站，完成后会自动生成总览和 detector 明细矩阵。</p>
        </div>
        <button type="button" class="btn btn-ghost" id="batch-export-results-btn" disabled>导出结果</button>
      </div>
      <div class="batch-progress" id="batch-progress">正在提交...</div>
      <div id="batch-results-body"></div>
    `;
  }

  function renderBatchProgress(rows) {
    const progress = document.getElementById('batch-progress');
    if (!progress) return;
    const done = rows.filter((item) => item.row.querySelector('.batch-status').dataset.state === 'done').length;
    const failed = rows.filter((item) => item.row.querySelector('.batch-status').dataset.state === 'error').length;
    progress.textContent = `完成 ${done}/${rows.length}，失败 ${failed}`;
  }

  function renderBatchResults(payload) {
    const body = document.getElementById('batch-results-body');
    const exportBtn = document.getElementById('batch-export-results-btn');
    if (!body) return;
    const okResults = payload.results.filter((r) => r.report);
    const bestScore = okResults.reduce((m, r) => Math.max(m, Number(r.report.total_score || 0)), -1);
    const sorted = payload.results.slice().sort((a, b) => scoreOf(b) - scoreOf(a));
    const detectorNames = collectDetectorNames(okResults);

    body.innerHTML = `
      <div class="batch-summary-grid">
        ${sorted.map((result) => renderResultCard(result, scoreOf(result) === bestScore && result.report)).join('')}
      </div>
      <div class="batch-compare-wrap">
        <table class="batch-compare-table">
          <thead>
            <tr>
              <th>检测项</th>
              ${sorted.map((result) => `<th>${escapeHtml(result.name)}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${renderMetricRows(sorted)}
            ${detectorNames.map((name) => `
              <tr>
                <th><code>${escapeHtml(name)}</code></th>
                ${sorted.map((result) => renderDetectorCell(result, name)).join('')}
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
    if (exportBtn) {
      exportBtn.disabled = false;
      exportBtn.onclick = () => downloadJson(`veridrop-${protocol}-batch-results.json`, payload);
    }
    resultPanel.scrollIntoView({behavior: 'smooth', block: 'start'});
  }

  function renderResultCard(result, isBest) {
    if (!result.report) {
      return `
        <article class="batch-result-card batch-result-error">
          <div class="batch-card-top">
            <h3>${escapeHtml(result.name)}</h3>
            <span class="batch-card-badge">失败</span>
          </div>
          <p class="batch-card-url">${escapeHtml(result.base_url)}</p>
          <p class="batch-card-error">${escapeHtml(result.error || '检测失败')}</p>
        </article>
      `;
    }
    const report = result.report;
    const counts = resultCounts(report);
    const perf = performanceOf(report);
    const score = Math.round(Number(report.total_score || 0));
    const verdict = String(report.verdict || '');
    return `
      <article class="batch-result-card ${isBest ? 'batch-result-best' : ''}">
        <div class="batch-card-top">
          <h3>${escapeHtml(result.name)}</h3>
          <span class="batch-card-badge">${isBest ? '最高分' : escapeHtml(verdict || 'done')}</span>
        </div>
        <p class="batch-card-url">${escapeHtml(result.base_url)}</p>
        <div class="batch-score-line">
          <strong>${score}</strong><span>/100</span>
        </div>
        <div class="batch-perf-grid">
          <div class="batch-perf-item">
            <span>首 TOKEN</span>
            <strong>${formatMs(perf.ttft_ms)}</strong>
          </div>
          <div class="batch-perf-item">
            <span>总耗时</span>
            <strong>${formatMs(perf.total_latency_ms)}</strong>
          </div>
          <div class="batch-perf-item">
            <span>吞吐 T/S</span>
            <strong>${formatTps(perf.tokens_per_second)}</strong>
          </div>
          <div class="batch-perf-item">
            <span>输入 TOKENS</span>
            <strong>${formatCount(perf.input_tokens)}</strong>
          </div>
          <div class="batch-perf-item">
            <span>输出 TOKENS</span>
            <strong>${formatCount(perf.output_tokens)}</strong>
          </div>
        </div>
        <p class="batch-card-meta">${counts.pass} 通过 · ${counts.fail} 未通过 · ${counts.error} 异常 · ${counts.skip} 跳过</p>
        <p class="batch-card-summary">${escapeHtml(report.summary || '')}</p>
        <div class="batch-card-links">
          <a href="${result.result_url}" target="_blank" rel="noopener">永久报告</a>
          <a href="${result.json_url}" target="_blank" rel="noopener">JSON</a>
          <a href="${result.image_url}" target="_blank" rel="noopener">JPG</a>
        </div>
      </article>
    `;
  }

  function renderMetricRows(results) {
    const rows = [
      ['首 TOKEN', (perf) => formatMs(perf.ttft_ms)],
      ['总耗时', (perf) => formatMs(perf.total_latency_ms)],
      ['吞吐 (T/S)', (perf) => formatTps(perf.tokens_per_second)],
      ['输入 TOKENS', (perf) => formatCount(perf.input_tokens)],
      ['输出 TOKENS', (perf) => formatCount(perf.output_tokens)],
    ];
    return rows.map(([label, formatter]) => `
      <tr class="batch-metric-row">
        <th>${escapeHtml(label)}</th>
        ${results.map((result) => {
          if (!result.report) return '<td class="batch-detector-muted">-</td>';
          return `<td><strong>${formatter(performanceOf(result.report))}</strong></td>`;
        }).join('')}
      </tr>
    `).join('');
  }

  function renderDetectorCell(result, name) {
    if (!result.report) return '<td class="batch-detector-muted">失败</td>';
    const found = (result.report.results || []).find((r) => r && r.name === name);
    if (!found) return '<td class="batch-detector-muted">-</td>';
    const status = String(found.status || 'skip');
    const score = Math.round(Number(found.score || 0));
    return `<td><span class="batch-detector-pill batch-detector-${escapeAttr(status)}">${escapeHtml(status)} ${score}</span></td>`;
  }

  function collectDetectorNames(results) {
    const seen = new Set();
    results.forEach((result) => {
      (result.report.results || []).forEach((item) => {
        if (item && item.name) seen.add(item.name);
      });
    });
    return Array.from(seen);
  }

  function resultCounts(report) {
    const counts = {pass: 0, fail: 0, error: 0, skip: 0};
    (report.results || []).forEach((item) => {
      const key = item && counts[item.status] !== undefined ? item.status : 'skip';
      counts[key] += 1;
    });
    return counts;
  }

  function scoreOf(result) {
    return result.report ? Number(result.report.total_score || 0) : -1;
  }

  function performanceOf(report) {
    const perf = report.performance || {};
    const usage = perf.usage || {};
    const output = numberOrNull(usage.output_tokens);
    const latency = numberOrNull(perf.total_latency_ms);
    const reportedTps = numberOrNull(perf.tokens_per_second);
    const computedTps = output !== null && output > 0 && latency !== null && latency > 0
      ? output * 1000.0 / latency
      : null;
    return {
      ttft_ms: numberOrNull(perf.ttft_ms),
      total_latency_ms: latency,
      tokens_per_second: reportedTps !== null ? reportedTps : computedTps,
      input_tokens: numberOrNull(usage.input_tokens),
      output_tokens: output,
    };
  }

  function numberOrNull(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function formatCount(value) {
    const n = numberOrNull(value);
    if (n === null) return '—';
    return Math.round(n).toLocaleString('en-US');
  }

  function formatMs(value) {
    const n = numberOrNull(value);
    if (n === null) return '—';
    return Math.round(n).toLocaleString('en-US') + 'ms';
  }

  function formatTps(value) {
    const n = numberOrNull(value);
    if (n === null) return '—';
    return n.toFixed(1);
  }

  function setRowStatus(tr, state, text) {
    const cell = tr.querySelector('.batch-status');
    cell.dataset.state = state;
    cell.textContent = text;
    cell.title = text;
  }

  function showFormError(text) {
    const errBox = document.getElementById('form-error');
    if (!errBox) return;
    errBox.hidden = false;
    errBox.textContent = text;
  }

  function downloadJson(filename, payload) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/`/g, '&#96;');
  }

  document.getElementById('batch-add-btn').addEventListener('click', () => {
    addRow();
    renumberPlaceholders();
  });
  document.getElementById('batch-import-btn').addEventListener('click', () => importFile.click());
  document.getElementById('batch-export-config-btn').addEventListener('click', () => {
    downloadJson(`veridrop-${protocol}-batch-config.json`, collectConfig(true));
  });
  importFile.addEventListener('change', async () => {
    const file = importFile.files && importFile.files[0];
    if (!file) return;
    try {
      applyConfig(JSON.parse(await file.text()));
      showFormError('');
      const errBox = document.getElementById('form-error');
      if (errBox) errBox.hidden = true;
    } catch (e) {
      showFormError(e.message || 'JSON 导入失败');
    } finally {
      importFile.value = '';
    }
  });

  addRow({
    base_url: baseUrlInput.value.trim(),
    api_key: apiKeyInput.value.trim(),
  });
  renumberPlaceholders();

  window.veridropRunBatch = runBatch;
})();

(function () {
  const card = document.querySelector('.batch-page-card[data-batch-ids]');
  if (!card) return;

  const ids = (card.getAttribute('data-batch-ids') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!ids.length) return;

  const spinner = document.getElementById('batch-spinner');
  const headline = document.getElementById('batch-status-headline');
  const detail = document.getElementById('batch-status-detail');
  const errBox = document.getElementById('batch-run-error');
  const resultPanel = document.getElementById('batch-results');
  const body = document.getElementById('batch-results-body');
  const progress = document.getElementById('batch-progress');
  const exportBtn = document.getElementById('batch-export-results-btn');
  const shareBtn = document.getElementById('batch-share-btn');
  let lastPayload = null;
  let tries = 0;

  async function poll() {
    tries++;
    try {
      const r = await fetch('/api/batch/results?ids=' + encodeURIComponent(ids.join(',')), {
        cache: 'no-store',
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const payload = await r.json();
      lastPayload = payload;
      render(payload);

      const pending = payload.items.filter((item) =>
        item.status === 'queued' || item.status === 'running'
      ).length;
      if (pending > 0) {
        setTimeout(poll, 2200);
      } else {
        if (spinner) spinner.hidden = true;
        if (headline) headline.textContent = '批量检测完成';
        if (exportBtn) exportBtn.disabled = false;
      }
    } catch (e) {
      if (tries > 60) {
        if (errBox) {
          errBox.hidden = false;
          errBox.textContent = '批量结果轮询失败: ' + (e.message || e);
        }
        return;
      }
      setTimeout(poll, 2500);
    }
  }

  function render(payload) {
    const items = payload.items || [];
    const done = items.filter((item) => item.status === 'done').length;
    const failed = items.filter((item) => item.status === 'error' || item.status === 'missing').length;
    const pending = items.length - done - failed;
    if (headline) {
      headline.textContent = pending > 0 ? '批量检测中...' : '批量检测完成';
    }
    if (detail) {
      detail.textContent = `完成 ${done}/${items.length}，失败 ${failed}，等待 ${pending}`;
    }
    if (progress) {
      progress.textContent = `完成 ${done}/${items.length}，失败 ${failed}，等待 ${pending}`;
    }

    const sorted = items.slice().sort((a, b) => scoreOfBatchItem(b) - scoreOfBatchItem(a));
    const bestScore = sorted.reduce((max, item) => Math.max(max, scoreOfBatchItem(item)), -1);
    const bestMetrics = bestBatchMetrics(sorted);
    const labels = collectBatchLabels(sorted);

    if (resultPanel) resultPanel.hidden = false;
    if (!body) return;
    body.innerHTML = `
      <section class="batch-section batch-section-metrics">
        <div class="batch-section-head">
          <div>
            <h3>性能指标对比</h3>
            <p>比较每家中转站的响应速度、吞吐能力、总分、Token 用量和报告入口。绿色高亮表示该指标当前最佳。</p>
          </div>
          <span>速度 / 吞吐 / Tokens</span>
        </div>
        ${renderBatchSummaryMatrix(sorted, bestScore, bestMetrics)}
      </section>
      <section class="batch-section batch-section-load">
        <div class="batch-section-head">
          <div>
            <h3>压测结果对比</h3>
            <p>第一阶段最小可用压测：复用本次检测已经发出的请求，按请求数、平均请求耗时、请求吞吐、Token 吞吐和退避次数做横向比较，不额外消耗 API 调用。</p>
          </div>
          <span>请求 / 延迟 / 吞吐</span>
        </div>
        ${renderBatchLoadMatrix(sorted, bestMetrics)}
      </section>
      <section class="batch-section batch-section-checks">
        <div class="batch-section-head">
          <div>
            <h3>检测项结果对比</h3>
            <p>比较身份一致性、协议规范、结构化输出、Token 计费、消息 ID、长上下文等检测项的通过情况和得分。</p>
          </div>
          <span>真伪 / 协议 / 能力</span>
        </div>
        <div class="batch-compare-wrap">
        <table class="batch-compare-table">
          <thead>
            <tr>
              <th>检测项</th>
              ${sorted.map((item) => `<th>${escapeHtml(item.base_url || item.job_id)}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${labels.map((label) => `
              <tr>
                <th>${escapeHtml(label)}</th>
                ${sorted.map((item) => renderBatchCheckCell(item, label)).join('')}
              </tr>
            `).join('')}
          </tbody>
        </table>
        </div>
      </section>
    `;
    wireBatchLogLinks(body, sorted);
  }

  function renderBatchSummaryMatrix(items, bestScore, bestMetrics) {
    return `
      <div class="batch-summary-table-wrap">
        <table class="batch-summary-table batch-summary-matrix">
          <thead>
            <tr>
              <th>指标</th>
              ${items.map((item) => `<th>${escapeHtml((item.report && item.report.base_url) || item.base_url || item.job_id)}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th>模型 / 状态</th>
              ${items.map((item, index) => renderBatchSummaryInfoCell(item, index, scoreOfBatchItem(item) === bestScore && item.report)).join('')}
            </tr>
            ${renderBatchSummaryMetricMatrixRows(items, bestMetrics)}
            <tr>
              <th>检测项统计</th>
              ${items.map((item) => renderBatchSummaryCountsCell(item)).join('')}
            </tr>
            <tr>
              <th>操作</th>
              ${items.map((item, index) => renderBatchSummaryActionsCell(item, index)).join('')}
            </tr>
          </tbody>
        </table>
      </div>
    `;
  }

  function renderBatchSummaryInfoCell(item, index, isBest) {
    const hasReport = item.status === 'done' && item.report;
    const report = item.report || {};
    const counts = batchCounts(item.rows || []);
    const verdict = String(report.verdict || item.status || '');
    const hasIssue = item.status === 'error' || item.status === 'missing' || verdict === 'failed' || counts.error > 0;
    const statusLabel = isBest ? '最高分' : (verdict || '等待中');
    const model = report.target_model || item.target_model || item.error || '';
    return `
      <td class="batch-summary-cell ${hasIssue ? 'batch-result-error' : ''}" data-batch-index="${index}">
        <span class="batch-card-badge">${escapeHtml(statusLabel)}</span>
        <span class="batch-summary-model">${escapeHtml(model || '-')}</span>
      </td>
    `;
  }

  function renderBatchSummaryMetricMatrixRows(items, bestMetrics) {
    const rows = [
      ['总分', 'score', (item) => item.report ? Number(item.report.total_score || 0) : null, (value) => value === null ? '-' : Math.round(value) + '/100'],
      ['首 TOKEN', 'ttft_ms', (item) => item.report ? batchPerformanceOf(item.report).ttft_ms : null, formatMs],
      ['总耗时', 'total_latency_ms', (item) => item.report ? batchPerformanceOf(item.report).total_latency_ms : null, formatMs],
      ['吞吐 (T/S)', 'tokens_per_second', (item) => item.report ? batchPerformanceOf(item.report).tokens_per_second : null, formatTps],
      ['输入 TOKENS', 'input_tokens', (item) => item.report ? batchPerformanceOf(item.report).input_tokens : null, formatCount],
      ['输出 TOKENS', 'output_tokens', (item) => item.report ? batchPerformanceOf(item.report).output_tokens : null, formatCount],
    ];
    return rows.map(([label, key, getter, formatter]) => `
      <tr class="batch-metric-row">
        <th>${escapeHtml(label)}</th>
        ${items.map((item) => renderBatchSummaryMatrixCell(getter(item), bestMetrics[key], formatter)).join('')}
      </tr>
    `).join('');
  }

  function renderBatchSummaryMatrixCell(value, bestValue, formatter) {
    const best = isBestMetric(value, bestValue);
    return `<td class="${best ? 'batch-best-cell' : ''}"><strong>${formatter(value)}</strong></td>`;
  }

  function renderBatchSummaryCountsCell(item) {
    if (!item.report) return `<td class="batch-summary-checks">${escapeHtml(item.error || '-')}</td>`;
    const counts = batchCounts(item.rows || []);
    return `<td class="batch-summary-checks">${counts.pass} 通过 / ${counts.fail} 未过 / ${counts.error} 异常 / ${counts.skip} 跳过</td>`;
  }

  function renderBatchSummaryActionsCell(item, index) {
    const hasReport = item.status === 'done' && item.report;
    return `
      <td class="batch-summary-actions" data-batch-index="${index}">
        ${hasReport ? `<a href="${item.result_url}" target="_blank" rel="noopener">报告</a>` : ''}
        <a href="${item.log_url || ('/logs/' + item.job_id)}" target="_blank" rel="noopener">日志</a>
        ${hasReport ? `<a href="${item.json_url}" target="_blank" rel="noopener">JSON</a>` : ''}
        ${hasReport ? `<a href="${item.image_url}" target="_blank" rel="noopener">JPG</a>` : ''}
      </td>
    `;
  }

  function renderBatchLoadMatrix(items, bestMetrics) {
    const rows = [
      ['压测样本', 'sample', (item) => batchLoadOf(item).sample, (value) => value || '-'],
      ['请求数', 'request_count', (item) => batchLoadOf(item).request_count, formatCount],
      ['平均请求耗时', 'avg_latency_ms_per_request', (item) => batchLoadOf(item).avg_latency_ms_per_request, formatMs],
      ['请求吞吐 (Req/s)', 'request_throughput', (item) => batchLoadOf(item).request_throughput, formatRate],
      ['首 TOKEN', 'load_ttft_ms', (item) => batchLoadOf(item).ttft_ms, formatMs],
      ['输出吞吐 (Tok/s)', 'output_tokens_per_second', (item) => batchLoadOf(item).output_tokens_per_second, formatTps],
      ['总吞吐 (Tok/s)', 'total_tokens_per_second', (item) => batchLoadOf(item).total_tokens_per_second, formatTps],
      ['平均输入 Tokens/请求', 'avg_input_tokens_per_request', (item) => batchLoadOf(item).avg_input_tokens_per_request, formatCount],
      ['平均输出 Tokens/请求', 'avg_output_tokens_per_request', (item) => batchLoadOf(item).avg_output_tokens_per_request, formatCount],
      ['退避次数', 'backoff_events', (item) => batchLoadOf(item).backoff_events, formatCount],
    ];
    return `
      <div class="batch-summary-table-wrap">
        <table class="batch-summary-table batch-summary-matrix batch-load-matrix">
          <thead>
            <tr>
              <th>压测指标</th>
              ${items.map((item) => `<th>${escapeHtml((item.report && item.report.base_url) || item.base_url || item.job_id)}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${rows.map(([label, key, getter, formatter]) => `
              <tr class="batch-load-row">
                <th>${escapeHtml(label)}</th>
                ${items.map((item) => renderBatchLoadCell(getter(item), bestMetrics[key], formatter, key)).join('')}
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderBatchLoadCell(value, bestValue, formatter, key) {
    const best = key !== 'sample' && isBestMetric(value, bestValue);
    return `<td class="${best ? 'batch-best-cell' : ''}"><strong>${formatter(value)}</strong></td>`;
  }

  function renderBatchSummaryTable(items, bestScore, bestMetrics) {
    return `
      <div class="batch-summary-table-wrap">
        <table class="batch-summary-table">
          <thead>
            <tr>
              <th>中转站</th>
              <th>总分</th>
              <th>结论</th>
              <th>首 TOKEN</th>
              <th>总耗时</th>
              <th>吞吐 T/S</th>
              <th>输入 TOKENS</th>
              <th>输出 TOKENS</th>
              <th>检测项</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            ${items.map((item, index) => renderBatchSummaryRow(item, index, scoreOfBatchItem(item) === bestScore && item.report, bestMetrics)).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderBatchSummaryRow(item, index, isBest, bestMetrics) {
    const hasReport = item.status === 'done' && item.report;
    const report = item.report || {};
    const perf = hasReport ? batchPerformanceOf(report) : {};
    const counts = batchCounts(item.rows || []);
    const verdict = String(report.verdict || item.status || '');
    const hasIssue = item.status === 'error' || item.status === 'missing' || verdict === 'failed' || counts.error > 0;
    const score = hasReport ? Math.round(Number(report.total_score || 0)) : null;
    const statusLabel = isBest ? '最高分' : (verdict || '等待中');
    const name = report.base_url || item.base_url || item.job_id;
    const model = report.target_model || item.target_model || item.error || '';
    return `
      <tr class="batch-summary-row ${hasIssue ? 'batch-result-error' : ''}" data-batch-index="${index}">
        <th class="batch-summary-relay">
          <strong>${escapeHtml(name)}</strong>
          <span>${escapeHtml(model)}</span>
        </th>
        <td class="${isBestMetric(score, bestMetrics.score) ? 'batch-best-cell' : ''}">
          ${hasReport ? `<strong class="batch-score-chip ${isBest ? 'batch-best-value' : ''}">${score}/100</strong>` : '-'}
        </td>
        <td><span class="batch-card-badge">${escapeHtml(statusLabel)}</span></td>
        ${renderBatchSummaryMetricCell(perf.ttft_ms, bestMetrics.ttft_ms, formatMs)}
        ${renderBatchSummaryMetricCell(perf.total_latency_ms, bestMetrics.total_latency_ms, formatMs)}
        ${renderBatchSummaryMetricCell(perf.tokens_per_second, bestMetrics.tokens_per_second, formatTps)}
        ${renderBatchSummaryMetricCell(perf.input_tokens, bestMetrics.input_tokens, formatCount)}
        ${renderBatchSummaryMetricCell(perf.output_tokens, bestMetrics.output_tokens, formatCount)}
        <td class="batch-summary-checks">${hasReport ? `${counts.pass} 通过 / ${counts.fail} 未过 / ${counts.error} 异常` : escapeHtml(item.error || '-')}</td>
        <td class="batch-summary-actions">
          ${hasReport ? `<a href="${item.result_url}" target="_blank" rel="noopener">报告</a>` : ''}
          <a href="${item.log_url || ('/logs/' + item.job_id)}" target="_blank" rel="noopener">日志</a>
          ${hasReport ? `<a href="${item.json_url}" target="_blank" rel="noopener">JSON</a>` : ''}
          ${hasReport ? `<a href="${item.image_url}" target="_blank" rel="noopener">JPG</a>` : ''}
        </td>
      </tr>
    `;
  }

  function renderBatchSummaryMetricCell(value, bestValue, formatter) {
    const best = isBestMetric(value, bestValue);
    return `<td class="${best ? 'batch-best-cell' : ''}"><strong>${formatter(value)}</strong></td>`;
  }

  function wireBatchLogLinks(root, items) {
    root.querySelectorAll('.batch-result-card').forEach((card, index) => {
      const item = items[index] || {};
      const counts = batchCounts(item.rows || []);
      const verdict = item.report ? String(item.report.verdict || '') : '';
      const hasIssue = item.status === 'error' || item.status === 'missing' || verdict === 'failed' || counts.error > 0;
      const logLink = Array.from(card.querySelectorAll('a')).find((link) => {
        const href = link.getAttribute('href') || '';
        return href.includes('/logs/') || /log|日志|鏃ュ織/i.test(link.textContent || '');
      });
      if (!logLink) return;
      logLink.removeAttribute('target');
      logLink.removeAttribute('rel');
      logLink.setAttribute('href', item.log_text_url || ('/api/logs/' + item.job_id + '.txt'));
      logLink.dataset.logUrl = item.log_text_url || ('/api/logs/' + item.job_id + '.txt');
      logLink.dataset.logTitle = '检测日志 #' + (item.job_id || '');
      logLink.classList.add('batch-link-button');
      logLink.classList.toggle('log-btn-hot', hasIssue);
      card.classList.toggle('batch-result-error', hasIssue);
    });
    root.querySelectorAll('.batch-summary-row').forEach((row) => {
      const index = Number(row.dataset.batchIndex || 0);
      const item = items[index] || {};
      const counts = batchCounts(item.rows || []);
      const verdict = item.report ? String(item.report.verdict || '') : '';
      const hasIssue = item.status === 'error' || item.status === 'missing' || verdict === 'failed' || counts.error > 0;
      const logLink = Array.from(row.querySelectorAll('a')).find((link) => {
        const href = link.getAttribute('href') || '';
        return href.includes('/logs/');
      });
      if (!logLink) return;
      logLink.removeAttribute('target');
      logLink.removeAttribute('rel');
      logLink.setAttribute('href', item.log_text_url || ('/api/logs/' + item.job_id + '.txt'));
      logLink.dataset.logUrl = item.log_text_url || ('/api/logs/' + item.job_id + '.txt');
      logLink.dataset.logTitle = '检测日志 #' + (item.job_id || '');
      logLink.classList.add('batch-link-button');
      logLink.classList.toggle('log-btn-hot', hasIssue);
      row.classList.toggle('batch-result-error', hasIssue);
    });
  }

  function renderBatchCard(item, isBest) {
    if (item.status !== 'done' || !item.report) {
      const statusLabel = {
        queued: '排队中',
        running: '检测中',
        error: '失败',
        missing: '不存在',
      }[item.status] || item.status || '等待中';
      return `
        <article class="batch-result-card ${item.status === 'error' || item.status === 'missing' ? 'batch-result-error' : ''}">
          <div class="batch-card-top">
            <h3>${escapeHtml(item.base_url || item.job_id)}</h3>
            <span class="batch-card-badge">${escapeHtml(statusLabel)}</span>
          </div>
          <p class="batch-card-url">${escapeHtml(item.target_model || '')}</p>
          ${item.error ? `<p class="batch-card-error">${escapeHtml(item.error)}</p>` : ''}
          <div class="batch-card-links">
            <a href="${item.log_url || ('/logs/' + item.job_id)}" target="_blank" rel="noopener">查看日志</a>
          </div>
        </article>
      `;
    }

    const report = item.report;
    const perf = batchPerformanceOf(report);
    const counts = batchCounts(item.rows || []);
    const score = Math.round(Number(report.total_score || 0));
    const verdict = String(report.verdict || '');
    return `
      <article class="batch-result-card ${isBest ? 'batch-result-best' : ''}">
        <div class="batch-card-top">
          <h3>${escapeHtml(report.base_url || item.base_url || item.job_id)}</h3>
          <span class="batch-card-badge">${isBest ? '最高分' : escapeHtml(verdict || 'done')}</span>
        </div>
        <p class="batch-card-url">${escapeHtml(report.target_model || item.target_model || '')}</p>
        <div class="batch-score-line">
          <strong>${score}</strong><span>/100</span>
        </div>
        <div class="batch-perf-grid">
          <div class="batch-perf-item"><span>首 TOKEN</span><strong>${formatMs(perf.ttft_ms)}</strong></div>
          <div class="batch-perf-item"><span>总耗时</span><strong>${formatMs(perf.total_latency_ms)}</strong></div>
          <div class="batch-perf-item"><span>吞吐 T/S</span><strong>${formatTps(perf.tokens_per_second)}</strong></div>
          <div class="batch-perf-item"><span>输入 TOKENS</span><strong>${formatCount(perf.input_tokens)}</strong></div>
          <div class="batch-perf-item"><span>输出 TOKENS</span><strong>${formatCount(perf.output_tokens)}</strong></div>
        </div>
        <p class="batch-card-meta">${counts.pass} 通过 · ${counts.fail} 未通过 · ${counts.error} 异常 · ${counts.skip} 跳过</p>
        <p class="batch-card-summary">${escapeHtml(report.summary || '')}</p>
        <div class="batch-card-links">
          <a href="${item.result_url}" target="_blank" rel="noopener">永久报告</a>
          <a href="${item.log_url || ('/logs/' + item.job_id)}" target="_blank" rel="noopener">日志</a>
          <a href="${item.json_url}" target="_blank" rel="noopener">JSON</a>
          <a href="${item.image_url}" target="_blank" rel="noopener">JPG</a>
        </div>
      </article>
    `;
  }

  function renderBatchMetricRows(items, bestMetrics) {
    const rows = [
      ['首 TOKEN', (perf) => formatMs(perf.ttft_ms)],
      ['总耗时', (perf) => formatMs(perf.total_latency_ms)],
      ['吞吐 (T/S)', (perf) => formatTps(perf.tokens_per_second)],
      ['输入 TOKENS', (perf) => formatCount(perf.input_tokens)],
      ['输出 TOKENS', (perf) => formatCount(perf.output_tokens)],
    ];
    const keys = ['ttft_ms', 'total_latency_ms', 'tokens_per_second', 'input_tokens', 'output_tokens'];
    return rows.map(([label, formatter], rowIndex) => `
      <tr class="batch-metric-row">
        <th>${escapeHtml(label)}</th>
        ${items.map((item) => {
          if (!item.report) return '<td class="batch-detector-muted">-</td>';
          const perf = batchPerformanceOf(item.report);
          const key = keys[rowIndex];
          const isBest = isBestMetric(perf[key], bestMetrics && bestMetrics[key]);
          return `<td class="${isBest ? 'batch-best-cell' : ''}"><strong>${formatter(perf)}</strong></td>`;
        }).join('')}
      </tr>
    `).join('');
  }

  function renderBatchCheckCell(item, label) {
    if (!item.report || !Array.isArray(item.rows)) {
      return '<td class="batch-detector-muted">-</td>';
    }
    const found = item.rows.find((row) => row && row.label === label);
    if (!found) return '<td class="batch-detector-muted">-</td>';
    const css = String(found.css || 'muted');
    const text = `${found.label_short || found.status || ''} ${Math.round(Number(found.score || 0))}`;
    return `<td><span class="batch-detector-pill batch-detector-${escapeAttr(css)}">${escapeHtml(text)}</span></td>`;
  }

  function collectBatchLabels(items) {
    const seen = new Set();
    items.forEach((item) => {
      (item.rows || []).forEach((row) => {
        if (row && row.label) seen.add(row.label);
      });
    });
    return Array.from(seen);
  }

  function batchCounts(rows) {
    const counts = {pass: 0, fail: 0, error: 0, skip: 0};
    rows.forEach((row) => {
      const status = row.status === 'pass' ? 'pass'
        : row.status === 'error' ? 'error'
        : row.status === 'skip' ? 'skip'
        : 'fail';
      counts[status] += 1;
    });
    return counts;
  }

  function scoreOfBatchItem(item) {
    return item && item.report ? Number(item.report.total_score || 0) : -1;
  }

  function bestBatchMetrics(items) {
    return {
      score: bestBatchValue(items, (item) => item.report ? Number(item.report.total_score || 0) : null, 'max'),
      ttft_ms: bestBatchValue(items, (item) => item.report ? batchPerformanceOf(item.report).ttft_ms : null, 'min'),
      total_latency_ms: bestBatchValue(items, (item) => item.report ? batchPerformanceOf(item.report).total_latency_ms : null, 'min'),
      tokens_per_second: bestBatchValue(items, (item) => item.report ? batchPerformanceOf(item.report).tokens_per_second : null, 'max'),
      input_tokens: bestBatchValue(items, (item) => item.report ? batchPerformanceOf(item.report).input_tokens : null, 'max'),
      output_tokens: bestBatchValue(items, (item) => item.report ? batchPerformanceOf(item.report).output_tokens : null, 'max'),
      request_count: bestBatchValue(items, (item) => batchLoadOf(item).request_count, 'max'),
      avg_latency_ms_per_request: bestBatchValue(items, (item) => batchLoadOf(item).avg_latency_ms_per_request, 'min'),
      request_throughput: bestBatchValue(items, (item) => batchLoadOf(item).request_throughput, 'max'),
      load_ttft_ms: bestBatchValue(items, (item) => batchLoadOf(item).ttft_ms, 'min'),
      output_tokens_per_second: bestBatchValue(items, (item) => batchLoadOf(item).output_tokens_per_second, 'max'),
      total_tokens_per_second: bestBatchValue(items, (item) => batchLoadOf(item).total_tokens_per_second, 'max'),
      avg_input_tokens_per_request: bestBatchValue(items, (item) => batchLoadOf(item).avg_input_tokens_per_request, 'max'),
      avg_output_tokens_per_request: bestBatchValue(items, (item) => batchLoadOf(item).avg_output_tokens_per_request, 'max'),
      backoff_events: bestBatchValue(items, (item) => batchLoadOf(item).backoff_events, 'min'),
    };
  }

  function bestBatchValue(items, getter, direction) {
    const values = items.map(getter).map(numberOrNull).filter((value) => value !== null);
    if (!values.length) return null;
    return direction === 'min' ? Math.min(...values) : Math.max(...values);
  }

  function isBestMetric(value, bestValue) {
    const n = numberOrNull(value);
    const best = numberOrNull(bestValue);
    return n !== null && best !== null && Math.abs(n - best) < 0.000001;
  }

  function batchPerformanceOf(report) {
    const perf = report.performance || {};
    const usage = perf.usage || {};
    const output = numberOrNull(usage.output_tokens);
    const latency = numberOrNull(perf.total_latency_ms);
    const reportedTps = numberOrNull(perf.tokens_per_second);
    const computedTps = output !== null && output > 0 && latency !== null && latency > 0
      ? output * 1000.0 / latency
      : null;
    return {
      ttft_ms: numberOrNull(perf.ttft_ms),
      total_latency_ms: latency,
      tokens_per_second: reportedTps !== null ? reportedTps : computedTps,
      input_tokens: numberOrNull(usage.input_tokens),
      output_tokens: output,
    };
  }

  function batchLoadOf(item) {
    if (!item || !item.report) return {};
    const summary = item.perf_benchmark && typeof item.perf_benchmark === 'object'
      ? item.perf_benchmark
      : {};
    const perf = batchPerformanceOf(item.report);
    const rawPerf = item.report.performance || {};
    const requestCount = numberOrNull(summary.request_count) !== null
      ? numberOrNull(summary.request_count)
      : numberOrNull(rawPerf.request_count);
    const latency = numberOrNull(summary.total_latency_ms) !== null
      ? numberOrNull(summary.total_latency_ms)
      : perf.total_latency_ms;
    const totalTokens = (perf.input_tokens || 0) + (perf.output_tokens || 0);
    const seconds = latency !== null && latency > 0 ? latency / 1000.0 : null;
    return {
      sample: summary.sample === 'detector_run' ? '检测请求' : (summary.sample || '检测请求'),
      request_count: requestCount,
      avg_latency_ms_per_request: numberOrNull(summary.avg_latency_ms_per_request) !== null
        ? numberOrNull(summary.avg_latency_ms_per_request)
        : (requestCount && latency ? latency / requestCount : null),
      request_throughput: numberOrNull(summary.request_throughput) !== null
        ? numberOrNull(summary.request_throughput)
        : (requestCount && seconds ? requestCount / seconds : null),
      ttft_ms: numberOrNull(summary.ttft_ms) !== null ? numberOrNull(summary.ttft_ms) : perf.ttft_ms,
      output_tokens_per_second: numberOrNull(summary.output_tokens_per_second) !== null
        ? numberOrNull(summary.output_tokens_per_second)
        : perf.tokens_per_second,
      total_tokens_per_second: numberOrNull(summary.total_tokens_per_second) !== null
        ? numberOrNull(summary.total_tokens_per_second)
        : (totalTokens > 0 && seconds ? totalTokens / seconds : null),
      avg_input_tokens_per_request: numberOrNull(summary.avg_input_tokens_per_request) !== null
        ? numberOrNull(summary.avg_input_tokens_per_request)
        : (requestCount && perf.input_tokens !== null ? perf.input_tokens / requestCount : null),
      avg_output_tokens_per_request: numberOrNull(summary.avg_output_tokens_per_request) !== null
        ? numberOrNull(summary.avg_output_tokens_per_request)
        : (requestCount && perf.output_tokens !== null ? perf.output_tokens / requestCount : null),
      backoff_events: numberOrNull(summary.backoff_events) !== null
        ? numberOrNull(summary.backoff_events)
        : numberOrNull(rawPerf.backoff_events),
    };
  }

  function numberOrNull(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function formatCount(value) {
    const n = numberOrNull(value);
    if (n === null) return '—';
    return Math.round(n).toLocaleString('en-US');
  }

  function formatMs(value) {
    const n = numberOrNull(value);
    if (n === null) return '—';
    return Math.round(n).toLocaleString('en-US') + 'ms';
  }

  function formatTps(value) {
    const n = numberOrNull(value);
    if (n === null) return '—';
    return n.toFixed(1);
  }

  function formatRate(value) {
    const n = numberOrNull(value);
    if (n === null) return '—';
    return n.toFixed(2);
  }

  function downloadJson(filename, payload) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/`/g, '&#96;');
  }

  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      if (lastPayload) downloadJson('veridrop-batch-results.json', lastPayload);
    });
  }
  if (shareBtn) {
    shareBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(location.href);
        const orig = shareBtn.textContent;
        shareBtn.textContent = '已复制';
        setTimeout(() => { shareBtn.textContent = orig; }, 1500);
      } catch (_) {
        shareBtn.textContent = '复制失败';
      }
    });
  }
  poll();
})();

(function () {
  let backdrop = null;
  let titleEl = null;
  let bodyEl = null;
  let rawLink = null;

  document.querySelectorAll('a[href^="/logs/"]').forEach((link) => {
    const href = link.getAttribute('href') || '';
    const jobId = href.split('/').filter(Boolean).pop() || '';
    link.dataset.logUrl = '/api/logs/' + jobId + '.txt';
    link.dataset.logTitle = '检测日志 #' + jobId;
    link.removeAttribute('target');
    link.removeAttribute('rel');
    if (document.querySelector('.score-fail, .form-error:not([hidden])')) {
      link.classList.add('log-btn-hot');
    }
  });

  function ensureModal() {
    if (backdrop) return;
    backdrop = document.createElement('div');
    backdrop.className = 'log-modal-backdrop';
    backdrop.hidden = true;
    backdrop.innerHTML = `
      <section class="log-modal" role="dialog" aria-modal="true" aria-labelledby="log-modal-title">
        <div class="log-modal-head">
          <h2 id="log-modal-title">检测日志</h2>
          <div class="log-modal-actions">
            <a class="btn btn-ghost log-modal-raw" href="#" target="_blank" rel="noopener">原始日志</a>
            <button class="btn btn-ghost log-modal-close" type="button" aria-label="关闭">关闭</button>
          </div>
        </div>
        <pre class="log-modal-body"></pre>
      </section>
    `;
    document.body.appendChild(backdrop);
    titleEl = backdrop.querySelector('#log-modal-title');
    bodyEl = backdrop.querySelector('.log-modal-body');
    rawLink = backdrop.querySelector('.log-modal-raw');
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop || event.target.closest('.log-modal-close')) closeModal();
    });
  }

  function openModal(title, url) {
    ensureModal();
    titleEl.textContent = title || '检测日志';
    bodyEl.textContent = '正在加载日志...';
    rawLink.href = url;
    backdrop.hidden = false;
    document.body.classList.add('log-modal-open');
  }

  function closeModal() {
    if (!backdrop) return;
    backdrop.hidden = true;
    document.body.classList.remove('log-modal-open');
  }

  document.addEventListener('click', async (event) => {
    const trigger = event.target.closest('[data-log-url]');
    if (!trigger) return;
    event.preventDefault();
    const url = trigger.dataset.logUrl;
    if (!url) return;
    openModal(trigger.dataset.logTitle || trigger.textContent || '检测日志', url);
    try {
      const response = await fetch(url, {cache: 'no-store'});
      const text = await response.text();
      if (!response.ok) throw new Error(text || ('HTTP ' + response.status));
      bodyEl.textContent = text || '暂无日志';
    } catch (error) {
      bodyEl.textContent = '日志加载失败: ' + (error && error.message ? error.message : String(error));
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeModal();
  });
})();

(function () {
  const protocol =
    location.pathname.startsWith('/claude') ? 'anthropic' :
    location.pathname.startsWith('/openai') ? 'openai' :
    location.pathname.startsWith('/gemini') ? 'gemini' :
    location.pathname.startsWith('/deepseek') ? 'deepseek' : null;
  if (!protocol) return;

  const form = document.getElementById('detect-form');
  if (form && form.dataset.batch === 'true') return;

  const protoLabel = {anthropic: 'Claude', openai: 'OpenAI', gemini: 'Gemini', deepseek: 'DeepSeek'}[protocol];
  const protoPath = {anthropic: '/claude', openai: '/openai', gemini: '/gemini', deepseek: '/deepseek'};

  const baseUrlInput = document.getElementById('base_url');
  const apiKeyInput = document.getElementById('api_key');
  const modelInput = document.getElementById('model');
  if (!baseUrlInput || !apiKeyInput) return;

  // Inject pill container right after the api_key field's hint.
  const apiKeyField = apiKeyInput.closest('.field');
  const pill = document.createElement('div');
  pill.id = 'probe-pill';
  pill.className = 'probe-pill';
  pill.hidden = true;
  apiKeyField.appendChild(pill);

  let inflight = null;
  let lastKey = null;

  async function runProbe() {
    const baseUrl = baseUrlInput.value.trim();
    const apiKey = apiKeyInput.value.trim();
    if (!baseUrl || !apiKey || apiKey.length < 8) return;
    if (!/^https?:\/\//.test(baseUrl)) return;

    const key = baseUrl + '|' + apiKey.length + ':' + apiKey.slice(-4);
    if (key === lastKey) return; // already probed this combo
    lastKey = key;

    setPill('neutral', '🔄 正在识别中转站可用模型...');
    if (inflight) inflight.abort && inflight.abort();
    const ctrl = new AbortController();
    inflight = ctrl;

    const fd = new FormData();
    fd.set('base_url', baseUrl);
    fd.set('api_key', apiKey);
    let r, data;
    try {
      r = await fetch('/api/probe', {method: 'POST', body: fd, signal: ctrl.signal});
      data = await r.json();
    } catch (e) {
      if (e.name === 'AbortError') return;
      setPill('warn', '⚪ 探测失败,但不影响检测继续 — 你填的模型会被直接尝试');
      return;
    }
    if (r.status === 429) {
      // Rate limited — surface clearly and keep submit enabled so the user
      // can still proceed (they're not blocked from detection itself).
      setPill('warn', '⚠ ' + (data.error || '探测过于频繁,稍后再试') + '(检测仍可正常提交)');
      lastKey = null; // allow retry after backoff
      return;
    }
    renderProbeResult(data);
  }

  function renderProbeResult(data) {
    if (!data.ok) {
      // Auth fail vs other errors — auth_ok=false is the only blocking case
      if (data.auth_ok === false) {
        setPill('fail', '🔴 ' + (data.error || '鉴权失败'));
      } else {
        setPill('warn', '⚪ ' + (data.error || '探测失败') + ' — 不影响检测继续');
      }
      return;
    }

    if (!data.models_endpoint_supported) {
      setPill('neutral', '⚪ ' + (data.note || '该中转站不暴露 /v1/models') + '(检测可正常进行)');
      return;
    }

    const myModels = (data.by_protocol && data.by_protocol[protocol]) || [];
    const total = data.raw_count || 0;

    if (myModels.length === 0) {
      // The headline case: cross-protocol suggestion.
      const others = Object.keys(data.by_protocol || {})
        .filter((p) => p !== protocol && data.by_protocol[p].length > 0)
        .map((p) => ({proto: p, count: data.by_protocol[p].length, sample: data.by_protocol[p][0]}));

      let html =
        '<div class="probe-headline">🟡 该中转站没有任何 ' + escapeHtml(protoLabel) + ' 模型</div>' +
        '<div class="probe-detail">已识别 ' + total + ' 个模型,但都不属于本检测协议。</div>';
      if (others.length) {
        html += '<div class="probe-actions">';
        others.forEach((o) => {
          const label = {anthropic: 'Claude', openai: 'OpenAI', gemini: 'Gemini', deepseek: 'DeepSeek'}[o.proto];
          html +=
            '<button type="button" class="btn btn-ghost probe-action" data-handoff="' + o.proto + '">' +
            '改用 ' + label + ' 协议 (' + o.count + ' 个可用)</button>';
        });
        html += '</div>';
      }
      setPillHtml('warn', html);
      bindHandoff();
      // Disable submit — running detection here will produce 0% report.
      setSubmitEnabled(false, '该中转站没有 ' + protoLabel + ' 模型');
      return;
    }

    // Happy path: at least one model matches our protocol.
    const sample = myModels.slice(0, 4).join(', ');
    const more = myModels.length > 4 ? ` 等共 ${myModels.length} 个` : '';
    setPillHtml(
      'ok',
      '<div class="probe-headline">🟢 已识别 ' + total + ' 个模型,其中 ' + myModels.length + ' 个可用于本检测</div>' +
      '<div class="probe-detail">' + escapeHtml(sample) + escapeHtml(more) + '</div>'
    );

    // Replace the dropdown with what the relay actually carries.
    if (window.veridropSetModelChoices) {
      window.veridropSetModelChoices(myModels);
    }
    setSubmitEnabled(true);

    // Stash best_by_protocol globally — the submit handler reads it when
    // preflight 422s so it can offer a one-click swap to the recommended
    // model.
    window.veridropBestByProtocol = data.best_by_protocol || {};

    // If the user-typed model isn't in the list, auto-correct to the
    // protocol-preferred default rather than whatever sorts first
    // alphabetically. The backend computes "best" via each protocol's
    // pick_default_model — for OpenAI that's gpt-4o-mini, for Gemini it's
    // gemini-2.5-flash, etc. — so a /gemini → /openai handoff lands on a
    // sensible model instead of e.g. gpt-3.5-turbo or some preview SKU.
    const best = (data.best_by_protocol && data.best_by_protocol[protocol]) || myModels[0];
    if (modelInput && modelInput.value.trim() && !myModels.includes(modelInput.value.trim())) {
      modelInput.value = best;
    }
  }

  function setPill(level, text) {
    pill.className = 'probe-pill probe-' + level;
    pill.textContent = text;
    pill.hidden = false;
  }
  function setPillHtml(level, html) {
    pill.className = 'probe-pill probe-' + level;
    pill.innerHTML = html;
    pill.hidden = false;
  }

  function setSubmitEnabled(ok, reason) {
    const btn = document.getElementById('submit-btn');
    if (!btn) return;
    btn.disabled = !ok;
    btn.title = ok ? '' : (reason || '');
  }

  function bindHandoff() {
    pill.querySelectorAll('[data-handoff]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.getAttribute('data-handoff');
        try {
          sessionStorage.setItem('veridrop:handoff', JSON.stringify({
            base_url: baseUrlInput.value.trim(),
            api_key: apiKeyInput.value.trim(),
            from: protocol,
          }));
        } catch (_) { /* sessionStorage unavailable — page navigates anyway */ }
        location.href = protoPath[target];
      });
    });
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Trigger probe on api_key blur. Also re-probe when base_url changes
  // (after blur) so users editing both fields don't miss a re-check.
  apiKeyInput.addEventListener('blur', runProbe);
  baseUrlInput.addEventListener('blur', () => {
    lastKey = null; // base changed → invalidate dedup
    runProbe();
  });

  // Cross-protocol handoff: if we landed here from another protocol page,
  // pre-fill the form and immediately probe. Single-shot — clear after read
  // so a refresh doesn't reuse the key.
  try {
    const raw = sessionStorage.getItem('veridrop:handoff');
    if (raw) {
      sessionStorage.removeItem('veridrop:handoff');
      const data = JSON.parse(raw);
      if (data && data.base_url && data.api_key) {
        baseUrlInput.value = data.base_url;
        apiKeyInput.value = data.api_key;
        const fromLabel = {anthropic: 'Claude', openai: 'OpenAI', gemini: 'Gemini', deepseek: 'DeepSeek'}[data.from] || data.from;
        setPill('neutral', '🔄 已从 ' + fromLabel + ' 页面带入凭据,正在重新探测...');
        // Defer so the page paints first
        setTimeout(runProbe, 50);
      }
    }
  } catch (_) { /* malformed handoff — ignore */ }
})();


(function () {
  const form = document.getElementById('detect-form');
  if (!form) return;
  const submitBtn = document.getElementById('submit-btn');
  const errBox = document.getElementById('form-error');

  function endpointFor() {
    return form.getAttribute('data-endpoint')
      || (location.pathname.startsWith('/claude')
        ? '/api/detect/claude'
        : location.pathname.startsWith('/openai')
        ? '/api/detect/openai'
        : location.pathname.startsWith('/gemini')
        ? '/api/detect/gemini'
        : location.pathname.startsWith('/deepseek')
        ? '/api/detect/deepseek'
        : '/api/detect');
  }

  function currentProtocol() {
    return location.pathname.startsWith('/claude') ? 'anthropic' :
           location.pathname.startsWith('/openai') ? 'openai' :
           location.pathname.startsWith('/gemini') ? 'gemini' :
           location.pathname.startsWith('/deepseek') ? 'deepseek' : null;
  }

  function renderModelDeadError(detail) {
    // Backend returns: {code, message, model, protocol, upstream_error}
    const proto = currentProtocol();
    const recommended = (window.veridropBestByProtocol || {})[proto];
    const dead = detail.model || '该模型';
    const reason = detail.upstream_error || '上游拒绝';

    errBox.innerHTML = '';
    errBox.hidden = false;
    errBox.classList.add('form-error-rich');

    const title = document.createElement('div');
    title.className = 'form-error-title';
    title.textContent = '该模型在中转站实际不可用';
    errBox.appendChild(title);

    const body = document.createElement('div');
    body.className = 'form-error-body';
    body.textContent = `${dead}: ${reason}`;
    errBox.appendChild(body);

    const actions = document.createElement('div');
    actions.className = 'form-error-actions';

    if (recommended && recommended !== dead) {
      const swapBtn = document.createElement('button');
      swapBtn.type = 'button';
      swapBtn.className = 'btn btn-primary';
      swapBtn.textContent = `换成 ${recommended} 重试`;
      swapBtn.addEventListener('click', () => {
        const modelInput = document.getElementById('model');
        if (modelInput) modelInput.value = recommended;
        errBox.hidden = true;
        errBox.classList.remove('form-error-rich');
        // Clear force flag if it was set by previous click.
        const force = form.querySelector('input[name="force"]');
        if (force) force.value = '';
        form.requestSubmit();
      });
      actions.appendChild(swapBtn);
    }

    const forceBtn = document.createElement('button');
    forceBtn.type = 'button';
    forceBtn.className = 'btn btn-ghost';
    forceBtn.textContent = '我知道,强制提交';
    forceBtn.title = 'preflight 偶尔会误判(例如 max_tokens 太小被代理拒)。强制提交后,如果模型真挂了,检测会以错误结果呈现。';
    forceBtn.addEventListener('click', () => {
      // Append a hidden force=1 field; the detect routes skip preflight when
      // it's set.
      let force = form.querySelector('input[name="force"]');
      if (!force) {
        force = document.createElement('input');
        force.type = 'hidden';
        force.name = 'force';
        form.appendChild(force);
      }
      force.value = '1';
      errBox.hidden = true;
      errBox.classList.remove('form-error-rich');
      form.requestSubmit();
    });
    actions.appendChild(forceBtn);

    errBox.appendChild(actions);
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (form.dataset.batch === 'true' && window.veridropRunBatch) {
      await window.veridropRunBatch();
      return;
    }
    errBox.hidden = true;
    errBox.classList.remove('form-error-rich');
    submitBtn.disabled = true;
    submitBtn.textContent = '正在确认模型可用…';

    const fd = new FormData(form);
    try {
      const r = await fetch(endpointFor(), {method: 'POST', body: fd});
      if (r.status === 422) {
        const j = await r.json().catch(() => ({}));
        const detail = j && j.detail;
        if (detail && detail.code === 'model_not_alive') {
          renderModelDeadError(detail);
          submitBtn.disabled = false;
          submitBtn.textContent = '开始检测';
          return;
        }
      }
      if (!r.ok) {
        const j = await r.json().catch(() => ({detail: 'request failed'}));
        const msg = typeof j.detail === 'string' ? j.detail
          : (j.detail && j.detail.message) || ('HTTP ' + r.status);
        throw new Error(msg);
      }
      const j = await r.json();
      form.api_key.value = '';
      // Clear force flag so a subsequent submission goes through preflight.
      const force = form.querySelector('input[name="force"]');
      if (force) force.value = '';
      location.href = '/r/' + j.job_id;
    } catch (e) {
      errBox.hidden = false;
      errBox.textContent = e.message || 'Submission failed';
      submitBtn.disabled = false;
      submitBtn.textContent = '开始检测';
    }
  });
})();

// FAQ dual-mode toggle (通俗 / 开发者).
// Two <p data-mode="layperson|developer"> per question are both in DOM
// (so search engines index both); CSS hides whichever doesn't match the
// section's data-mode. Choice persists in localStorage so the user
// doesn't have to re-toggle every visit.
(() => {
  const STORAGE_KEY = 'veridrop_faq_mode';
  const sections = document.querySelectorAll('.faq[data-mode]');
  if (!sections.length) return;

  // Restore saved preference (if any) before any clicks.
  const saved = (() => {
    try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
  })();
  if (saved === 'layperson' || saved === 'developer') {
    sections.forEach((sec) => {
      sec.dataset.mode = saved;
      sec.querySelectorAll('.faq-mode-btn').forEach((b) => {
        const active = b.dataset.mode === saved;
        b.classList.toggle('faq-mode-active', active);
        b.setAttribute('aria-selected', active ? 'true' : 'false');
      });
    });
  }

  // Click handler: switch mode + persist.
  sections.forEach((sec) => {
    sec.querySelectorAll('.faq-mode-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        if (!mode) return;
        sec.dataset.mode = mode;
        sec.querySelectorAll('.faq-mode-btn').forEach((b) => {
          const active = b === btn;
          b.classList.toggle('faq-mode-active', active);
          b.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        try { localStorage.setItem(STORAGE_KEY, mode); } catch { /* ignore */ }
      });
    });
  });
})();
