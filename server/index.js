const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const { initDb, DATA_DIR } = require('./db');
const formRouter = require('./routes/form');
const optionsRouter = require('./routes/options');
const planOptionsRouter = require('./routes/plan-options');
const exportsRouter = require('./routes/exports');
const plansRouter = require('./routes/plans');
const { TIME_ZONE, todayISO } = require('./services/date');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const CLIENT_DIST = path.join(__dirname, '..', 'client', 'dist');

app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    applicationDate: todayISO(),
    timeZone: TIME_ZONE,
    dataDir: DATA_DIR,
    timestamp: new Date().toISOString(),
  });
});

app.use('/api/form', formRouter);
app.use('/api/options', optionsRouter);
app.use('/api/plan-options', planOptionsRouter);
app.use('/api/exports', exportsRouter);
app.use('/api/plans', plansRouter);

app.use('/api', (req, res) => {
  res.status(404).json({ message: '接口不存在' });
});

// 生产环境由 Express 直接托管 Vite 构建产物
if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST, { index: false, maxAge: '1h' }));
  app.get('*', (req, res) => {
    res.sendFile(path.join(CLIENT_DIST, 'index.html'));
  });
} else {
  app.get('/', (req, res) => {
    res
      .status(200)
      .type('text/plain; charset=utf-8')
      .send('后端已启动。开发模式请访问 Vite 地址，或先运行 npm run build 构建前端。');
  });
}

// 统一错误处理
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ message: 'CSV 文件不能超过 2MB' });
    }
    return res.status(400).json({ message: `文件上传失败：${error.message}` });
  }
  if (error && error.type === 'entity.too.large') {
    return res.status(413).json({ message: '提交内容过大' });
  }
  if (error && error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    return res.status(400).json({ message: '请求 JSON 格式不正确' });
  }
  console.error('[server] error:', error);
  res.status(500).json({ message: '服务器内部错误，请稍后重试' });
});

initDb()
  .then(() => {
    app.listen(PORT, HOST, () => {
      console.log(`[server] 财务管理系统变更申请表已启动: http://localhost:${PORT}`);
      console.log(`[server] 服务端日期: ${todayISO()} (${TIME_ZONE})`);
      console.log(`[server] 数据目录: ${DATA_DIR}`);
    });
  })
  .catch((error) => {
    console.error('[server] 数据库初始化失败:', error);
    process.exit(1);
  });
