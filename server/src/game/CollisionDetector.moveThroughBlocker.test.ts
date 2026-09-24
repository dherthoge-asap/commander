/**
 * Test for bug: Piece moving through blocker to score
 *
 * Scenario:
 * - Red piece 1 has Blue flag at (9, 1) moving DOWN to score at (9, 0)
 * - Blue piece 3 is at (9, 1) trying to block
 * - Red piece 1 should NOT be able to move through Blue piece 3
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CollisionDetector } from './CollisionDetector.js';
import { CommandProcessor } from './CommandProcessor.js';
import { FlagManager } from './FlagManager.js';
import type { CommanderGameState } from './types.js';

function createBlockerScenario(): CommanderGameState {
  return {
    players: {
      A: {
        id: 'player-a',
        type: 'local-a' as const,
        pieces: [
          { id: 1, x: 7, y: 8, alive: true },
          { id: 2, x: 8, y: 8, alive: true },
          { id: 3, x: 9, y: 1, alive: true }, // BLOCKER - directly in front of Red's scoring path
          { id: 4, x: 10, y: 8, alive: true },
          { id: 5, x: 11, y: 8, alive: true }
        ],
        jailedPieces: []
      },
      B: {
        id: 'player-b',
        type: 'local-b' as const,
        pieces: [
          { id: 1, x: 9, y: 2, alive: true }, // Flag carrier trying to score (has Blue flag, starting at y=2)
          { id: 2, x: 8, y: 2, alive: true },
          { id: 3, x: 7, y: 2, alive: true },
          { id: 4, x: 10, y: 2, alive: true },
          { id: 5, x: 11, y: 2, alive: true }
        ],
        jailedPieces: []
      }
    },
    flags: {
      A: { x: 9, y: 10, carriedBy: null }, // Blue flag - carried by Red piece 1
      B: { x: 9, y: 0, carriedBy: { player: 'B', pieceId: 1 } } // Red flag at home
    },
    rescueKeys: {
      A: null,
      B: null
    },
    currentRound: 10,
    noGuardZoneActive: {
      A: false,
      B: false
    },
    noGuardZoneBounds: {
      A: { minX: 7, maxX: 11, minY: 9, maxY: 10 },
      B: { minX: 7, maxX: 11, minY: 0, maxY: 1 }
    }
  };
}

test('Red piece carrying Blue flag should NOT move through Blue blocker to score', () => {
  const gameState = createBlockerScenario();
  const commandProcessor = new CommandProcessor();
  const collisionDetector = new CollisionDetector();
  const flagManager = new FlagManager();

  // Initial setup: Red P1 has Blue flag at (9, 2)
  gameState.flags.A.carriedBy = { player: 'B', pieceId: 1 };
  gameState.flags.A.x = 9;
  gameState.flags.A.y = 2;

  console.log('\n🧪 TEST: Move through blocker to score');
  console.log('Initial state:');
  console.log('  Red P1 at (9, 2) carrying Blue flag');
  console.log('  Blue P3 at (9, 1) blocking the path');
  console.log('  Red P1 trying to move DOWN 2 to score at (9, 0)');
  console.log('  Expected: Collision at (9, 1) when Red P1 meets Blue P3');

  // Red P1 tries to move DOWN 2 to score (must pass through Blue P3 at (9,1))
  const commands = {
    playerA: [], // Blue stays still
    playerB: [{ pieceId: 1, direction: 'down' as const, distance: 2 }] // Red P1 moves down 2
  };

  // Execute movements
  const paths = commandProcessor.executeMovements(gameState, commands);

  console.log('\nPaths generated:');
  paths.forEach(p => {
    console.log(`  ${p.player} P${p.pieceId}: path =`, p.path.map(pos => `(${pos.x},${pos.y})`).join(' -> '));
  });

  // Detect collisions
  const collisions = collisionDetector.detectCollisions(paths);

  console.log(`\nCollisions detected: ${collisions.length}`);
  collisions.forEach(c => {
    console.log(`  ${c.player} P${c.pieceId} at (${c.x}, ${c.y})`);
  });

  // Apply final positions
  commandProcessor.applyFinalPositions(gameState, paths);

  // Resolve collisions
  collisionDetector.resolveCollisions(
    gameState,
    collisions,
    (gs, player, pieceId) => flagManager.onPieceCaptured(gs, player, pieceId)
  );

  console.log('\nFinal positions:');
  console.log(`  Red P1: (${gameState.players.B.pieces[0].x}, ${gameState.players.B.pieces[0].y}), alive: ${gameState.players.B.pieces[0].alive}`);
  console.log(`  Blue P3: (${gameState.players.A.pieces[2].x}, ${gameState.players.A.pieces[2].y}), alive: ${gameState.players.A.pieces[2].alive}`);

  // ASSERTIONS
  // Expected behavior: Collision occurs and the path is truncated at the blocker,
  // so Red P1 never reaches the scoring square. Territory-based tagging
  // (docs/game-rules.md) applies at the collision point (9,1), which is inside
  // Red's own territory: Red stays safe (defending at home), Blue P3 (the
  // invader camped in Red territory) is jailed.
  // Note: CollisionDetector adds BOTH pieces to the collision list, so we expect 2 entries
  assert.strictEqual(collisions.length, 2, 'Should detect 2 collision entries (one for each piece)');

  const redP1 = gameState.players.B.pieces[0];
  const blueP3 = gameState.players.A.pieces[2];

  assert.strictEqual(redP1.alive, true, 'Red P1 should stay safe (defending in own territory)');
  assert.strictEqual(blueP3.alive, false, 'Blue P3 should be jailed (invading Red territory)');

  // Red P1 should be stopped at collision point (9, 1), NOT at scoring position (9, 0)
  assert.strictEqual(redP1.x, 9, 'Red P1 should be at collision point x=9');
  assert.strictEqual(redP1.y, 1, 'Red P1 should be stopped at collision point y=1, NOT at flag y=0');

  console.log('\n✅ TEST PASSED: Red P1 was correctly blocked before reaching the scoring square');
});

test('Same scenario but Red P1 moves around blocker (should succeed)', () => {
  const gameState = createBlockerScenario();
  const commandProcessor = new CommandProcessor();
  const collisionDetector = new CollisionDetector();

  // Red P1 has Blue flag at (9, 2)
  gameState.flags.A.carriedBy = { player: 'B', pieceId: 1 };
  gameState.flags.A.x = 9;
  gameState.flags.A.y = 2;

  console.log('\n🧪 TEST: Move around blocker to score');
  console.log('Initial: Red P1 at (9, 2) carrying Blue flag');
  console.log('Red P1 moving LEFT 1 to (8, 2) - no collision (avoiding Blue P3 at 9,1)');

  // Red P1 moves LEFT (away from blocker)
  const commands = {
    playerA: [], // Blue stays still
    playerB: [{ pieceId: 1, direction: 'left' as const, distance: 1 }]
  };

  const paths = commandProcessor.executeMovements(gameState, commands);
  const collisions = collisionDetector.detectCollisions(paths);

  commandProcessor.applyFinalPositions(gameState, paths);

  // Friendly fire collision detected but should be ignored by resolution logic
  // Red P1 moves to (8,2) where Red P2 already is - same team collision
  console.log(`Detected ${collisions.length} collisions (friendly fire between Red P1 and Red P2)`);
  // assert.strictEqual(collisions.length, 0, 'Should detect no collisions when moving around blocker');

  const redP1 = gameState.players.B.pieces[0];
  assert.strictEqual(redP1.x, 8, 'Red P1 should move to x=8');
  assert.strictEqual(redP1.y, 2, 'Red P1 should stay at y=2');
  assert.strictEqual(redP1.alive, true, 'Red P1 should still be alive');

  console.log('✅ TEST PASSED: Red P1 successfully moved around blocker');
});
