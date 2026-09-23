'use strict';

/* ============================================================
   计量器具检定与校准管理台 —— 前端逻辑
   纯原生 JS：无构建、无框架、无 CDN、无外部字体与图标。
   显示纪律：结论、允差、误差、代表误差、剩余天数、标记与各项
   指标数字一律直接显示接口返回的字段值，前端不自行判定、不自行拼算。
   ============================================================ */

/* ---------------- 基础工具 ---------------- */

function $(sel, root) { return (root || document).querySelector(sel); }
function $$(sel, root) {
  return Array.prototype.slice.call((root || document).querySelectorAll(sel));
}

function el(tag, cls, text) {
  var node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function show(value) {
  if (value === undefined || value === null || value === '') return '—';
  return String(value);
}

function count(value) {
  return value === undefined || value === null ? 0 : value;
}

function opt(value, label) { return { value: value, label: label }; }

function td(value, cls) { return el('td', cls || null, show(value)); }

function isNode(v) { return v && typeof v === 'object' && v.nodeType === 1; }

function buildSubTable(headers, rows) {
  var table = el('table', 'sub');
  var thead = el('thead');
  var hr = el('tr');
  headers.forEach(function (h) { hr.appendChild(el('th', null, h)); });
  thead.appendChild(hr);
  table.appendChild(thead);
  var tbody = el('tbody');
  if (!rows || !rows.length) {
    var emptyTr = el('tr');
    var emptyTd = el('td', 'muted', '暂无');
    emptyTd.colSpan = headers.length;
    emptyTr.appendChild(emptyTd);
    tbody.appendChild(emptyTr);
  } else {
    rows.forEach(function (cells) {
      var tr = el('tr');
      cells.forEach(function (v) {
        var c = el('td');
        if (isNode(v)) c.appendChild(v);
        else c.textContent = show(v);
        tr.appendChild(c);
      });
      tbody.appendChild(tr);
    });
  }
  table.appendChild(tbody);
  return table;
}

/* ---------------- 标记样式映射（只决定配色，不决定取值） ---------------- */

var STATUS_CLASS = { '在用': 'badge-ok', '停用': 'badge-muted', '送检中': 'badge-info', '报废': 'badge-bad' };
var BAND_CLASS = {
  '正常': 'badge-ok', '宽限内': 'badge-warn', '已超期': 'badge-bad',
  '已停用': 'badge-muted', '送检中': 'badge-info', '已报废': 'badge-bad'
};
var VERDICT_CLASS = { '合格': 'badge-ok', '不合格': 'badge-bad' };

function makeBadge(value, map) {
  var cls = (map && map[value]) || 'badge-muted';
  return el('span', 'badge ' + cls, show(value));
}

function badgeTd(value, map) {
  var c = el('td');
  c.appendChild(makeBadge(value, map));
  return c;
}

function statusBadge(v) { return makeBadge(v, STATUS_CLASS); }
function bandBadge(v) { return makeBadge(v, BAND_CLASS); }
function verdictBadge(v) { return makeBadge(v, VERDICT_CLASS); }

/* ---------------- 应用状态 ---------------- */

var state = {
  tab: 'overview',
  summary: null,
  settings: null,
  departments: [],
  instrumentOptions: null,
  instruments: [],
  records: [],
  standards: [],
  due: { total: 0, rows: [] },
  dueBand: '',
  filters: {
    inst: { keyword: '', status: '', category: '', deptId: '' },
    rec: { instrumentId: '', kind: '', verdict: '', from: '', to: '' }
  },
  expanded: { inst: null, rec: null, std: null },
  instDetail: {},
  pendingDelete: {},
  editId: { instrument: null, standard: null }
};

/* ---------------- 接口访问 ---------------- */

function api(method, path, body) {
  var options = { method: method, headers: {} };
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  return fetch(path, options).then(function (res) {
    return res.text().then(function (raw) {
      var payload = null;
      if (raw) {
        try { payload = JSON.parse(raw); } catch (parseErr) { payload = null; }
      }
      if (!res.ok) {
        var e = (payload && payload.error) ? payload.error : {};
        throw {
          code: e.code || ('HTTP_' + res.status),
          message: e.message || ('请求失败（HTTP ' + res.status + '）'),
          details: e.details || null
        };
      }
      return payload;
    });
  }, function () {
    throw {
      code: 'NETWORK_ERROR',
      message: '请求发不出去，请确认服务在运行：' + method + ' ' + path,
      details: null
    };
  });
}

function buildQuery(pairs) {
  var parts = [];
  Object.keys(pairs).forEach(function (key) {
    var v = pairs[key];
    if (v !== undefined && v !== null && String(v) !== '') {
      parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(v));
    }
  });
  return parts.length ? '?' + parts.join('&') : '';
}

/* ---------------- 提示与错误 ---------------- */

var toastTimer = null;

function toast(message, kind) {
  var box = $('#toast');
  box.textContent = message;
  box.className = 'toast' + (kind === 'bad' ? ' is-bad' : kind === 'muted' ? ' is-muted' : '');
  box.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { box.hidden = true; }, 7000);
}

function modalScope(name) { return $('.modal[data-modal="' + name + '"]'); }

function clearFieldErrors(scope) {
  $$('[data-field]', scope).forEach(function (n) { n.classList.remove('field-error'); });
  $$('.points', scope).forEach(function (n) { n.classList.remove('field-error'); });
  $$('[data-field-error]', scope).forEach(function (n) {
    n.textContent = '';
    n.hidden = true;
  });
}

