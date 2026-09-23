const express = require('express');
const store = require('./store');
const { AppError } = require('./errors');
const instruments = require('./instruments');
const records = require('./records');
const standards = require('./standards');
const summary = require('./summary');
const due = require('./due');
const history = require('./history');

const router = express.Router();

function withData(handler) {
  return (req, res, next) => {
    try {
      const data = store.load();
      const result = handler(data, req);
      if (result && result.__save === true) store.save(data);
      if (result && typeof result === 'object' && '__body' in result) res.json(result.__body);
      else res.json(result);
    } catch (err) {
      next(err);
    }
  };
}

router.get('/health', (req, res) => {
  res.json({ ok: true, service: '计量器具检定与校准管理台', time: new Date().toISOString() });
});

router.get('/summary', withData((data) => summary.overview(data)));

router.get('/settings', withData((data) => data.settings));
router.patch('/settings', withData((data, req) => {
  const patch = req.body || {};
  for (const key of Object.keys(store.DEFAULT_SETTINGS)) {
    if (patch[key] !== undefined) data.settings[key] = patch[key];
  }
  return { __save: true, __body: data.settings };
}));

router.get('/departments', withData((data) => data.departments));

router.get('/instruments', withData((data, req) => instruments.list(data, req.query)));

router.get('/instruments/:id', withData((data, req) => {
  const detail = instruments.detail(data, req.params.id);
  return Object.assign({}, detail, { consecutive: history.consecutiveUnqualified(data, req.params.id) });
}));

router.post('/instruments', withData((data, req) => ({ __save: true, __body: instruments.create(data, req.body) })));

router.patch('/instruments/:id', withData((data, req) => {
  const updated = instruments.update(data, req.params.id, req.body);
  return { __save: true, __body: instruments.decorate(data, updated, store.todayIso()) };
}));

router.delete('/instruments/:id', withData((data, req) => ({ __save: true, __body: instruments.remove(data, req.params.id) })));

router.get('/records', withData((data, req) => records.list(data, req.query)));

router.get('/records/:id', withData((data, req) => records.detail(data, req.params.id)));

router.post('/records', withData((data, req) => ({ __save: true, __body: records.create(data, req.body) })));

router.delete('/records/:id', withData((data, req) => ({ __save: true, __body: records.remove(data, req.params.id) })));

router.get('/standards', withData((data) => standards.list(data)));

router.post('/standards', withData((data, req) => ({ __save: true, __body: standards.create(data, req.body) })));

router.patch('/standards/:id', withData((data, req) => ({ __save: true, __body: standards.update(data, req.params.id, req.body) })));

router.delete('/standards/:id', withData((data, req) => ({ __save: true, __body: standards.remove(data, req.params.id) })));

router.get('/due', withData((data, req) => {
  const rows = due.dueList(data, req.query);
  return { total: rows.length, rows };
}));

router.use((req, res, next) => {
  next(new AppError(404, 'NOT_FOUND', '这个地址没有对应功能：' + req.method + ' ' + req.originalUrl));
});

module.exports = router;
