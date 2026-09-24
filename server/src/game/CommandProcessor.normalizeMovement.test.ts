/**
 * Test: untrusted moves are validated and clamped before they reach the engine
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CommandProcessor, normalizeMovement, MAX_MOVE_DISTANCE } from './CommandProcessor.js';
import { RoomManager } from './RoomManager.js';
import { BOARD_WIDTH, BOARD_HEIGHT } from './constants.js';

const fakeWs = () => ({ readyState: 1, send() {} }) as any;

function freshGameState() {
  const rooms = new RoomManager();
  rooms.createRoom('TEST', fakeWs());
  const room = rooms.joinRoom('TEST', fakeWs(), 'local-b')!;
  return room.gameState;
}

test('normalizeMovement accepts a legal move unchanged', () => {
  assert.deepEqual(normalizeMovement({ pieceId: 3, direction: 'down', distance: 4 }), { pieceId: 3, direction: 'down', distance: 4 });
});

test('normalizeMovement clamps a huge distance to the board', () => {
  assert.equal(MAX_MOVE_DISTANCE, Math.max(BOARD_WIDTH, BOARD_HEIGHT) - 1);
  assert.equal(normalizeMovement({ pieceId: 1, direction: 'up', distance: 1e9 })?.distance, MAX_MOVE_DISTANCE);
});

test('normalizeMovement rejects bad piece ids, directions and distances', () => {
  const bad = [
    null,
    'up',
    { pieceId: 0, direction: 'up', distance: 1 },
    { pieceId: 8, direction: 'up', distance: 1 },
    { pieceId: 1.5, direction: 'up', distance: 1 },
    { pieceId: 1, direction: 'diagonal', distance: 1 },
    { pieceId: 1, direction: 'up', distance: 0 },
    { pieceId: 1, direction: 'up', distance: -3 },
    { pieceId: 1, direction: 'up', distance: 'far' },
    { pieceId: 1, direction: 'up', distance: Infinity }
  ];
  for (const raw of bad) {
    assert.equal(normalizeMovement(raw), null, `should reject ${JSON.stringify(raw)}`);
  }
});

test('executeMovements survives a raw 1e9 distance without allocating a giant path', () => {
  const gameState = freshGameState();
  const paths = new CommandProcessor().executeMovements(gameState, {
    playerA: [{ pieceId: 1, direction: 'down', distance: 1e9 }],
    playerB: []
  });
  for (const p of paths) {
    assert.ok(p.path.length <= MAX_MOVE_DISTANCE + 1, `path too long: ${p.path.length}`);
  }
});
