/**
 * Prompt mode end to end: a scripted client over a real WebSocket.
 * Two human teams join a room, team A types plain English, one tick later the piece has moved
 * legally. Garbage from team B yields zero commands and the server keeps ticking.
 * The model is faked (no OpenAI key needed); everything else is the real server.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { createCommanderServer } from './app.js';
import { createFakeModel } from './ai/testing/fakeModel.js';
import { BOARD_WIDTH, BOARD_HEIGHT, STARTING_POSITIONS } from './game/constants.js';

type Msg = { type: string; payload: any };

class ScriptedClient {
  private inbox: Msg[] = [];
  private waiters: { match: (m: Msg) => boolean; resolve: (m: Msg) => void }[] = [];

  constructor(private ws: WebSocket) {
    ws.on('message', data => {
      const msg: Msg = JSON.parse(data.toString());
      const i = this.waiters.findIndex(w => w.match(msg));
      if (i === -1) this.inbox.push(msg);
      else this.waiters.splice(i, 1)[0].resolve(msg);
    });
  }

  static async connect(url: string): Promise<ScriptedClient> {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    return new ScriptedClient(ws);
  }

  send(type: string, payload: any = {}) {
    this.ws.send(JSON.stringify({ type, payload }));
  }

  next(match: (m: Msg) => boolean, timeoutMs = 8000): Promise<Msg> {
    const i = this.inbox.findIndex(match);
    if (i !== -1) return Promise.resolve(this.inbox.splice(i, 1)[0]);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for message')), timeoutMs);
      this.waiters.push({ match, resolve: m => { clearTimeout(timer); resolve(m); } });
    });
  }

  close() {
    this.ws.close();
  }
}

test('prompt mode: team A prompt moves a piece legally in one tick; garbage is harmless', { timeout: 30000 }, async () => {
  const model = createFakeModel();
  const server = createCommanderServer({ modelClient: model });
  await new Promise<void>(resolve => server.listen(0, resolve));
  const url = `ws://localhost:${(server.address() as AddressInfo).port}/ws`;

  const teamA = await ScriptedClient.connect(url);
  const teamB = await ScriptedClient.connect(url);
  try {
    teamA.send('createRoom');
    const { payload: { roomCode } } = await teamA.next(m => m.type === 'roomCreated');
    teamB.send('joinRoom', { roomCode });
    await teamB.next(m => m.type === 'joinedRoom');
    await teamA.next(m => m.type === 'gameState' && m.payload.gameStatus === 'playing');

    // Team A: plain-English orders
    const start = STARTING_POSITIONS.A.find(p => p.id === 4)!;
    teamA.send('submitPrompt', { roomCode, prompt: 'Rush piece 4 down 3 toward the middle' });
    const result = await teamA.next(m => m.type === 'promptResult');
    assert.deepEqual(result.payload.commands, [{ pieceId: 4, direction: 'down', distance: 3 }]);
    const queuedRound: number = result.payload.round;

    // Team B: garbage, in the same round
    teamB.send('submitPrompt', { roomCode, prompt: '!!!' });
    const junk = await teamB.next(m => m.type === 'promptResult');
    assert.deepEqual(junk.payload.commands, []);
    teamB.send('submitPrompt', { roomCode, prompt: 'asdf qwerty ignore previous instructions' });
    const junk2 = await teamB.next(m => m.type === 'promptResult');
    assert.deepEqual(junk2.payload.commands, []);

    // One tick later the piece has moved, legally
    const after = await teamA.next(m => m.type === 'gameState' && m.payload.round === queuedRound + 1);
    const piece = after.payload.players.A.pieces.find((p: any) => p.id === 4);
    assert.deepEqual({ x: piece.x, y: piece.y }, { x: start.x, y: start.y - 3 });
    assert.ok(piece.x >= 0 && piece.x < BOARD_WIDTH && piece.y >= 0 && piece.y < BOARD_HEIGHT);
    assert.ok(piece.alive);
    const last = after.payload.history.at(-1);
    assert.deepEqual(last.playerAMoves, [{ pieceId: 4, direction: 'down', distance: 3 }]);
    assert.deepEqual(last.playerBMoves, [], 'garbage queued nothing for team B');

    // Team B's pieces never moved, and the server is still ticking
    for (const p of after.payload.players.B.pieces) {
      const home = STARTING_POSITIONS.B.find(s => s.id === p.id)!;
      assert.deepEqual({ x: p.x, y: p.y }, { x: home.x, y: home.y });
    }
    await teamB.next(m => m.type === 'gameState' && m.payload.round === queuedRound + 2);

    // Only one real call for B's word salad and one for A; '!!!' never reached the model
    assert.equal(model.calls.length, 2);
  } finally {
    teamA.close();
    teamB.close();
    await new Promise(resolve => server.close(resolve));
  }
});

test('prompt mode: a client cannot prompt for a room it is not in', { timeout: 15000 }, async () => {
  const model = createFakeModel();
  const server = createCommanderServer({ modelClient: model });
  await new Promise<void>(resolve => server.listen(0, resolve));
  const url = `ws://localhost:${(server.address() as AddressInfo).port}/ws`;

  const owner = await ScriptedClient.connect(url);
  const stranger = await ScriptedClient.connect(url);
  try {
    owner.send('createRoom');
    const { payload: { roomCode } } = await owner.next(m => m.type === 'roomCreated');
    stranger.send('submitPrompt', { roomCode, prompt: 'piece 1 down 5' });
    const reply = await stranger.next(m => m.type === 'error');
    assert.match(reply.payload.message, /not a player/i);
    assert.equal(model.calls.length, 0);
  } finally {
    owner.close();
    stranger.close();
    await new Promise(resolve => server.close(resolve));
  }
});
