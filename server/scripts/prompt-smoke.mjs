// Prompt-mode smoke test against a running server with a real model behind it.
// Usage (from server/):  node scripts/prompt-smoke.mjs [ws-url] ["team A prompt"]
//   default url: ws://localhost:9999/ws   e.g. wss://commander-production.up.railway.app/ws
// Opens two clients (team A and team B), submits one prompt for A and one garbage prompt for B,
// waits one tick, and reports whether A's pieces moved and B's stayed put. Exit code 0 = pass.
import { WebSocket } from 'ws';

const url = process.argv[2] || 'ws://localhost:9999/ws';
const promptA = process.argv[3] || 'Send piece 4 straight down 3 squares toward the middle.';

function client() {
  const ws = new WebSocket(url);
  const inbox = [];
  const waiters = [];
  ws.on('message', data => {
    const msg = JSON.parse(data.toString());
    const i = waiters.findIndex(w => w.match(msg));
    if (i === -1) inbox.push(msg); else waiters.splice(i, 1)[0].resolve(msg);
  });
  return {
    ws,
    open: () => new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); }),
    send: (type, payload = {}) => ws.send(JSON.stringify({ type, payload })),
    next: (match, ms = 20000) => {
      const i = inbox.findIndex(match);
      if (i !== -1) return Promise.resolve(inbox.splice(i, 1)[0]);
      return new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error('timed out')), ms);
        waiters.push({ match, resolve: m => { clearTimeout(t); res(m); } });
      });
    }
  };
}

const a = client();
const b = client();
let ok = false;
try {
  await Promise.all([a.open(), b.open()]);
  a.send('createRoom');
  const { payload: { roomCode } } = await a.next(m => m.type === 'roomCreated');
  b.send('joinRoom', { roomCode });
  await a.next(m => m.type === 'gameState' && m.payload.gameStatus === 'playing');
  console.log(`room ${roomCode} playing`);

  const t0 = Date.now();
  a.send('submitPrompt', { roomCode, prompt: promptA });
  b.send('submitPrompt', { roomCode, prompt: 'asdf qwerty zzz' });
  const ra = await a.next(m => m.type === 'promptResult');
  const rb = await b.next(m => m.type === 'promptResult');
  console.log(`A (${Date.now() - t0} ms): ${JSON.stringify(ra.payload.commands)} "${ra.payload.summary}" ${ra.payload.error || ''}`);
  console.log(`B garbage: ${JSON.stringify(rb.payload.commands)} ${rb.payload.error || ''}`);

  const after = await a.next(m => m.type === 'gameState' && m.payload.round > ra.payload.round);
  const last = after.payload.history.at(-1);
  console.log(`round ${last.round} executed: A moves ${JSON.stringify(last.playerAMoves)}, B moves ${JSON.stringify(last.playerBMoves)}`);
  ok = ra.payload.commands.length > 0 && last.playerAMoves.length > 0 && rb.payload.commands.length === 0;
} catch (e) {
  console.error('smoke failed:', e.message);
} finally {
  a.ws.close();
  b.ws.close();
}
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
