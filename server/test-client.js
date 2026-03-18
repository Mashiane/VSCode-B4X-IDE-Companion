const { spawn } = require('child_process');

function makeMessage(obj) {
  const s = JSON.stringify(obj);
  return `Content-Length: ${Buffer.byteLength(s, 'utf8')}\r\n\r\n${s}`;
}

const server = spawn(process.execPath, ['server.js'], { cwd: __dirname, stdio: ['pipe', 'pipe', 'inherit'] });

server.stdout.on('data', (chunk) => {
  process.stdout.write('[server stdout] ' + chunk.toString());
});

let buffer = '';
server.stdout.on('data', (data) => {
  buffer += data.toString();
  // very simple parsing: print any JSON part
  const idx = buffer.indexOf('\r\n\r\n');
  if (idx !== -1) {
    const body = buffer.slice(idx + 4);
    try {
      const parsed = JSON.parse(body);
      console.log('<< response', JSON.stringify(parsed, null, 2));
      // after initialize, send shutdown and exit
      if (parsed.id === 1) {
        const shutdown = makeMessage({ jsonrpc: '2.0', id: 2, method: 'shutdown', params: null });
        server.stdin.write(shutdown);
        const exit = makeMessage({ jsonrpc: '2.0', method: 'exit' });
        // give server a moment
        setTimeout(() => { server.stdin.write(exit); }, 200);
      }
    } catch (e) {
      // ignore
    }
    buffer = '';
  }
});

server.on('exit', (code) => console.log('server exited', code));

// send initialize
const init = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { rootUri: null, capabilities: {} }
};

const msg = makeMessage(init);
server.stdin.write(msg);

// set a timeout in case nothing responds
setTimeout(() => {
  console.error('No response within 5s, killing server.');
  server.kill();
}, 5000);
