const { AppError } = require('./errors');
const store = require('./store');

const STATUS_LIST = ['在用', '停用', '送检中', '报废'];
const CATEGORY_LIST = ['A', 'B', 'C'];

function decorate(data, instrument, today) {
  const settings = data.settings;
  const cycle = Number(instrument.cycleMonths) > 0 ? Number(instrument.cycleMonths) : Number(settings.defaultCycleMonths);
  const dueOn = instrument.lastCalibratedOn ? store.addMonths(instrument.lastCalibratedOn, cycle) : '';
  const graceEnd = dueOn ? store.addDays(dueOn, Number(settings.graceDays)) : '';
  const day = today || store.todayIso();
  let band = '正常';
  if (instrument.status === '报废') band = '已报废';
  else if (instrument.status === '停用') band = '已停用';
  else if (instrument.status === '送检中') band = '送检中';
  else if (dueOn && day > graceEnd) band = '已超期';
  else if (dueOn && day > dueOn) band = '宽限内';
  else if (dueOn) band = '正常';

  const dept = data.departments.find((d) => d.id === instrument.deptId);
  const records = data.records.filter((r) => r.instrumentId === instrument.id);
  const latest = records.slice().sort((a, b) => (a.date < b.date ? 1 : -1))[0];

  return Object.assign({}, instrument, {
    deptName: dept ? dept.name : '',
    dueOn,
    graceEnd,
    daysLeft: dueOn ? Math.round((new Date(dueOn) - new Date(day)) / 86400000) : null,
    band,
    recordCount: records.length,
    lastRecordDate: latest ? latest.date : '',
    lastVerdict: latest ? latest.verdict : '',
  });
}

function list(data, query) {
  const q = query || {};
  const keyword = (q.keyword || '').trim();
  let rows = data.instruments.slice();
  if (q.status) rows = rows.filter((i) => i.status === q.status);
  if (q.category) rows = rows.filter((i) => i.category === q.category);
  if (q.deptId) rows = rows.filter((i) => i.deptId === q.deptId);
  if (keyword) {
    rows = rows.filter((i) =>
      [i.code, i.name, i.model, i.owner].some((f) => String(f || '').toLowerCase().includes(keyword.toLowerCase()))
    );
  }
  const today = store.todayIso();
  return rows
    .map((i) => decorate(data, i, today))
    .sort((a, b) => (a.code < b.code ? -1 : 1));
}

function find(data, id) {
  const found = data.instruments.find((i) => i.id === id);
  if (!found) throw new AppError(404, 'INSTRUMENT_NOT_FOUND', '这条器具不存在，可能已经删掉了');
  return found;
}

function detail(data, id) {
  const instrument = find(data, id);
  const today = store.todayIso();
  const records = data.records
    .filter((r) => r.instrumentId === id)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const standards = data.standards.filter((s) => (s.coversInstrumentIds || []).includes(id));
  return Object.assign({}, decorate(data, instrument, today), { records, standards });
}

function validate(payload) {
  const errors = {};
  if (!payload || typeof payload !== 'object') throw new AppError(400, 'INVALID_PAYLOAD', '提交的内容格式不对');
  if (!String(payload.name || '').trim()) errors.name = '器具名称不能为空';
  if (!STATUS_LIST.includes(payload.status)) errors.status = '状态只能是：' + STATUS_LIST.join('、');
  if (!CATEGORY_LIST.includes(payload.category)) errors.category = '类别只能是：' + CATEGORY_LIST.join('、');
  const rangeMin = Number(payload.rangeMin);
  const rangeMax = Number(payload.rangeMax);
  if (!Number.isFinite(rangeMin) || !Number.isFinite(rangeMax)) errors.rangeMin = '量程要填数字';
  else if (rangeMax <= rangeMin) errors.rangeMin = '量程上限要大于下限';
  const cycle = Number(payload.cycleMonths);
  if (!Number.isFinite(cycle) || cycle <= 0 || cycle > 120) errors.cycleMonths = '检定周期请在 1 到 120 个月之间';
  if (Object.keys(errors).length) {
    throw new AppError(400, 'VALIDATION_FAILED', '有几项没通过校验，请按提示补齐', errors);
  }
}

function create(data, payload) {
  validate(payload);
  if (!payload.deptId || !data.departments.some((d) => d.id === payload.deptId)) {
    throw new AppError(400, 'VALIDATION_FAILED', '请选择所在部门', { deptId: '部门不存在' });
  }
  const instrument = {
    id: store.nextId('inst', data.instruments),
    code: 'JL-' + String(data.instruments.length + 1).padStart(4, '0'),
    name: String(payload.name).trim(),
    model: String(payload.model || '').trim(),
    category: payload.category,
    unit: data.settings.baseUnit,
    rangeMin: Number(payload.rangeMin),
    rangeMax: Number(payload.rangeMax),
    resolution: Number(payload.resolution) || 0.01,
    accuracyClass: ['0.5级', '1级', '2级'].includes(payload.accuracyClass) ? payload.accuracyClass : '2级',
    cycleMonths: Number(payload.cycleMonths),
    mandatory: !!payload.mandatory,
    status: payload.status,
    deptId: payload.deptId,
    owner: String(payload.owner || '').trim(),
    lastCalibratedOn: String(payload.lastCalibratedOn || ''),
    remark: String(payload.remark || ''),
  };
  data.instruments.push(instrument);
  return instrument;
}

function update(data, id, payload) {
  const instrument = find(data, id);
  const merged = Object.assign({}, instrument, payload);
  validate(merged);
  if (payload.deptId && !data.departments.some((d) => d.id === payload.deptId)) {
    throw new AppError(400, 'VALIDATION_FAILED', '请选择所在部门', { deptId: '部门不存在' });
  }
  Object.assign(instrument, {
    name: String(merged.name).trim(),
    model: String(merged.model || '').trim(),
    category: merged.category,
    rangeMin: Number(merged.rangeMin),
    rangeMax: Number(merged.rangeMax),
    resolution: Number(merged.resolution) || instrument.resolution,
    accuracyClass: merged.accuracyClass,
    cycleMonths: Number(merged.cycleMonths),
    mandatory: !!merged.mandatory,
    status: merged.status,
    deptId: merged.deptId || instrument.deptId,
    owner: String(merged.owner || '').trim(),
    lastCalibratedOn: String(merged.lastCalibratedOn || instrument.lastCalibratedOn || ''),
    remark: String(merged.remark || ''),
  });
  return instrument;
}

function remove(data, id) {
  const instrument = find(data, id);
  const used = data.records.filter((r) => r.instrumentId === id).length;
  if (used > 0) {
    throw new AppError(409, 'INSTRUMENT_IN_USE', '这条器具名下已经有 ' + used + ' 条检定记录，不能删除，请改为停用或报废', { recordCount: used });
  }
  data.instruments = data.instruments.filter((i) => i.id !== id);
  return { removed: id };
}

module.exports = { list, detail, find, create, update, remove, decorate, STATUS_LIST, CATEGORY_LIST };
