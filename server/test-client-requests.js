const { spawn } = require('child_process');

function makeMessage(obj) {
  const s = JSON.stringify(obj);
  return `Content-Length: ${Buffer.byteLength(s, 'utf8')}\r\n\r\n${s}`;
}

function parseMessages(chunkBuf, state) {
  state.buf += chunkBuf.toString();
  const msgs = [];
  while (true) {
    const idx = state.buf.indexOf('\r\n\r\n');
    if (idx === -1) break;
    const header = state.buf.slice(0, idx);
    const m = header.match(/Content-Length:\s*(\d+)/i);
    if (!m) { state.buf = state.buf.slice(idx + 4); continue; }
    const len = parseInt(m[1], 10);
    const totalLen = idx + 4 + len;
    if (state.buf.length < totalLen) break;
    const body = state.buf.slice(idx + 4, totalLen);
    try { msgs.push(JSON.parse(body)); } catch (e) { /* ignore */ }
    state.buf = state.buf.slice(totalLen);
  }
  return msgs;
}

const server = spawn(process.execPath, ['server.js'], { cwd: __dirname, stdio: ['pipe', 'pipe', 'inherit'] });
const state = { buf: '' };

server.stdout.on('data', (d) => {
  process.stdout.write('[server] ' + d.toString());
  const msgs = parseMessages(d, state);
  for (const msg of msgs) handle(msg);
});

server.on('exit', (c) => console.log('server exited', c));

let id = 1;
function nextId() { return id++; }

function handle(msg) {
  if (msg.id === 1 && msg.result) {
    console.log('initialize result received');
    // send initialized notification
    server.stdin.write(makeMessage({ jsonrpc: '2.0', method: 'initialized', params: {} }));
    // open a document
    const uri = 'file:///C:/b4a/test.bas';
    const text = 'Sub Test\n  Dim x As Int\n  x = 1\nEnd Sub\n';
    server.stdin.write(makeMessage({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: { textDocument: { uri, languageId: 'b4x', version: 1, text } } }));
    // request completion at line 1, character 5
    const compId = nextId();
    server.stdin.write(makeMessage({ jsonrpc: '2.0', id: compId, method: 'textDocument/completion', params: { textDocument: { uri }, position: { line: 1, character: 5 } } }));
    // request hover at line 1, character 5
    const hoverId = nextId();
    server.stdin.write(makeMessage({ jsonrpc: '2.0', id: hoverId, method: 'textDocument/hover', params: { textDocument: { uri }, position: { line: 1, character: 5 } } }));
  } else if (msg.id && msg.result) {
    console.log('response', JSON.stringify(msg, null, 2));
  } else if (msg.method) {
    console.log('notification', msg.method);
  }
}

// send initialize
server.stdin.write(makeMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: null, capabilities: {} } }));

// safety timeout
setTimeout(() => { console.error('test timeout, killing'); server.kill(); }, 8000);
