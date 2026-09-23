const fs = require('fs');
const path = require('path');
const { AppError } = require('./errors');

const dataFile = path.join(__dirname, '..', 'data', 'db.json');

const DEFAULT_SETTINGS = {
  baseUnit: 'mm',
  defaultCycleMonths: 12,
  graceDays: 15,
  segmentRatio: 0.5,
  tempReferenceC: 20,
  tempCoefficientPerC: 0.002,
};

function normalize(raw) {
  const data = raw && typeof raw === 'object' ? raw : {};
  data.settings = Object.assign({}, DEFAULT_SETTINGS, data.settings || {});
  for (const key of ['departments', 'instruments', 'records', 'standards', 'checks', 'usages']) {
    if (!Array.isArray(data[key])) data[key] = [];
  }
  return data;
}

function load() {
  let text;
  try {
    text = fs.readFileSync(dataFile, 'utf8');
  } catch (err) {
    throw new AppError(500, 'DATA_UNREADABLE', '数据文件读不出来，请检查 data/db.json 是否还在');
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new AppError(500, 'DATA_UNREADABLE', '数据文件解析失败，请检查 data/db.json 的内容');
  }
  return normalize(raw);
}

function save(data) {
  fs.writeFileSync(dataFile, JSON.stringify(data, null, 2), 'utf8');
}

function nextId(prefix, list) {
  let max = 0;
  for (const item of list || []) {
    const matched = String(item.id || '').match(/(\d+)$/);
    if (matched) max = Math.max(max, Number(matched[1]));
  }
  return prefix + '-' + String(max + 1).padStart(4, '0');
}

function todayIso() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

function addMonths(isoDate, months) {
  const parts = String(isoDate || '').split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return '';
  const base = new Date(parts[0], parts[1] - 1, parts[2]);
  const target = new Date(base.getFullYear(), base.getMonth() + Number(months || 0), base.getDate());
  const y = target.getFullYear();
  const m = String(target.getMonth() + 1).padStart(2, '0');
  const d = String(target.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

function addDays(isoDate, days) {
  const parts = String(isoDate || '').split('-').map(Number);
  if (parts.length !== 3) return '';
  const base = new Date(parts[0], parts[1] - 1, parts[2]);
  const target = new Date(base.getFullYear(), base.getMonth(), base.getDate() + Number(days || 0));
  const y = target.getFullYear();
  const m = String(target.getMonth() + 1).padStart(2, '0');
  const d = String(target.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

module.exports = { load, save, nextId, normalize, todayIso, addMonths, addDays, DEFAULT_SETTINGS, dataFile };
