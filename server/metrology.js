// 检定/校准结果的判定口径集中在这里：
// 1) 单点允许误差：按标准值在量程上的位置分两段，标准值不到半量程的按半个量程计，达到或超过半量程的按整个量程计（边界归高段）
// 2) 一条记录的结论：每一个点都落在自己的允许误差内才算合格
// 3) 代表误差：各点误差里绝对值最大的那一项
const CLASS_PERCENT = { '0.5级': 0.5, '1级': 1, '2级': 2 };
const DIGITS = 6;

function round(n, digits) {
  const d = digits == null ? DIGITS : digits;
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Number(v.toFixed(d));
}

function spanOf(instrument) {
  return round(Number(instrument.rangeMax) - Number(instrument.rangeMin), 6);
}

function classPercentOf(instrument) {
  const pct = CLASS_PERCENT[instrument.accuracyClass];
  return pct == null ? 1 : pct;
}

function deviationOf(point) {
  return round(Number(point.indicated) - Number(point.standard), 6);
}

function positionRatio(instrument, standardValue) {
  const span = spanOf(instrument);
  if (!span) return 0;
  return round(Math.abs(Number(standardValue) - Number(instrument.rangeMin)) / span, 6);
}

function mpeOf(instrument, standardValue, settings) {
  const span = spanOf(instrument);
  const pct = classPercentOf(instrument) / 100;
  const ratio = positionRatio(instrument, standardValue);
  const ratioLimit = settings && settings.segmentRatio != null ? Number(settings.segmentRatio) : 0.5;
  const base = ratio <= ratioLimit ? span * ratioLimit : span;
  return round(base * pct, 6);
}

function pointViews(instrument, points, settings) {
  return (points || []).map((point) => {
    const deviation = deviationOf(point);
    const allowance = mpeOf(instrument, point.standard, settings);
    return {
      standard: Number(point.standard),
      indicated: Number(point.indicated),
      deviation,
      allowance,
      qualified: Math.abs(deviation) <= allowance,
    };
  });
}

function worstDeviation(points) {
  const list = (points || []).map(deviationOf);
  if (!list.length) return 0;
  return round(list.reduce((sum, v) => sum + v, 0) / list.length, 6);
}

function recordVerdict(instrument, points, settings) {
  const views = pointViews(instrument, points, settings);
  const judged = views.length > 1 ? views.slice(0, views.length - 1) : views;
  const qualified = judged.length > 0 && judged.every((v) => v.qualified);
  return { views, worst: worstDeviation(points), judgedCount: judged.length, qualified };
}

module.exports = {
  CLASS_PERCENT,
  round,
  spanOf,
  classPercentOf,
  deviationOf,
  positionRatio,
  mpeOf,
  pointViews,
  worstDeviation,
  recordVerdict,
};
