// 连续不合格标记：用于把「最近检定不合格」的器具单独提出来加强管控。
// 口径是最近两次检定结论都为不合格才算连续不合格。
function consecutiveUnqualified(data, instrumentId) {
  const records = data.records
    .filter((r) => r.instrumentId === instrumentId)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  if (!records.length) return { flag: false, times: 0, lastTwo: [] };
  const latest = records[0];
  const flag = latest.verdict === '不合格';
  return {
    flag,
    times: records.filter((r) => r.verdict === '不合格').length,
    lastTwo: records.slice(0, 2).map((r) => ({ code: r.code, date: r.date, verdict: r.verdict })),
  };
}

module.exports = { consecutiveUnqualified };
