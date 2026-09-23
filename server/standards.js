const { AppError } = require('./errors');
const store = require('./store');

function decorate(data, standard) {
  const today = store.todayIso();
  const cover = (standard.coversInstrumentIds || [])
    .map((id) => data.instruments.find((i) => i.id === id))
    .filter(Boolean)
    .map((i) => ({ id: i.id, code: i.code, name: i.name, rangeMax: i.rangeMax }));
  let band = '有效';
  if (!standard.validUntil) band = '缺有效期';
  else if (standard.validUntil < today) band = '已过期';
  else if (standard.validUntil.slice(0, 7) === today.slice(0, 7)) band = '本月到期';
  return Object.assign({}, standard, {
    orgName: standard.org || '',
    coverCount: cover.length,
    coverList: cover,
    band,
  });
}

function list(data) {
  return data.standards.map((s) => decorate(data, s)).sort((a, b) => (a.code < b.code ? -1 : 1));
}

function find(data, id) {
  const found = data.standards.find((s) => s.id === id);
  if (!found) throw new AppError(404, 'STANDARD_NOT_FOUND', '这台标准器不存在');
  return found;
}

function validate(payload) {
  const errors = {};
  if (!String(payload.name || '').trim()) errors.name = '标准器名称不能为空';
  const rangeMin = Number(payload.rangeMin);
  const rangeMax = Number(payload.rangeMax);
  if (!Number.isFinite(rangeMin) || !Number.isFinite(rangeMax)) errors.rangeMin = '量程要填数字';
  else if (rangeMax <= rangeMin) errors.rangeMin = '量程上限要大于下限';
  if (!String(payload.certNo || '').trim()) errors.certNo = '证书号不能为空';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(payload.validUntil || ''))) errors.validUntil = '证书有效期要按 年-月-日 填';
  if (Object.keys(errors).length) {
    throw new AppError(400, 'VALIDATION_FAILED', '有几项没通过校验，请按提示补齐', errors);
  }
}

function create(data, payload) {
  validate(payload);
  const standard = {
    id: store.nextId('std', data.standards),
    code: 'BZ-' + String(data.standards.length + 1).padStart(4, '0'),
    name: String(payload.name).trim(),
    unit: data.settings.baseUnit,
    rangeMin: Number(payload.rangeMin),
    rangeMax: Number(payload.rangeMax),
    accuracyClass: ['0.5级', '1级', '2级'].includes(payload.accuracyClass) ? payload.accuracyClass : '1级',
    certNo: String(payload.certNo).trim(),
    validUntil: String(payload.validUntil),
    org: String(payload.org || '').trim(),
    coversInstrumentIds: Array.isArray(payload.coversInstrumentIds) ? payload.coversInstrumentIds : [],
    remark: String(payload.remark || ''),
  };
  data.standards.push(standard);
  return standard;
}

function update(data, id, payload) {
  const standard = find(data, id);
  const merged = Object.assign({}, standard, payload);
  validate(merged);
  Object.assign(standard, {
    name: String(merged.name).trim(),
    rangeMin: Number(merged.rangeMin),
    rangeMax: Number(merged.rangeMax),
    accuracyClass: merged.accuracyClass,
    certNo: String(merged.certNo).trim(),
    validUntil: String(merged.validUntil),
    org: String(merged.org || '').trim(),
    coversInstrumentIds: Array.isArray(merged.coversInstrumentIds) ? merged.coversInstrumentIds : standard.coversInstrumentIds,
    remark: String(merged.remark || ''),
  });
  return standard;
}

function remove(data, id) {
  find(data, id);
  data.standards = data.standards.filter((s) => s.id !== id);
  return { removed: id };
}

module.exports = { list, find, create, update, remove, decorate };