function markFieldErrors(scope, details) {
  var marked = [];
  if (details && typeof details === 'object') {
    Object.keys(details).forEach(function (key) {
      var input = $('[data-field="' + key + '"]', scope);
      if (input) input.classList.add('field-error');
      var note = $('[data-field-error="' + key + '"]', scope);
      if (note) {
        note.textContent = String(details[key]);
        note.hidden = false;
      }
      marked.push(key);
    });
  }
  return marked;
}

function setFormError(scope, message) {
  var box = $('[data-form-error]', scope);
  if (!box) return;
  box.textContent = message;
  box.hidden = false;
}

function clearFormError(scope) {
  var box = $('[data-form-error]', scope);
  if (!box) return;
  box.textContent = '';
  box.hidden = true;
}

/* 统一错误出口：toast 显示 error.message，表单里点名 details 里的字段 */
function reportError(err, scope) {
  var message = (err && err.message) ? err.message : '请求失败';
  var code = (err && err.code) ? err.code : '';
  toast((code ? '[' + code + '] ' : '') + message, 'bad');
  if (scope) {
    markFieldErrors(scope, err ? err.details : null);
    setFormError(scope, message + (code ? '（' + code + '）' : ''));
  }
}

/* ---------------- 表单读写 ---------------- */

var FORM_FIELDS = 'input[data-field], select[data-field], textarea[data-field]';

function resetScope(scope) {
  $$(FORM_FIELDS, scope).forEach(function (input) {
    if (input.type === 'checkbox') input.checked = false;
    else if (input.multiple) $$('option', input).forEach(function (o) { o.selected = false; });
    else input.value = '';
  });
}

function fillScope(scope, obj) {
  if (!obj) return;
  $$(FORM_FIELDS, scope).forEach(function (input) {
    var key = input.dataset.field;
    if (obj[key] === undefined) return;
    if (input.type === 'checkbox') input.checked = !!obj[key];
    else if (input.multiple) {
      var list = Array.isArray(obj[key]) ? obj[key] : [];
      $$('option', input).forEach(function (o) { o.selected = list.indexOf(o.value) >= 0; });
    } else {
      input.value = obj[key] === null ? '' : String(obj[key]);
    }
  });
}

function readScope(scope) {
  var out = {};
  $$(FORM_FIELDS, scope).forEach(function (input) {
    var key = input.dataset.field;
    if (input.type === 'checkbox') out[key] = input.checked;
    else if (input.multiple) {
      out[key] = $$('option', input).filter(function (o) { return o.selected; })
        .map(function (o) { return o.value; });
    } else if (input.type === 'number') {
      out[key] = input.value === '' ? null : Number(input.value);
    } else {
      out[key] = input.value;
    }
  });
  return out;
}

function fillSelect(select, options, placeholder) {
  if (!select) return;
  select.innerHTML = '';
  if (placeholder !== undefined) {
    var head = el('option', null, placeholder);
    head.value = '';
    select.appendChild(head);
  }
  options.forEach(function (item) {
    var o = el('option', null, item.label);
    o.value = item.value;
    select.appendChild(o);
  });
}

/* ---------------- 弹层 ---------------- */

function openModal(name) {
  $('#modalMask').hidden = false;
  $$('.modal').forEach(function (m) { m.hidden = m.dataset.modal !== name; });
}

function closeModal() {
  $('#modalMask').hidden = true;
  $$('.modal').forEach(function (m) { m.hidden = true; });
}

/* ---------------- 标签切换 ---------------- */

async function switchTab(tab) {
  state.tab = tab;
  $$('.tab').forEach(function (b) { b.classList.toggle('is-active', b.dataset.tab === tab); });
  $$('.view').forEach(function (v) { v.classList.toggle('is-active', v.dataset.view === tab); });
  await loadTabData(tab);
}

function loadTabData(tab) {
  if (tab === 'overview') return loadSummary();
  if (tab === 'instruments') return loadInstruments();
  if (tab === 'records') return loadRecords();
  if (tab === 'standards') return loadStandards();
  if (tab === 'due') return loadDue();
  return Promise.resolve();
}

function refreshCurrent() { return loadTabData(state.tab); }

async function afterChange() {
  invalidateOptions();
  try { await loadSummary(); } catch (e) { /* 概览失败不挡住主流程 */ }
  await refreshCurrent();
}

function invalidateOptions() { state.instrumentOptions = null; }

/* ---------------- 概览 ---------------- */

async function loadSummary() {
  var data = await api('GET', '/api/summary');
  state.summary = data;
  $('#toolbarDate').textContent = '今日 ' + show(data.today);
  renderOverview();
}

