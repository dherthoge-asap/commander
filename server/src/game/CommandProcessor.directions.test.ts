/**
 * CommandProcessor - Movement Direction Tests
 *
 * Tests that up/down/left/right movements work as expected:
 * - Basic movement without obstacles
 * - Movement blocked by guard zones
 *
 * Coordinate System Reference:
 * - y=0 (bottom) = Red territory
 * - y=10 (top) = Blue territory
 * - x=0 (left) to x=10 (right)
 *
 * Movement directions:
 * - up = stepY +1 (move toward y=10, toward Blue/top)
 * - down = stepY -1 (move toward y=0, toward Red/bottom)
 * - left = stepX -1 (move toward x=0)
 * - right = stepX +1 (move toward x=10)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CommandProcessor } from './CommandProcessor.js';
import type { CommanderGameState, Movement } from './types.js';

// Helper to create minimal game state for testing
function createGameState(): CommanderGameState {
  return {
    round: 1,
    players: {
      A: {
        id: 'player-a',
        player: { id: 'player-a', side: 'A', type: 'local-a' },
        pieces: [
          { id: 1, x: 5, y: 5, alive: true }, // Center of board
          { id: 2, x: 5, y: 8, alive: true }, // Blue territory
          { id: 3, x: 5, y: 2, alive: true }  // Red territory
        ],
        jailedPieces: []
      },
      B: {
        id: 'player-b',
        player: { id: 'player-b', side: 'B', type: 'ai' },
        pieces: [
          { id: 1, x: 5, y: 5, alive: true }, // Center of board
          { id: 2, x: 5, y: 2, alive: true }, // Red territory
          { id: 3, x: 5, y: 8, alive: true }  // Blue territory
        ],
        jailedPieces: []
      }
    },
    commandQueue: {},
    rescueKeys: { A: null, B: null },
    flags: {
      A: { x: 5, y: 10, carriedBy: null },
      B: { x: 5, y: 0, carriedBy: null }
    },
    noGuardZoneActive: { A: false, B: false }, // No guard zones for basic tests
    noGuardZoneBounds: {
      A: { minX: 4, maxX: 6, minY: 9, maxY: 10 },
      B: { minX: 4, maxX: 6, minY: 0, maxY: 1 }
    },
    gameStatus: 'playing',
    nextTickIn: 3,
    lastRoundTime: Date.now(),
    serverStartTime: Date.now()
  };
}

// ============================================================================
// BASIC MOVEMENT TESTS (No Guard Zones)
// ============================================================================

test('Movement Direction - UP increases Y coordinate (toward Blue/top)', () => {
  const processor = new CommandProcessor();
  const gameState = createGameState();

  // Blue P1 at (5,5) moves UP 3
  const command: Movement = { pieceId: 1, direction: 'up', distance: 3 };
  const paths = processor.executeMovements(gameState, {
    playerA: [command],
    playerB: []
  });

  const bluePath = paths.find(p => p.player === 'A' && p.pieceId === 1);
  assert.ok(bluePath, 'Should have path for Blue P1');

  console.log(`✓ UP movement: (5,5) → (${bluePath.finalPosition.x},${bluePath.finalPosition.y})`);

  // UP should INCREASE Y: 5 + 3 = 8
  assert.strictEqual(bluePath.finalPosition.x, 5, 'X should not change');
  assert.strictEqual(bluePath.finalPosition.y, 8, 'Y should increase by 3 (5→8)');
});

test('Movement Direction - DOWN decreases Y coordinate (toward Red/bottom)', () => {
  const processor = new CommandProcessor();
  const gameState = createGameState();

  // Blue P1 at (5,5) moves DOWN 3
  const command: Movement = { pieceId: 1, direction: 'down', distance: 3 };
  const paths = processor.executeMovements(gameState, {
    playerA: [command],
    playerB: []
  });

  const bluePath = paths.find(p => p.player === 'A' && p.pieceId === 1);
  assert.ok(bluePath, 'Should have path for Blue P1');

  console.log(`✓ DOWN movement: (5,5) → (${bluePath.finalPosition.x},${bluePath.finalPosition.y})`);

  // DOWN should DECREASE Y: 5 - 3 = 2
  assert.strictEqual(bluePath.finalPosition.x, 5, 'X should not change');
  assert.strictEqual(bluePath.finalPosition.y, 2, 'Y should decrease by 3 (5→2)');
});

test('Movement Direction - LEFT decreases X coordinate', () => {
  const processor = new CommandProcessor();
  const gameState = createGameState();

  // Blue P1 at (5,5) moves LEFT 2
  const command: Movement = { pieceId: 1, direction: 'left', distance: 2 };
  const paths = processor.executeMovements(gameState, {
    playerA: [command],
    playerB: []
  });

  const bluePath = paths.find(p => p.player === 'A' && p.pieceId === 1);
  assert.ok(bluePath, 'Should have path for Blue P1');

  console.log(`✓ LEFT movement: (5,5) → (${bluePath.finalPosition.x},${bluePath.finalPosition.y})`);

  // LEFT should DECREASE X: 5 - 2 = 3
  assert.strictEqual(bluePath.finalPosition.x, 3, 'X should decrease by 2 (5→3)');
  assert.strictEqual(bluePath.finalPosition.y, 5, 'Y should not change');
});

test('Movement Direction - RIGHT increases X coordinate', () => {
  const processor = new CommandProcessor();
  const gameState = createGameState();

  // Blue P1 at (5,5) moves RIGHT 4
  const command: Movement = { pieceId: 1, direction: 'right', distance: 4 };
  const paths = processor.executeMovements(gameState, {
    playerA: [command],
    playerB: []
  });

  const bluePath = paths.find(p => p.player === 'A' && p.pieceId === 1);
  assert.ok(bluePath, 'Should have path for Blue P1');

  console.log(`✓ RIGHT movement: (5,5) → (${bluePath.finalPosition.x},${bluePath.finalPosition.y})`);

  // RIGHT should INCREASE X: 5 + 4 = 9
  assert.strictEqual(bluePath.finalPosition.x, 9, 'X should increase by 4 (5→9)');
  assert.strictEqual(bluePath.finalPosition.y, 5, 'Y should not change');
});

// ============================================================================
// BOUNDARY TESTS
// ============================================================================

test('Movement stops at board boundaries - UP at y=12', () => {
  const processor = new CommandProcessor();
  const gameState = createGameState();

  // Blue P2 at (5,8) moves UP 5 (would go to y=13, but should stop at y=12)
  const command: Movement = { pieceId: 2, direction: 'up', distance: 5 };
  const paths = processor.executeMovements(gameState, {
    playerA: [command],
    playerB: []
  });

  const bluePath = paths.find(p => p.player === 'A' && p.pieceId === 2);
  assert.ok(bluePath, 'Should have path for Blue P2');

  console.log(`✓ UP boundary: (5,8) up 5 → stopped at (${bluePath.finalPosition.x},${bluePath.finalPosition.y})`);

  assert.strictEqual(bluePath.finalPosition.y, 12, 'Should stop at y=12 boundary');
});

test('Movement stops at board boundaries - DOWN at y=0', () => {
  const processor = new CommandProcessor();
  const gameState = createGameState();

  // Blue P3 at (5,2) moves DOWN 5 (would go to y=-3, but should stop at y=0)
  const command: Movement = { pieceId: 3, direction: 'down', distance: 5 };
  const paths = processor.executeMovements(gameState, {
    playerA: [command],
    playerB: []
  });

  const bluePath = paths.find(p => p.player === 'A' && p.pieceId === 3);
  assert.ok(bluePath, 'Should have path for Blue P3');

  console.log(`✓ DOWN boundary: (5,2) down 5 → stopped at (${bluePath.finalPosition.x},${bluePath.finalPosition.y})`);

  assert.strictEqual(bluePath.finalPosition.y, 0, 'Should stop at y=0 boundary');
});

test('Movement stops at board boundaries - LEFT at x=0', () => {
  const processor = new CommandProcessor();
  const gameState = createGameState();

  // Blue P1 at (5,5) moves LEFT 8 (would go to x=-3, but should stop at x=0)
  const command: Movement = { pieceId: 1, direction: 'left', distance: 8 };
  const paths = processor.executeMovements(gameState, {
    playerA: [command],
    playerB: []
  });

  const bluePath = paths.find(p => p.player === 'A' && p.pieceId === 1);
  assert.ok(bluePath, 'Should have path for Blue P1');

  console.log(`✓ LEFT boundary: (5,5) left 8 → stopped at (${bluePath.finalPosition.x},${bluePath.finalPosition.y})`);

  assert.strictEqual(bluePath.finalPosition.x, 0, 'Should stop at x=0 boundary');
});

test('Movement stops at board boundaries - RIGHT at x=18', () => {
  const processor = new CommandProcessor();
  const gameState = createGameState();

  // Blue P1 at (5,5) moves RIGHT 15 (would go to x=20, but should stop at x=18)
  const command: Movement = { pieceId: 1, direction: 'right', distance: 15 };
  const paths = processor.executeMovements(gameState, {
    playerA: [command],
    playerB: []
  });

  const bluePath = paths.find(p => p.player === 'A' && p.pieceId === 1);
  assert.ok(bluePath, 'Should have path for Blue P1');

  console.log(`✓ RIGHT boundary: (5,5) right 15 → stopped at (${bluePath.finalPosition.x},${bluePath.finalPosition.y})`);

  assert.strictEqual(bluePath.finalPosition.x, 18, 'Should stop at x=18 boundary');
});

// ============================================================================
// GUARD ZONE TESTS - BLUE TEAM (A)
// ============================================================================

test('Guard Zone - Blue defender blocked from entering own zone (UP)', () => {
  const processor = new CommandProcessor();
  const gameState = createGameState();
  gameState.noGuardZoneActive.A = true; // Activate Blue's guard zone

  // Blue P2 at (9,10) tries to move UP into guard zone at (9,11)
  gameState.players.A.pieces[1].x = 9;
  gameState.players.A.pieces[1].y = 10;

  const command: Movement = { pieceId: 2, direction: 'up', distance: 3 };
  const paths = processor.executeMovements(gameState, {
    playerA: [command],
    playerB: []
  });

  const bluePath = paths.find(p => p.player === 'A' && p.pieceId === 2);
  assert.ok(bluePath, 'Should have path for Blue P2');

  console.log(`✓ Blue guard zone UP: (9,10) up 3 → blocked at (${bluePath.finalPosition.x},${bluePath.finalPosition.y})`);

  // Should stop at y=10, can't enter y=11 (guard zone starts at y=11)
  assert.strictEqual(bluePath.finalPosition.y, 10, 'Should be blocked from entering guard zone');
});

test('Guard Zone - Red attacker can enter Blue zone (UP)', () => {
  const processor = new CommandProcessor();
  const gameState = createGameState();
  gameState.noGuardZoneActive.A = true; // Activate Blue's guard zone

  // Red P3 at (5,8) moves UP into Blue's guard zone
  const command: Movement = { pieceId: 3, direction: 'up', distance: 2 };
  const paths = processor.executeMovements(gameState, {
    playerA: [],
    playerB: [command]
  });

  const redPath = paths.find(p => p.player === 'B' && p.pieceId === 3);
  assert.ok(redPath, 'Should have path for Red P3');

  console.log(`✓ Red attacks Blue zone UP: (5,8) up 2 → (${redPath.finalPosition.x},${redPath.finalPosition.y})`);

  // Red should be able to enter - attackers aren't blocked
  assert.strictEqual(redPath.finalPosition.y, 10, 'Red attacker should enter Blue guard zone');
});

// ============================================================================
// GUARD ZONE TESTS - RED TEAM (B)
// ============================================================================

test('Guard Zone - Red defender blocked from entering own zone (DOWN)', () => {
  const processor = new CommandProcessor();
  const gameState = createGameState();
  gameState.noGuardZoneActive.B = true; // Activate Red's guard zone

  // Red P2 at (9,2) tries to move DOWN into guard zone at (9,1)
  gameState.players.B.pieces[1].x = 9;
  gameState.players.B.pieces[1].y = 2;

  const command: Movement = { pieceId: 2, direction: 'down', distance: 3 };
  const paths = processor.executeMovements(gameState, {
    playerA: [],
    playerB: [command]
  });

  const redPath = paths.find(p => p.player === 'B' && p.pieceId === 2);
  assert.ok(redPath, 'Should have path for Red P2');

  console.log(`✓ Red guard zone DOWN: (9,2) down 3 → blocked at (${redPath.finalPosition.x},${redPath.finalPosition.y})`);

  // Should stop at y=2, can't enter y=1 (guard zone is y=0-1)
  assert.strictEqual(redPath.finalPosition.y, 2, 'Should be blocked from entering guard zone');
});

test('Guard Zone - Blue attacker can enter Red zone (DOWN)', () => {
  const processor = new CommandProcessor();
  const gameState = createGameState();
  gameState.noGuardZoneActive.B = true; // Activate Red's guard zone

  // Blue P3 at (5,2) moves DOWN into Red's guard zone
  const command: Movement = { pieceId: 3, direction: 'down', distance: 2 };
  const paths = processor.executeMovements(gameState, {
    playerA: [command],
    playerB: []
  });

  const bluePath = paths.find(p => p.player === 'A' && p.pieceId === 3);
  assert.ok(bluePath, 'Should have path for Blue P3');

  console.log(`✓ Blue attacks Red zone DOWN: (5,2) down 2 → (${bluePath.finalPosition.x},${bluePath.finalPosition.y})`);

  // Blue should be able to enter - attackers aren't blocked
  assert.strictEqual(bluePath.finalPosition.y, 0, 'Blue attacker should enter Red guard zone');
});

test('Guard Zone - Blue defender blocked from LEFT into own zone', () => {
  const processor = new CommandProcessor();
  const gameState = createGameState();
  gameState.noGuardZoneActive.A = true;

  // Blue piece at (14,11) tries to move LEFT into guard zone
  gameState.players.A.pieces[0].x = 14;
  gameState.players.A.pieces[0].y = 11;

  const command: Movement = { pieceId: 1, direction: 'left', distance: 5 };
  const paths = processor.executeMovements(gameState, {
    playerA: [command],
    playerB: []
  });

  const bluePath = paths.find(p => p.player === 'A' && p.pieceId === 1);
  assert.ok(bluePath, 'Should have path for Blue P1');

  console.log(`✓ Blue guard zone LEFT: (14,11) left 5 → blocked at (${bluePath.finalPosition.x},${bluePath.finalPosition.y})`);

  // Should stop before entering guard zone (x=6-12 at y=11-12)
  assert.ok(bluePath.finalPosition.x > 12, 'Should be blocked from entering guard zone laterally');
});

test('Guard Zone - Red defender blocked from RIGHT into own zone', () => {
  const processor = new CommandProcessor();
  const gameState = createGameState();
  gameState.noGuardZoneActive.B = true;

  // Red piece at (3,1) tries to move RIGHT into guard zone
  gameState.players.B.pieces[0].x = 3;
  gameState.players.B.pieces[0].y = 1;

  const command: Movement = { pieceId: 1, direction: 'right', distance: 5 };
  const paths = processor.executeMovements(gameState, {
    playerA: [],
    playerB: [command]
  });

  const redPath = paths.find(p => p.player === 'B' && p.pieceId === 1);
  assert.ok(redPath, 'Should have path for Red P1');

  console.log(`✓ Red guard zone RIGHT: (3,1) right 5 → blocked at (${redPath.finalPosition.x},${redPath.finalPosition.y})`);

  // Should stop before entering guard zone (x=6-12 at y=0-1)
  assert.ok(redPath.finalPosition.x < 6, 'Should be blocked from entering guard zone laterally');
});

console.log('\n✅ All movement direction tests defined\n');
