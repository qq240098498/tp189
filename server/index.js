const path = require('path');
const express = require('express');
const api = require('./api');
const store = require('./store');

const app = express();
const port = Number(process.env.PORT || 5189);

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/api', api);

app.use((err, req, res, next) => {
  const status = err.status || 500;
  res.status(status).json({
    error: {
      code: err.code || 'INTERNAL_ERROR',
      message: err.message || '服务端出错了',
      details: err.details || null,
    },
  });
});

app.listen(port, () => {
  let info = '';
  try {
    const data = store.load();
    info = '器具 ' + data.instruments.length + ' 条、检定记录 ' + data.records.length + ' 条、标准器 ' + data.standards.length + ' 台';
  } catch (err) {
    info = '数据文件还没准备好：' + err.message;
  }
  console.log('计量器具检定与校准管理台已启动：http://127.0.0.1:' + port + '（' + info + '）');
});
