const store = require('./store');
const metrology = require('./metrology');
const due = require('./due');

function overview(data) {
  const settings = data.settings;
  const today = store.todayIso();
  const month = today.slice(0, 7);

  const statusCount = {};
  for (const item of data.instruments) {
    statusCount[item.status] = (statusCount[item.status] || 0) + 1;
  }

  let unqualifiedPoints = 0;
  let qualifiedRecords = 0;
  for (const record of data.records) {
    const instrument = data.instruments.find((i) => i.id === record.instrumentId);
    if (!instrument) continue;
    const judged = metrology.recordVerdict(instrument, record.points, settings);
    unqualifiedPoints += judged.views.filter((v) => !v.qualified).length;
    if (judged.qualified) qualifiedRecords += 1;
  }

  const dueRows = due.dueList(data);
  const dueThisMonth = dueRows.filter((row) => row.dueOn.slice(0, 7) === month).length;
  const overdue = dueRows.filter((row) => row.band === '已超期').length;

  const allPointCount = data.records.reduce((sum, r) => sum + (r.points || []).length, 0);

  return {
    today,
    instrumentCount: data.instruments.length,
    statusCount,
    recordCount: data.records.length,
    pointCount: allPointCount,
    unqualified: unqualifiedPoints,
    qualifiedRecords,
    dueThisMonth,
    overdue,
    nearestDue: dueRows.length ? dueRows[0] : null,
    standardCount: data.standards.length,
    deptCount: data.departments.length,
  };
}

module.exports = { overview };