function renderOverview() {
  var box = $('#overviewCards');
  box.innerHTML = '';
  var s = state.summary;
  if (!s) {
    box.appendChild(el('p', 'empty', '概览数字加载中…'));
    return;
  }
  var sc = s.statusCount || {};
  var nearest = s.nearestDue;
  var cards = [
    { label: '器具总数', value: s.instrumentCount, sub: '部门 ' + show(s.deptCount) + ' 个', go: { tab: 'instruments' } },
    { label: '在用', value: count(sc['在用']), go: { tab: 'instruments', inst: { status: '在用' } } },
    { label: '停用', value: count(sc['停用']), go: { tab: 'instruments', inst: { status: '停用' } } },
    { label: '送检中', value: count(sc['送检中']), go: { tab: 'instruments', inst: { status: '送检中' } } },
    { label: '报废', value: count(sc['报废']), go: { tab: 'instruments', inst: { status: '报废' } } },
    { label: '检定记录数', value: s.recordCount, go: { tab: 'records' } },
    { label: '检定点数', value: s.pointCount, go: { tab: 'records' } },
    { label: '不合格点数', value: s.unqualified, accent: true, go: { tab: 'records', rec: { verdict: '不合格' } } },
    { label: '合格记录数', value: s.qualifiedRecords, go: { tab: 'records', rec: { verdict: '合格' } } },
    { label: '本月应检', value: s.dueThisMonth, go: { tab: 'due' } },
    { label: '已超期', value: s.overdue, accent: true, go: { tab: 'due', dueBand: '已超期' } },
    {
      label: '最近到期',
      value: nearest ? show(nearest.code) : '—',
      sub: nearest ? (show(nearest.dueOn) + ' · 标记 ' + show(nearest.band)) : '清单为空',
      go: { tab: 'due' }
    },
    { label: '标准器台数', value: s.standardCount, go: { tab: 'standards' } }
  ];

  cards.forEach(function (item) {
    var btn = el('button', 'card' + (item.accent ? ' card-accent' : ''));
    btn.type = 'button';
    btn.appendChild(el('span', 'card-label', item.label));
    btn.appendChild(el('span', 'card-value', show(item.value)));
    btn.appendChild(el('span', 'card-sub', item.sub || '点这里看明细'));
    btn.addEventListener('click', function () { gotoFromCard(item.go); });
    box.appendChild(btn);
  });
}

async function gotoFromCard(go) {
  if (go.inst) {
    state.filters.inst = { keyword: '', status: '', category: '', deptId: '' };
    Object.keys(go.inst).forEach(function (k) { state.filters.inst[k] = go.inst[k]; });
    syncInstFilters();
  }
  if (go.rec) {
    state.filters.rec = { instrumentId: '', kind: '', verdict: '', from: '', to: '' };
    Object.keys(go.rec).forEach(function (k) { state.filters.rec[k] = go.rec[k]; });
    syncRecFilters();
  }
  if (go.dueBand !== undefined) {
    state.dueBand = go.dueBand;
    $('#fDueBand').value = go.dueBand;
  }
  await switchTab(go.tab);
}

/* ---------------- 器具 ---------------- */

function syncInstFilters() {
  var f = state.filters.inst;
  $('#fInstKeyword').value = f.keyword;
  $('#fInstStatus').value = f.status;
  $('#fInstCategory').value = f.category;
  $('#fInstDept').value = f.deptId;
}

function readInstFilters() {
  state.filters.inst = {
    keyword: $('#fInstKeyword').value.trim(),
    status: $('#fInstStatus').value,
    category: $('#fInstCategory').value,
    deptId: $('#fInstDept').value
  };
}

async function loadInstruments() {
  var f = state.filters.inst;
  var qs = buildQuery({ keyword: f.keyword, status: f.status, category: f.category, deptId: f.deptId });
  syncInstFilters();
  try {
    state.instruments = await api('GET', '/api/instruments' + qs);
  } catch (err) {
    reportError(err);
    state.instruments = [];
  }
  renderInstruments();
}

function formatRange(min, max, unit) {
  if (min === undefined || min === null || min === '') return '—';
  return show(min) + ' ~ ' + show(max) + (unit ? ' ' + String(unit) : '');
}

function renderInstruments() {
  var tbody = $('#instRows');
  tbody.innerHTML = '';
  var rows = state.instruments || [];
  $('#instEmpty').hidden = rows.length > 0;
  $('#instHint').textContent = '本页 ' + rows.length + ' 条';

  rows.forEach(function (inst) {
    var open = state.expanded.inst === inst.id;
    var tr = el('tr', 'row-click' + (open ? ' is-open' : ''));
    tr.appendChild(td(inst.code));
    tr.appendChild(td(inst.name));
    tr.appendChild(td(inst.category));
    tr.appendChild(td(formatRange(inst.rangeMin, inst.rangeMax, inst.unit)));
    tr.appendChild(td(inst.accuracyClass));
    tr.appendChild(badgeTd(inst.status, STATUS_CLASS));
    tr.appendChild(td(inst.dueOn));
    tr.appendChild(td(inst.daysLeft));
    tr.appendChild(inst.lastVerdict ? badgeTd(inst.lastVerdict, VERDICT_CLASS) : td(''));
    tr.addEventListener('click', function () { toggleInstDetail(inst.id); });
    tbody.appendChild(tr);

    if (open) {
      var detailTr = el('tr', 'detail-row');
      var cell = el('td');
      cell.colSpan = 9;
      cell.appendChild(renderInstDetail(inst));
      detailTr.appendChild(cell);
      tbody.appendChild(detailTr);
    }
  });
}

async function toggleInstDetail(id) {
  if (state.expanded.inst === id) {
    state.expanded.inst = null;
    renderInstruments();
    return;
  }
  state.expanded.inst = id;
  delete state.instDetail[id];
  renderInstruments();
  try {
    state.instDetail[id] = await api('GET', '/api/instruments/' + id);
    renderInstruments();
  } catch (err) {
    reportError(err);
    state.expanded.inst = null;
    renderInstruments();
  }
}

