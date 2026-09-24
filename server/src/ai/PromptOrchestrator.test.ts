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

function setup(model = createFakeModel()) {
  const sent: any[] = [];
  const ws = { readyState: 1, send: (m: string) => sent.push(JSON.parse(m)) } as any;
  const rooms = new RoomManager();
  rooms.createRoom('ROOM', ws);
  rooms.joinRoom('ROOM', { readyState: 1, send() {} } as any, 'local-b');
  const orchestrator = new PromptOrchestrator(rooms, new PromptTranslator(model));
  return { rooms, orchestrator, ws, sent, room: rooms.getRoom('ROOM')! };
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

test('prompts for a missing or finished room do nothing and do not throw', async () => {
  const { orchestrator, ws, room } = setup();
  await orchestrator.submit('NOPE', 'A', 'piece 1 down 1', ws);
  room.gameState.gameStatus = 'finished';
  await orchestrator.submit('ROOM', 'A', 'piece 1 down 1', ws);
  assert.deepEqual(room.gameState.commandQueue, {});
});
