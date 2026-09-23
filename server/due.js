const store = require('./store');
const instruments = require('./instruments');

function dueList(data, query) {
  const q = query || {};
  const today = store.todayIso();
  let rows = data.instruments
    .filter((i) => i.status === '在用')
    .map((i) => instruments.decorate(data, i, today));
  if (q.band) rows = rows.filter((r) => r.band === q.band);
  rows.sort((a, b) => (a.dueOn < b.dueOn ? 1 : a.dueOn > b.dueOn ? -1 : 0));
  return rows;
}

module.exports = { dueList };