function renderInstDetail(inst) {
  var box = el('div', 'detail');
  var detail = state.instDetail[inst.id];
  if (!detail) {
    box.appendChild(el('p', 'muted', '详情加载中…'));
    return box;
  }

  var grid = el('div', 'detail-grid');
  addItem(grid, '部门', detail.deptName);
  addItem(grid, '责任人', detail.owner);
  addItem(grid, '上次检定日期', detail.lastCalibratedOn);
  addItem(grid, '检定周期', detail.cycleMonths ? detail.cycleMonths + ' 个月' : '');
  addItem(grid, '到期日', detail.dueOn);
  addItem(grid, '宽限截止', detail.graceEnd);
  addItem(grid, '剩余天数', detail.daysLeft);
  addNodeItem(grid, '标记', bandBadge(detail.band));
  addItem(grid, '强制检定', detail.mandatory ? '是' : '否');
  addItem(grid, '分辨力', detail.resolution);
  addItem(grid, '型号规格', detail.model);
  addItem(grid, '备注', detail.remark);
  box.appendChild(grid);

  var actions = el('div', 'detail-actions');
  var addBtn = el('button', 'btn btn-primary btn-sm', '新增检定记录');
  addBtn.type = 'button';
  addBtn.addEventListener('click', function (ev) {
    ev.stopPropagation();
    openRecordModal(inst.id);
  });
  actions.appendChild(addBtn);
  var editBtn = el('button', 'btn btn-sm', '修改');
  editBtn.type = 'button';
  editBtn.addEventListener('click', function (ev) {
    ev.stopPropagation();
    openInstrumentModal(inst.id);
  });
  actions.appendChild(editBtn);
  actions.appendChild(deleteControl('instruments', inst.id, '删除'));
  box.appendChild(actions);

  var con = detail.consecutive || { flag: false, times: 0, lastTwo: [] };
  var conBlock = el('div', 'detail-block');
  conBlock.appendChild(el('h4', null, '连续不合格标记'));
  var conLine = el('p', 'muted');
  conLine.appendChild(el('span', null, '接口 consecutive.flag = ' + (con.flag ? '是' : '否')
    + '，累计不合格次数 times = ' + show(con.times)));
  if (con.flag) conLine.appendChild(el('span', 'flag', '连续不合格'));
  conBlock.appendChild(conLine);
  conBlock.appendChild(buildSubTable(['记录编号', '日期', '结论'], (con.lastTwo || []).map(function (r) {
    return [r.code, r.date, verdictBadge(r.verdict)];
  })));
  box.appendChild(conBlock);

  var histBlock = el('div', 'detail-block');
  histBlock.appendChild(el('h4', null, '历史检定记录（' + (detail.records || []).length + ' 条）'));
  histBlock.appendChild(buildSubTable(['记录编号', '日期', '种类', '机构', '证书号', '结论'],
    (detail.records || []).map(function (r) {
      return [r.code, r.date, r.kind, r.org, r.certNo, verdictBadge(r.verdict)];
    })));
  box.appendChild(histBlock);

  var stdBlock = el('div', 'detail-block');
  stdBlock.appendChild(el('h4', null, '覆盖它的标准器（' + (detail.standards || []).length + ' 台）'));
  stdBlock.appendChild(buildSubTable(['编号', '名称', '等级', '证书号', '有效期至'],
    (detail.standards || []).map(function (s) {
      return [s.code, s.name, s.accuracyClass, s.certNo, s.validUntil];
    })));
  box.appendChild(stdBlock);

  return box;
}

function addItem(grid, key, value) {
  var wrap = el('div', 'detail-item');
  wrap.appendChild(el('span', 'k', key));
  wrap.appendChild(el('span', 'v', show(value)));
  grid.appendChild(wrap);
}

function addNodeItem(grid, key, node) {
  var wrap = el('div', 'detail-item');
  wrap.appendChild(el('span', 'k', key));
  var v = el('span', 'v');
  v.appendChild(node);
  wrap.appendChild(v);
  grid.appendChild(wrap);
}

/* 两步确认删除：第一次点把按钮变成「确认删除」，第二次点才发请求 */
function deleteControl(kind, id, label) {
  var key = kind + ':' + id;
  var pending = !!state.pendingDelete[key];
  var btn = el('button', 'btn btn-sm ' + (pending ? 'btn-danger' : 'btn-danger-ghost'),
    pending ? '确认删除' : label);
  btn.type = 'button';
  btn.addEventListener('click', function (ev) {
    ev.stopPropagation();
    if (!state.pendingDelete[key]) {
      state.pendingDelete[key] = true;
      refreshCurrent();
      return;
    }
    delete state.pendingDelete[key];
    performDelete(kind, id);
  });
  return btn;
}

async function performDelete(kind, id) {
  var base = kind === 'instruments' ? '/api/instruments/'
    : kind === 'records' ? '/api/records/'
      : '/api/standards/';
  try {
    await api('DELETE', base + id);
    toast('已删除：' + id, 'ok');
    if (kind === 'instruments') { delete state.instDetail[id]; state.expanded.inst = null; }
    if (kind === 'records') state.expanded.rec = null;
    if (kind === 'standards') state.expanded.std = null;
    await afterChange();
  } catch (err) {
    reportError(err);
    await refreshCurrent();
  }
}

/* ---------------- 检定记录 ---------------- */

function syncRecFilters() {
  var f = state.filters.rec;
  $('#fRecInstrument').value = f.instrumentId;
  $('#fRecVerdict').value = f.verdict;
  $('#fRecKind').value = f.kind;
  $('#fRecFrom').value = f.from;
  $('#fRecTo').value = f.to;
}

function readRecFilters() {
  state.filters.rec = {
    instrumentId: $('#fRecInstrument').value,
    kind: $('#fRecKind').value,
    verdict: $('#fRecVerdict').value,
    from: $('#fRecFrom').value,
    to: $('#fRecTo').value
  };
}

