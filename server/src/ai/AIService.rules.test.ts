/**
 * Test: the rules text the model reads matches the real board in constants.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GAME_RULES } from './AIService.js';
import {
  BOARD_WIDTH,
  BOARD_HEIGHT,
  PIECES_PER_TEAM,
  STARTING_POSITIONS,
  FLAG_POSITIONS,
  TERRITORY
} from '../game/constants.js';

test('GAME_RULES states the real board size, piece count and piece IDs', () => {
  assert.ok(GAME_RULES.includes(`${BOARD_WIDTH}x${BOARD_HEIGHT} grid`));
  assert.ok(GAME_RULES.includes(`x: 0-${BOARD_WIDTH - 1}, y: 0-${BOARD_HEIGHT - 1}`));
  assert.ok(GAME_RULES.includes(`Each team has ${PIECES_PER_TEAM} pieces (IDs 1-${PIECES_PER_TEAM})`));
});

test('GAME_RULES piece IDs match STARTING_POSITIONS', () => {
  const ids = STARTING_POSITIONS.A.map(p => p.id);
  assert.deepEqual(ids, Array.from({ length: PIECES_PER_TEAM }, (_, i) => i + 1));
  assert.deepEqual(STARTING_POSITIONS.B.map(p => p.id), ids);
});

test('GAME_RULES states the real territories and flag spawns', () => {
  assert.ok(GAME_RULES.includes(`Blue territory: rows ${TERRITORY.A.min}-${TERRITORY.A.max}`));
  assert.ok(GAME_RULES.includes(`Red territory: rows ${TERRITORY.B.min}-${TERRITORY.B.max}`));
  assert.ok(GAME_RULES.includes(`Blue flag spawns at (${FLAG_POSITIONS.A.x}, ${FLAG_POSITIONS.A.y})`));
  assert.ok(GAME_RULES.includes(`Red flag spawns at (${FLAG_POSITIONS.B.x}, ${FLAG_POSITIONS.B.y})`));
});

test('GAME_RULES has none of the old 11x11 board text', () => {
  for (const stale of ['11x11', '0-10', 'IDs 0-4', '5 pieces', 'rows 6-10']) {
    assert.ok(!GAME_RULES.includes(stale), `stale text found: ${stale}`);
  }
});
