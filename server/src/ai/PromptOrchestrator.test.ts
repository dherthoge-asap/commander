/**
 * PromptOrchestrator Unit Tests
 * Commands land in the right round's queue; one model call in flight per team.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PromptOrchestrator } from './PromptOrchestrator.js';
import { PromptTranslator, type ChatMessage } from './PromptTranslator.js';
import { createFakeModel, ordersFrom } from './testing/fakeModel.js';
import { RoomManager } from '../game/RoomManager.js';

function setup(model = createFakeModel(), minIntervalMs = 0) {
  const sent: any[] = [];
  const ws = { readyState: 1, send: (m: string) => sent.push(JSON.parse(m)) } as any;
  const rooms = new RoomManager();
  rooms.createRoom('ROOM', ws);
  rooms.joinRoom('ROOM', { readyState: 1, send() {} } as any, 'local-b');
  const room = rooms.getRoom('ROOM')!;
  room.gameState.gameStatus = 'playing'; // the game loop would set this; not started in unit tests
  const orchestrator = new PromptOrchestrator(rooms, new PromptTranslator(model), { minIntervalMs });
  return { rooms, orchestrator, ws, sent, room };
}

test('both teams can prompt; each queues only its own side', async () => {
  const { orchestrator, ws, room, sent } = setup();
  await orchestrator.submit('ROOM', 'A', 'piece 4 down 3', ws);
  await orchestrator.submit('ROOM', 'B', 'piece 2 up 2', ws);

  assert.deepEqual(room.gameState.commandQueue[1].playerA, [{ pieceId: 4, direction: 'down', distance: 3 }]);
  assert.deepEqual(room.gameState.commandQueue[1].playerB, [{ pieceId: 2, direction: 'up', distance: 2 }]);
  assert.equal(sent.filter(m => m.type === 'promptResult').length, 2);
});

test('a later prompt replaces an earlier move for the same piece, keeps the others', async () => {
  const { orchestrator, ws, room } = setup();
  await orchestrator.submit('ROOM', 'A', 'piece 1 down 2 and piece 2 down 2', ws);
  await orchestrator.submit('ROOM', 'A', 'piece 1 left 3', ws);

  assert.deepEqual(room.gameState.commandQueue[1].playerA, [
    { pieceId: 2, direction: 'down', distance: 2 },
    { pieceId: 1, direction: 'left', distance: 3 }
  ]);
});

test('ten rapid prompts from one team make at most two model calls; the last one wins', async () => {
  const calls: ChatMessage[][] = [];
  let release!: () => void;
  const gate = new Promise<void>(r => { release = r; });
  const fake = createFakeModel();
  const slowModel = async (messages: ChatMessage[]) => {
    calls.push(messages);
    await gate;
    return fake(messages);
  };
  const { orchestrator, ws, room, sent } = setup(slowModel as any);

  const first = orchestrator.submit('ROOM', 'A', 'piece 1 down 1', ws);
  for (let i = 2; i <= 10; i++) {
    orchestrator.submit('ROOM', 'A', `piece ${i % 7 + 1} down ${i}`, ws);
  }
  release();
  await first;

  assert.equal(calls.length, 2);
  assert.equal(ordersFrom(calls[1]), 'piece 4 down 10');
  assert.equal(sent.filter(m => m.payload?.error === 'superseded').length, 8);
  assert.deepEqual(room.gameState.commandQueue[1].playerA.find(m => m.pieceId === 4), { pieceId: 4, direction: 'down', distance: 10 });
});

test('a late translation queues for the current round, not a round that already ran', async () => {
  let release!: () => void;
  const gate = new Promise<void>(r => { release = r; });
  const fake = createFakeModel();
  const { orchestrator, ws, room } = setup((async (m: ChatMessage[]) => { await gate; return fake(m); }) as any);

  const pending = orchestrator.submit('ROOM', 'A', 'piece 3 down 2', ws);
  room.gameState.round = 4; // three ticks passed while the model thought
  release();
  await pending;

  assert.equal(room.gameState.commandQueue[1], undefined);
  assert.deepEqual(room.gameState.commandQueue[4].playerA, [{ pieceId: 3, direction: 'down', distance: 2 }]);
});

test('prompts for a missing, waiting, paused or finished room queue nothing and never call the model', async () => {
  const model = createFakeModel();
  const { orchestrator, ws, room, sent } = setup(model);
  await orchestrator.submit('NOPE', 'A', 'piece 1 down 1', ws);
  for (const status of ['waiting', 'paused', 'finished'] as const) {
    room.gameState.gameStatus = status;
    await orchestrator.submit('ROOM', 'A', 'piece 1 down 1', ws);
  }
  assert.deepEqual(room.gameState.commandQueue, {});
  assert.equal(model.calls.length, 0);
  // Every refused prompt still gets an answer, so the UI never waits forever
  assert.deepEqual(sent.map(m => m.payload.error), ['no_room', 'not_playing', 'not_playing', 'not_playing']);
});

test('calls for one team start at least minIntervalMs apart; other teams are not held up', async () => {
  const starts: { side: string; at: number }[] = [];
  const fake = createFakeModel();
  const timedModel = async (messages: ChatMessage[]) => {
    starts.push({ side: messages[1].content.includes('Blue (Player A)') ? 'A' : 'B', at: Date.now() });
    return fake(messages);
  };
  const { orchestrator, ws } = setup(timedModel as any, 200);

  await orchestrator.submit('ROOM', 'A', 'piece 1 down 1', ws);
  await orchestrator.submit('ROOM', 'B', 'piece 1 up 1', ws);
  await orchestrator.submit('ROOM', 'A', 'piece 2 down 1', ws);

  const [a1, b1, a2] = starts;
  assert.equal(a1.side, 'A');
  assert.equal(b1.side, 'B');
  assert.ok(b1.at - a1.at < 150, 'team B did not wait on team A');
  assert.ok(a2.at - a1.at >= 195, `team A's second call waited out the interval (${a2.at - a1.at} ms)`);
});
