const { AppError } = require('./errors');
const store = require('./store');
const metrology = require('./metrology');
const instruments = require('./instruments');

const KIND_LIST = ['检定', '校准', '期间核查'];

function decorate(data, record) {
  const instrument = data.instruments.find((i) => i.id === record.instrumentId);
  const judged = instrument
    ? metrology.recordVerdict(instrument, record.points, data.settings)
    : { views: [], worst: 0, qualified: false };
  return Object.assign({}, record, {
    instrumentCode: instrument ? instrument.code : '(器具已删除)',
    instrumentName: instrument ? instrument.name : '',
    unit: instrument ? instrument.unit : data.settings.baseUnit,
    views: judged.views,
    worstDeviation: judged.worst,
    judgedCount: judged.judgedCount,
    pointCount: (record.points || []).length,
    unqualifiedPoints: judged.views.filter((v) => !v.qualified).length,
  });
}

function list(data, query) {
  const q = query || {};
  let rows = data.records.slice();
  if (q.instrumentId) rows = rows.filter((r) => r.instrumentId === q.instrumentId);
  if (q.kind) rows = rows.filter((r) => r.kind === q.kind);
  if (q.verdict) rows = rows.filter((r) => r.verdict === q.verdict);
  if (q.from) rows = rows.filter((r) => r.date >= q.from);
  if (q.to) rows = rows.filter((r) => r.date <= q.to);
  return rows
    .map((r) => decorate(data, r))
    .sort((a, b) => (a.date === b.date ? (a.code < b.code ? 1 : -1) : a.date < b.date ? 1 : -1));
}

function find(data, id) {
  const found = data.records.find((r) => r.id === id);
  if (!found) throw new AppError(404, 'RECORD_NOT_FOUND', '这条检定记录不存在');
  return found;
}

function detail(data, id) {
  return decorate(data, find(data, id));
}

function create(data, payload) {
  if (!payload || typeof payload !== 'object') throw new AppError(400, 'INVALID_PAYLOAD', '提交的内容格式不对');
  const instrument = instruments.find(data, payload.instrumentId);
  const kind = KIND_LIST.includes(payload.kind) ? payload.kind : '检定';
  const date = String(payload.date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new AppError(400, 'VALIDATION_FAILED', '检定日期要按 年-月-日 填', { date: '日期格式不对' });
  }
  const points = Array.isArray(payload.points) ? payload.points : [];
  if (!points.length) {
    throw new AppError(400, 'VALIDATION_FAILED', '至少要录一个检定点', { points: '一个点都没有' });
  }
  const normalized = [];
  for (let i = 0; i < points.length; i += 1) {
    const standard = Number(points[i].standard);
    const indicated = Number(points[i].indicated);
    if (!Number.isFinite(standard) || !Number.isFinite(indicated)) {
      throw new AppError(400, 'VALIDATION_FAILED', '第 ' + (i + 1) + ' 个点的标准值与示值都要填数字', { points: '第 ' + (i + 1) + ' 个点不是数字' });
    }
    if (standard < Number(instrument.rangeMin) || standard > Number(instrument.rangeMax)) {
      throw new AppError(400, 'VALIDATION_FAILED', '第 ' + (i + 1) + ' 个点的标准值超出了这条器具的量程', { points: '第 ' + (i + 1) + ' 个点超出量程' });
    }
    normalized.push({ standard, indicated });
  }

  const judged = metrology.recordVerdict(instrument, normalized, data.settings);
  const year = date.slice(0, 4);
  const sameYear = data.records.filter((r) => r.date.slice(0, 4) === year).length;
  const record = {
    id: store.nextId('cal', data.records),
    code: 'JD' + year + '-' + String(sameYear + 1).padStart(3, '0'),
    instrumentId: instrument.id,
    kind,
    date,
    org: String(payload.org || '').trim(),
    certNo: String(payload.certNo || '').trim(),
    tempC: Number(payload.tempC),
    rh: Number(payload.rh),
    points: normalized,
    verdict: judged.qualified ? '合格' : '不合格',
    operator: String(payload.operator || '').trim(),
    remark: String(payload.remark || ''),
  };
  data.records.push(record);
  if (!instrument.lastCalibratedOn || record.date >= instrument.lastCalibratedOn) {
    instrument.lastCalibratedOn = record.date;
  }
  return decorate(data, record);
}

function remove(data, id) {
  const record = find(data, id);
  data.records = data.records.filter((r) => r.id !== id);
  const instrument = data.instruments.find((i) => i.id === record.instrumentId);
  if (instrument) {
    const rest = data.records
      .filter((r) => r.instrumentId === instrument.id)
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    instrument.lastCalibratedOn = rest.length ? rest[0].date : '';
  }
  return { removed: id };
}

module.exports = { list, detail, find, create, remove, decorate, KIND_LIST };
