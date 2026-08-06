const http = require('http');
const appModule = require('../dist/app');
const app = appModule && appModule.default ? appModule.default : appModule;
const server = http.createServer(app);
server.listen(0, async () => {
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}/api/health`;
  console.log('Fetching', url);
  try {
    const res = await fetch(url);
    console.log('STATUS', res.status);
    const body = await res.text();
    console.log('BODY', body);
    server.close(() => process.exit(res.status === 200 ? 0 : 2));
  } catch (err) {
    console.error('ERR', err);
    server.close(() => process.exit(3));
  }
});