async function ensureInstrumentOptions() {
  if (state.instrumentOptions) return state.instrumentOptions;
  try {
    state.instrumentOptions = await api('GET', '/api/instruments');
  } catch (err) {
    reportError(err);
    state.instrumentOptions = [];
  }
  return state.instrumentOptions;
}

function instrumentOptions() {
  return (state.instrumentOptions || []).map(function (i) {
    return opt(i.id, i.code + ' ' + i.name);
  });
}

async function loadRecords() {
  var f = state.filters.rec;
  await ensureInstrumentOptions();
  var sel = $('#fRecInstrument');
  var keep = f.instrumentId;
  fillSelect(sel, instrumentOptions(), '全部器具');
  sel.value = keep;
  syncRecFilters();

  var qs = buildQuery({ instrumentId: f.instrumentId, kind: f.kind, verdict: f.verdict, from: f.from, to: f.to });
  try {
    state.records = await api('GET', '/api/records' + qs);
  } catch (err) {
    reportError(err);
    state.records = [];
  }
  renderRecords();
}

function renderRecords() {
  var tbody = $('#recRows');
  tbody.innerHTML = '';
  var rows = state.records || [];
  $('#recEmpty').hidden = rows.length > 0;

  rows.forEach(function (rec) {
    var open = state.expanded.rec === rec.id;
    var tr = el('tr', 'row-click' + (open ? ' is-open' : ''));
    tr.appendChild(td(rec.code));
    tr.appendChild(td(show(rec.instrumentCode) + ' ' + show(rec.instrumentName)));
    tr.appendChild(td(rec.date));
    tr.appendChild(td(rec.kind));
    tr.appendChild(td(rec.pointCount));
    tr.appendChild(td(rec.worstDeviation));
    tr.appendChild(badgeTd(rec.verdict, VERDICT_CLASS));
    tr.addEventListener('click', function () {
      state.expanded.rec = state.expanded.rec === rec.id ? null : rec.id;
      renderRecords();
    });
    tbody.appendChild(tr);

    if (open) {
      var detailTr = el('tr', 'detail-row');
      var cell = el('td');
      cell.colSpan = 7;
      cell.appendChild(renderRecordDetail(rec));
      detailTr.appendChild(cell);
      tbody.appendChild(detailTr);
    }
  });
}

function renderRecordDetail(rec) {
  var box = el('div', 'detail');

  var grid = el('div', 'detail-grid');
  addItem(grid, '器具', show(rec.instrumentCode) + ' ' + show(rec.instrumentName));
  addItem(grid, '种类', rec.kind);
  addItem(grid, '日期', rec.date);
  addItem(grid, '单位', rec.unit);
  addItem(grid, '机构', rec.org);
  addItem(grid, '证书号', rec.certNo);
  addItem(grid, '温度', rec.tempC);
  addItem(grid, '湿度', rec.rh);
  addItem(grid, '检定员', rec.operator);
  addItem(grid, '点数', rec.pointCount);
  addItem(grid, '判定点数', rec.judgedCount);
  addItem(grid, '不合格点数', rec.unqualifiedPoints);
  addItem(grid, '代表误差', rec.worstDeviation);
  addNodeItem(grid, '结论', verdictBadge(rec.verdict));
  addItem(grid, '备注', rec.remark);
  box.appendChild(grid);

  var pointsBlock = el('div', 'detail-block');
  pointsBlock.appendChild(el('h4', null, '逐点结果（单位 ' + show(rec.unit) + '，超差点已用底色标出）'));
  pointsBlock.appendChild(buildPointsTable(rec));
  box.appendChild(pointsBlock);

  var actions = el('div', 'detail-actions');
  actions.appendChild(deleteControl('records', rec.id, '删除这条记录（两步确认）'));
  box.appendChild(actions);

  return box;
}

