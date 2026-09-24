/**
 * GameEngine - Flag Carrier Escape Test
 *
 * SCENARIO: Red piece carrying Blue flag tries to escape back to Red territory
 * Blue defender is blocking the path - should result in capture
 *
 * Board state:
 * - Red P1 at (5,10) - carrying Blue flag (on Blue's back wall)
 * - Blue P1 at (5,8) - defending, blocking the path
 * - Red P1 moves DOWN (toward own side) - should collide with Blue P1 at (5,8)
 *
 * EXPECTED: Red P1 gets captured (tagged in Blue territory), Blue flag is dropped
 * BUG: Red P1 might be escaping without collision detection
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from './GameEngine.js';
import { CommandProcessor } from './CommandProcessor.js';
import { CollisionDetector } from './CollisionDetector.js';
import { FlagManager } from './FlagManager.js';
import { FLAG_POSITIONS } from './constants.js';
import type { CommanderGameState, Movement } from './types.js';

function createFlagCarrierEscapeScenario(): CommanderGameState {
  return {
    round: 5, // Mid-game
    players: {
      A: {
        id: 'player-a',
        player: { id: 'player-a', side: 'A', type: 'local-a' },
        pieces: [
          { id: 1, x: 5, y: 8, alive: true }, // Blue P1 - defender at (5,8)
          { id: 2, x: 5, y: 9, alive: true }, // Blue P2 - elsewhere
          { id: 3, x: 6, y: 9, alive: true }  // Blue P3 - elsewhere
        ],
        jailedPieces: []
      },
      B: {
        id: 'player-b',
        player: { id: 'player-b', side: 'B', type: 'ai' },
        pieces: [
          { id: 1, x: 5, y: 10, alive: true }, // Red P1 - on Blue back wall, carrying flag
          { id: 2, x: 4, y: 2, alive: true },  // Red P2 - elsewhere
          { id: 3, x: 6, y: 2, alive: true }   // Red P3 - elsewhere
        ],
        jailedPieces: []
      }
    },
    commandQueue: {},
    rescueKeys: { A: null, B: null },
    flags: {
      A: {
        x: 5,
        y: 10,
        carriedBy: { player: 'B', pieceId: 1 } // Red P1 carrying Blue flag!
      },
      B: {
        x: 5,
        y: 0,
        carriedBy: null
      }
    },
    noGuardZoneActive: { A: false, B: true }, // Blue zone inactive (flag captured)
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

test('Flag carrier escape - Red carrying flag collides with Blue defender', () => {
  console.log('\n🚩 FLAG CARRIER ESCAPE TEST');
  console.log('   Red P1 at (5,10) carrying Blue flag');
  console.log('   Blue P1 at (5,8) blocking the path');
  console.log('   Red P1 tries to escape DOWN toward own side');

  const gameState = createFlagCarrierEscapeScenario();
  const gameEngine = new GameEngine();

  console.log('\n📍 Initial state:');
  console.log(`   Red P1: (${gameState.players.B.pieces[0].x},${gameState.players.B.pieces[0].y}) alive=${gameState.players.B.pieces[0].alive}, carrying flag=${gameState.flags.A.carriedBy?.player === 'B'}`);
  console.log(`   Blue P1: (${gameState.players.A.pieces[0].x},${gameState.players.A.pieces[0].y}) alive=${gameState.players.A.pieces[0].alive}`);

  // Red P1 moves DOWN 2 (trying to escape from y=10 toward y=8, y=6, etc.)
  const redMove: Movement = { pieceId: 1, direction: 'down', distance: 5 };

  // Blue P1 stays still (defending)
  const blueMove: Movement = { pieceId: 1, direction: 'up', distance: 0 };

  const commands = {
    playerA: [blueMove], // Blue stays still
    playerB: [redMove]   // Red tries to escape
  };

  console.log(`\n🎯 Commands:`);
  console.log(`   Blue P1: ${blueMove.direction} ${blueMove.distance} (staying still)`);
  console.log(`   Red P1: ${redMove.direction} ${redMove.distance} (escape attempt)`);

  // Execute round
  gameEngine.executeRound(gameState, commands);

  console.log(`\n📍 Final state:`);
  console.log(`   Red P1: (${gameState.players.B.pieces[0].x},${gameState.players.B.pieces[0].y}) alive=${gameState.players.B.pieces[0].alive}`);
  console.log(`   Blue P1: (${gameState.players.A.pieces[0].x},${gameState.players.A.pieces[0].y}) alive=${gameState.players.A.pieces[0].alive}`);
  console.log(`   Blue flag carried by: ${gameState.flags.A.carriedBy ? gameState.flags.A.carriedBy.player + ' P' + gameState.flags.A.carriedBy.pieceId : 'none'}`);
  console.log(`   Blue flag position: (${gameState.flags.A.x},${gameState.flags.A.y})`);

  // ASSERTIONS

  // Red P1 should be captured (tagged in Blue territory at y=8)
  assert.strictEqual(
    gameState.players.B.pieces[0].alive,
    false,
    'Red P1 should be captured when colliding with Blue defender in Blue territory'
  );

  // Blue flag should be dropped
  assert.strictEqual(
    gameState.flags.A.carriedBy,
    null,
    'Blue flag should be dropped when Red P1 is captured'
  );

  // Flag returns to spawn when the carrier is captured (docs/game-rules.md "Flag Return"),
  // not to the collision point.
  assert.strictEqual(
    gameState.flags.A.x,
    FLAG_POSITIONS.A.x,
    'Flag should return to spawn x'
  );

  assert.strictEqual(
    gameState.flags.A.y,
    FLAG_POSITIONS.A.y,
    'Flag should return to spawn y'
  );

  console.log('\n✅ PASS: Flag carrier correctly captured while trying to escape');
});

test('Flag carrier escape - Verify collision occurs when paths cross', () => {
  console.log('\n🚩 FLAG CARRIER PATH COLLISION TEST');
  console.log('   Testing that Red P1 path intersects with Blue P1 position');

  const gameState = createFlagCarrierEscapeScenario();

  // Use CommandProcessor to see the actual path
  const processor = new CommandProcessor();
  const collisionDetector = new CollisionDetector();

  const redMove: Movement = { pieceId: 1, direction: 'down', distance: 5 };
  const blueMove: Movement = { pieceId: 1, direction: 'up', distance: 0 };

  const commands = {
    playerA: [blueMove],
    playerB: [redMove]
  };

  console.log('\n🛤️  Calculating paths...');
  const paths = processor.executeMovements(gameState, commands);

  console.log('\n📊 Paths generated:');
  paths.forEach(p => {
    console.log(`   ${p.player} P${p.pieceId}: ${p.path.map(pos => `(${pos.x},${pos.y})`).join(' → ')}`);
  });

  const collisions = collisionDetector.detectCollisions(paths);

  console.log(`\n⚔️  Collisions detected: ${collisions.length}`);
  if (collisions.length > 0) {
    collisions.forEach((c, i) => {
      console.log(`   [${i}] ${c.player} P${c.pieceId} at (${c.x},${c.y})`);
    });
  }

  // ASSERTIONS

  // Should detect collision
  assert.ok(
    collisions.length > 0,
    'Should detect collision between Red P1 path and Blue P1 position'
  );

  // Red P1 should be in collision
  const redCollision = collisions.find(c => c.player === 'B' && c.pieceId === 1);
  assert.ok(
    redCollision,
    'Red P1 should be marked in collision'
  );

  // Blue P1 should be in collision
  const blueCollision = collisions.find(c => c.player === 'A' && c.pieceId === 1);
  assert.ok(
    blueCollision,
    'Blue P1 should be marked in collision'
  );

  // Collision should occur at Blue P1's position (5,8)
  assert.strictEqual(
    redCollision?.x,
    5,
    'Collision should occur at x=5'
  );

  assert.strictEqual(
    redCollision?.y,
    8,
    'Collision should occur at y=8 (where Blue P1 is defending)'
  );

  console.log('\n✅ PASS: Collision correctly detected at defender position');
});

test('Flag carrier escape - Different scenario: Red moves DOWN 3 (partial escape)', () => {
  console.log('\n🚩 FLAG CARRIER PARTIAL ESCAPE TEST');
  console.log('   Red P1 at (5,10) tries to move DOWN 3 (would reach y=7)');
  console.log('   Blue P1 at (5,8) - path crosses at step 2');

  const gameState = createFlagCarrierEscapeScenario();
  const gameEngine = new GameEngine();

  // Red P1 moves DOWN 3 (from y=10 to y=7, passing through y=9, y=8)
  const redMove: Movement = { pieceId: 1, direction: 'down', distance: 3 };
  const blueMove: Movement = { pieceId: 1, direction: 'up', distance: 0 };

  const commands = {
    playerA: [blueMove],
    playerB: [redMove]
  };

  console.log(`\n🎯 Red P1 path: (5,10) → (5,9) → (5,8) → (5,7)`);
  console.log(`   Blue P1 at: (5,8) - should collide at step 2`);

  gameEngine.executeRound(gameState, commands);

  console.log(`\n📍 Results:`);
  console.log(`   Red P1 alive: ${gameState.players.B.pieces[0].alive}`);
  console.log(`   Flag carrier: ${gameState.flags.A.carriedBy ? 'Red P' + gameState.flags.A.carriedBy.pieceId : 'none'}`);

  // Red should be captured
  assert.strictEqual(
    gameState.players.B.pieces[0].alive,
    false,
    'Red P1 should be captured when path crosses Blue defender'
  );

  // Flag should be dropped
  assert.strictEqual(
    gameState.flags.A.carriedBy,
    null,
    'Flag should be dropped when carrier is captured'
  );

  console.log('\n✅ PASS: Partial escape attempt correctly intercepted');
});

console.log('\n✅ Flag carrier escape tests defined\n');