function buildPointsTable(rec) {
  var table = el('table', 'sub');
  var thead = el('thead');
  var hr = el('tr');
  ['标准值', '示值', '误差', '该点允许误差', '该点是否合格'].forEach(function (h) {
    hr.appendChild(el('th', null, h));
  });
  thead.appendChild(hr);
  table.appendChild(thead);

  var tbody = el('tbody');
  var views = rec.views || [];
  if (!views.length) {
    var emptyTr = el('tr');
    var emptyTd = el('td', 'muted', '这条记录没有逐点结果');
    emptyTd.colSpan = 5;
    emptyTr.appendChild(emptyTd);
    tbody.appendChild(emptyTr);
  }
  views.forEach(function (v) {
    var tr = el('tr', v.qualified ? null : 'point-bad');
    tr.appendChild(td(v.standard));
    tr.appendChild(td(v.indicated));
    tr.appendChild(td(v.deviation));
    tr.appendChild(td(v.allowance));
    var q = el('td');
    q.appendChild(makeBadge(v.qualified ? '合格' : '不合格', VERDICT_CLASS));
    tr.appendChild(q);
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  return table;
}

/* ---------------- 标准器 ---------------- */

async function loadStandards() {
  try {
    state.standards = await api('GET', '/api/standards');
  } catch (err) {
    reportError(err);
    state.standards = [];
  }
  renderStandards();
}

function renderStandards() {
  var tbody = $('#stdRows');
  tbody.innerHTML = '';
  var rows = state.standards || [];
  $('#stdEmpty').hidden = rows.length > 0;

  rows.forEach(function (std) {
    var open = state.expanded.std === std.id;
    var tr = el('tr', 'row-click' + (open ? ' is-open' : ''));
    tr.appendChild(td(std.code));
    tr.appendChild(td(std.name));
    tr.appendChild(td(formatRange(std.rangeMin, std.rangeMax, std.unit)));
    tr.appendChild(td(std.accuracyClass));
    tr.appendChild(td(std.certNo));
    tr.appendChild(td(std.validUntil));
    tr.appendChild(badgeTd(std.band, BAND_CLASS));
    tr.appendChild(td(std.coverCount));
    tr.addEventListener('click', function () {
      state.expanded.std = state.expanded.std === std.id ? null : std.id;
      renderStandards();
    });
    tbody.appendChild(tr);

    if (open) {
      var detailTr = el('tr', 'detail-row');
      var cell = el('td');
      cell.colSpan = 8;
      cell.appendChild(renderStandardDetail(std));
      detailTr.appendChild(cell);
      tbody.appendChild(detailTr);
    }
  });
}

function renderStandardDetail(std) {
  var box = el('div', 'detail');

  var grid = el('div', 'detail-grid');
  addItem(grid, '编号', std.code);
  addItem(grid, '名称', std.name);
  addItem(grid, '量程', formatRange(std.rangeMin, std.rangeMax, std.unit));
  addItem(grid, '等级', std.accuracyClass);
  addItem(grid, '证书号', std.certNo);
  addItem(grid, '有效期至', std.validUntil);
  addNodeItem(grid, '状态标记', bandBadge(std.band));
  addItem(grid, '溯源机构', std.orgName);
  addItem(grid, '覆盖器具数', std.coverCount);
  addItem(grid, '备注', std.remark);
  box.appendChild(grid);

  var actions = el('div', 'detail-actions');
  var editBtn = el('button', 'btn btn-sm', '修改');
  editBtn.type = 'button';
  editBtn.addEventListener('click', function (ev) {
    ev.stopPropagation();
    openStandardModal(std.id);
  });
  actions.appendChild(editBtn);
  actions.appendChild(deleteControl('standards', std.id, '删除'));
  box.appendChild(actions);

  var coverBlock = el('div', 'detail-block');
  coverBlock.appendChild(el('h4', null, '覆盖清单'));
  coverBlock.appendChild(buildSubTable(['编号', '名称', '量程上限'],
    (std.coverList || []).map(function (c) { return [c.code, c.name, c.rangeMax]; })));
  box.appendChild(coverBlock);

  return box;
}

/* ---------------- 到期清单 ---------------- */

async function loadDue() {
  var qs = buildQuery({ band: state.dueBand });
  try {
    state.due = await api('GET', '/api/due' + qs);
  } catch (err) {
    reportError(err);
    state.due = { total: 0, rows: [] };
  }
  renderDue();
}

function renderDue() {
  var tbody = $('#dueRows');
  tbody.innerHTML = '';
  var payload = state.due || { total: 0, rows: [] };
  var rows = payload.rows || [];
  $('#dueEmpty').hidden = rows.length > 0;
  $('#dueHint').textContent = '接口返回 total = ' + show(payload.total)
    + (state.dueBand ? '（标记筛选：' + state.dueBand + '）' : '');

  rows.forEach(function (row) {
    var tr = el('tr');
    tr.appendChild(td(row.code));
    tr.appendChild(td(row.name));
    tr.appendChild(badgeTd(row.status, STATUS_CLASS));
    tr.appendChild(td(row.dueOn));
    tr.appendChild(td(row.graceEnd));
    tr.appendChild(td(row.daysLeft));
    tr.appendChild(badgeTd(row.band, BAND_CLASS));
    tbody.appendChild(tr);
  });
}

/* ---------------- 设置弹层 ---------------- */

function openSettingsModal() {
  var scope = modalScope('settings');
  clearFieldErrors(scope);
  clearFormError(scope);
  fillScope(scope, state.settings || {});
  openModal('settings');
}

async function submitSettings() {
  var scope = modalScope('settings');
  clearFieldErrors(scope);
  clearFormError(scope);
  var body = readScope(scope);
  try {
    state.settings = await api('PATCH', '/api/settings', body);
    toast('设置已保存', 'ok');
    closeModal();
    await afterChange();
  } catch (err) {
    reportError(err, scope);
  }
}

/* ---------------- 器具弹层 ---------------- */

async function openInstrumentModal(id) {
  var scope = modalScope('instrument');
  clearFieldErrors(scope);
  clearFormError(scope);
  resetScope(scope);
  state.editId.instrument = id || null;

  fillSelect($('[data-field="deptId"]', scope), (state.departments || []).map(function (d) {
    return opt(d.id, d.name + '（' + d.code + '）');
  }), '请选择部门');

  if (id) {
    $('#instModalTitle').textContent = '修改器具';
    var detail;
    try {
      detail = await api('GET', '/api/instruments/' + id);
    } catch (err) {
      reportError(err);
      return;
    }
    fillScope(scope, detail);
  } else {
    $('#instModalTitle').textContent = '新增器具';
    fillScope(scope, {
      category: 'B',
      accuracyClass: '2级',
      status: '在用',
      cycleMonths: state.settings ? state.settings.defaultCycleMonths : 12,
      mandatory: false
    });
    if ((state.departments || []).length) {
      $('[data-field="deptId"]', scope).value = state.departments[0].id;
    }
  }
  openModal('instrument');
}

async function submitInstrument() {
  var scope = modalScope('instrument');
  clearFieldErrors(scope);
  clearFormError(scope);
  var id = state.editId.instrument;
  var body = readScope(scope);
  try {
    if (id) await api('PATCH', '/api/instruments/' + id, body);
    else await api('POST', '/api/instruments', body);
    toast(id ? '器具已更新' : '器具已新增', 'ok');
    closeModal();
    if (id) delete state.instDetail[id];
    await afterChange();
  } catch (err) {
    reportError(err, scope);
  }
}

/* ---------------- 检定记录弹层 ---------------- */

async function openRecordModal(instrumentId) {
  var scope = modalScope('record');
  clearFieldErrors(scope);
  clearFormError(scope);
  resetScope(scope);

  var result = $('#recordResult');
  result.hidden = true;
  result.innerHTML = '';

  await ensureInstrumentOptions();
  var sel = $('[data-field="instrumentId"]', scope);
  fillSelect(sel, instrumentOptions(), '请选择器具');
  sel.disabled = false;
  if (instrumentId) {
    sel.value = instrumentId;
    sel.disabled = true;
  }

  $('[data-field="kind"]', scope).value = '检定';
  $('[data-field="date"]', scope).value = (state.summary && state.summary.today) || '';
  $('[data-field="tempC"]', scope).value = state.settings ? String(state.settings.tempReferenceC) : '';

  $('#pointRows').innerHTML = '';
  addPointRow('', '');
  addPointRow('', '');
  addPointRow('', '');
  updateRecordHint();

  openModal('record');
}

function updateRecordHint() {
  var scope = modalScope('record');
  var id = $('[data-field="instrumentId"]', scope).value;
  var hint = $('#recUnitHint');
  var inst = null;
  (state.instrumentOptions || []).forEach(function (i) { if (i.id === id) inst = i; });
  if (!inst) {
    hint.textContent = '选好器具后这里显示它的量程与单位。';
    return;
  }
  hint.textContent = '单位 ' + show(inst.unit)
    + '，量程 ' + show(inst.rangeMin) + ' ~ ' + show(inst.rangeMax)
    + '，准确度等级 ' + show(inst.accuracyClass)
    + '，状态 ' + show(inst.status);
  if (inst.status === '停用' || inst.status === '报废') {
    hint.textContent += '（该器具已是' + inst.status + '，按台子口径不宜再登记新记录）';
  }
}

function pointField(label, key, value) {
  var wrap = el('label');
  wrap.appendChild(el('span', 'field-label', label));
  var input = el('input');
  input.type = 'number';
  input.step = 'any';
  input.setAttribute('data-p', key);
  if (value !== undefined && value !== null) input.value = String(value);
  wrap.appendChild(input);
  return wrap;
}

function addPointRow(standard, indicated) {
  var row = el('div', 'point-row');
  row.appendChild(pointField('标准值', 'standard', standard));
  row.appendChild(pointField('示值', 'indicated', indicated));
  var del = el('button', 'btn btn-sm btn-danger-ghost', '删除');
  del.type = 'button';
  del.addEventListener('click', function () {
    var box = $('#pointRows');
    if ($$('.point-row', box).length <= 1) {
      toast('至少要留一个检定点', 'muted');
      return;
    }
    box.removeChild(row);
  });
  row.appendChild(del);
  $('#pointRows').appendChild(row);
}

function readPoints() {
  var filled = $$('#pointRows .point-row').map(function (row) {
    return {
      standard: $('input[data-p="standard"]', row).value.trim(),
      indicated: $('input[data-p="indicated"]', row).value.trim()
    };
  }).filter(function (r) { return r.standard !== '' || r.indicated !== ''; });

  for (var k = 0; k < filled.length; k += 1) {
    if (filled[k].standard === '' || filled[k].indicated === '') {
      return { points: null, problem: '第 ' + (k + 1) + ' 个点的标准值与示值都要填' };
    }
  }
  return {
    points: filled.map(function (r) {
      return { standard: Number(r.standard), indicated: Number(r.indicated) };
    }),
    problem: null
  };
}

async function submitRecord() {
  var scope = modalScope('record');
  clearFieldErrors(scope);
  clearFormError(scope);

  var body = readScope(scope);
  var read = readPoints();
  if (read.problem) {
    var note = $('[data-field-error="points"]', scope);
    if (note) { note.textContent = read.problem; note.hidden = false; }
    $('.points', scope).classList.add('field-error');
    setFormError(scope, read.problem);
    toast(read.problem, 'bad');
    return;
  }
  body.points = read.points;

  try {
    var saved = await api('POST', '/api/records', body);
    showRecordResult(saved);
    toast('记录已保存：' + show(saved.code) + '，结论 ' + show(saved.verdict), 'ok');
    delete state.instDetail[body.instrumentId];
    await afterChange();
  } catch (err) {
    reportError(err, scope);
  }
}

function showRecordResult(rec) {
  var box = $('#recordResult');
  box.innerHTML = '';
  box.hidden = false;
  box.className = 'record-result' + (rec.verdict === '不合格' ? ' is-bad' : '');

  var head = el('h4');
  head.appendChild(el('span', null, '后端判定结果：' + show(rec.code) + ' 结论 '));
  head.appendChild(verdictBadge(rec.verdict));
  head.appendChild(el('span', null, '，代表误差 ' + show(rec.worstDeviation) + ' ' + show(rec.unit)));
  box.appendChild(head);
  box.appendChild(el('p', 'muted', '点数 ' + show(rec.pointCount)
    + '，判定点数 ' + show(rec.judgedCount)
    + '，不合格点数 ' + show(rec.unqualifiedPoints)));
  box.appendChild(buildPointsTable(rec));
  box.scrollIntoView({ block: 'nearest' });
}

/* ---------------- 标准器弹层 ---------------- */

async function openStandardModal(id) {
  var scope = modalScope('standard');
  clearFieldErrors(scope);
  clearFormError(scope);
  resetScope(scope);
  state.editId.standard = id || null;

  await ensureInstrumentOptions();
  fillSelect($('[data-field="coversInstrumentIds"]', scope), instrumentOptions());

  if (id) {
    $('#stdModalTitle').textContent = '修改标准器';
    var list;
    try {
      list = await api('GET', '/api/standards');
    } catch (err) {
      reportError(err);
      return;
    }
    var found = null;
    (list || []).forEach(function (s) { if (s.id === id) found = s; });
    if (!found) {
      toast('这台标准器在接口里已经找不到了，请刷新后重试', 'bad');
      return;
    }
    fillScope(scope, found);
  } else {
    $('#stdModalTitle').textContent = '新增标准器';
    fillScope(scope, { accuracyClass: '1级' });
  }
  openModal('standard');
}

async function submitStandard() {
  var scope = modalScope('standard');
  clearFieldErrors(scope);
  clearFormError(scope);
  var id = state.editId.standard;
  var body = readScope(scope);
  try {
    if (id) await api('PATCH', '/api/standards/' + id, body);
    else await api('POST', '/api/standards', body);
    toast(id ? '标准器已更新' : '标准器已新增', 'ok');
    closeModal();
    await afterChange();
  } catch (err) {
    reportError(err, scope);
  }
}

/* ---------------- 事件绑定 ---------------- */

function bindStaticEvents() {
  $('#tabs').addEventListener('click', function (ev) {
    var btn = ev.target && ev.target.closest ? ev.target.closest('.tab') : null;
    if (btn) switchTab(btn.dataset.tab);
  });

  $('#btnSettings').addEventListener('click', openSettingsModal);

  $('#btnInstSearch').addEventListener('click', function () {
    readInstFilters();
    state.expanded.inst = null;
    loadInstruments();
  });
  $('#btnInstReset').addEventListener('click', function () {
    state.filters.inst = { keyword: '', status: '', category: '', deptId: '' };
    syncInstFilters();
    state.expanded.inst = null;
    loadInstruments();
  });
  $('#btnInstNew').addEventListener('click', function () { openInstrumentModal(null); });

  $('#btnRecSearch').addEventListener('click', function () {
    readRecFilters();
    state.expanded.rec = null;
    loadRecords();
  });
  $('#btnRecReset').addEventListener('click', function () {
    state.filters.rec = { instrumentId: '', kind: '', verdict: '', from: '', to: '' };
    syncRecFilters();
    state.expanded.rec = null;
    loadRecords();
  });
  $('#btnRecNew').addEventListener('click', function () { openRecordModal(null); });

  $('#btnStdNew').addEventListener('click', function () { openStandardModal(null); });

  $('#btnDueSearch').addEventListener('click', function () {
    state.dueBand = $('#fDueBand').value;
    loadDue();
  });
  $('#btnDueReset').addEventListener('click', function () {
    state.dueBand = '';
    $('#fDueBand').value = '';
    loadDue();
  });

  $('#btnAddPoint').addEventListener('click', function () { addPointRow('', ''); });
  $('[data-modal="record"] [data-field="instrumentId"]').addEventListener('change', updateRecordHint);

  $('#modalMask').addEventListener('click', function (ev) {
    if (ev.target === $('#modalMask')) closeModal();
  });

  document.addEventListener('click', function (ev) {
    var closer = ev.target && ev.target.closest ? ev.target.closest('[data-close]') : null;
    if (closer) closeModal();
    var submitter = ev.target && ev.target.closest ? ev.target.closest('[data-submit]') : null;
    if (!submitter) return;
    var which = submitter.dataset.submit;
    if (which === 'settings') submitSettings();
    else if (which === 'instrument') submitInstrument();
    else if (which === 'record') submitRecord();
    else if (which === 'standard') submitStandard();
  });

  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && !$('#modalMask').hidden) closeModal();
  });
}

function initFilterOptions() {
  fillSelect($('#fInstStatus'), ['在用', '停用', '送检中', '报废'].map(function (v) { return opt(v, v); }), '全部状态');
  fillSelect($('#fInstCategory'), ['A', 'B', 'C'].map(function (v) { return opt(v, v); }), '全部类别');
  fillSelect($('#fInstDept'), (state.departments || []).map(function (d) {
    return opt(d.id, d.name + '（' + d.code + '）');
  }), '全部部门');
  fillSelect($('#fRecVerdict'), ['合格', '不合格'].map(function (v) { return opt(v, v); }), '全部结论');
  fillSelect($('#fRecKind'), ['检定', '校准', '期间核查'].map(function (v) { return opt(v, v); }), '全部种类');
  syncInstFilters();
  syncRecFilters();
}

/* ---------------- 启动 ---------------- */

async function boot() {
  bindStaticEvents();

  await Promise.all([
    api('GET', '/api/settings').then(function (s) { state.settings = s; }, reportError),
    api('GET', '/api/departments').then(function (d) { state.departments = d || []; }, reportError)
  ]);

  initFilterOptions();
  fillSelect($('#fRecInstrument'), [], '全部器具');
  await loadSummary();
}

boot();
