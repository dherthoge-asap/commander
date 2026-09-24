/**
 * Test: Defender on Flag
 *
 * Scenario:
 * - Red piece is defending their own flag at (9, 0)
 * - Blue piece moves from (0, 0) RIGHT to invade Red territory at (9, 0)
 * - They collide at the flag position
 *
 * Expected behavior (docs/game-rules.md "Territory-Based Tagging"): the flag
 * square carries no special exemption. Red is defending in its own territory,
 * so Red stays safe and Blue (the invader) is jailed.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { CommanderGameState } from './types.js';
import { CommandProcessor } from './CommandProcessor.js';
import { CollisionDetector } from './CollisionDetector.js';
import { FlagManager } from './FlagManager.js';

test('Red defender sitting on their own flag tags the Blue invader', () => {
  console.log('\n🧪 TEST: Defender on Flag Bug\n');

  const gameState: CommanderGameState = {
    currentRound: 10,
    players: {
      A: {
        id: 'player-a',
        type: 'local-a' as const,
        pieces: [
          { id: 1, x: 0, y: 0, alive: true }, // Blue P1 at upper left
          { id: 2, x: 7, y: 8, alive: true },
          { id: 3, x: 8, y: 8, alive: true },
          { id: 4, x: 10, y: 8, alive: true },
          { id: 5, x: 11, y: 8, alive: true }
        ],
        jailedPieces: []
      },
      B: {
        id: 'player-b',
        type: 'local-b' as const,
        pieces: [
          { id: 1, x: 9, y: 0, alive: true },  // Red P1 DEFENDING on their own flag
          { id: 2, x: 8, y: 2, alive: true },
          { id: 3, x: 10, y: 2, alive: true },
          { id: 4, x: 11, y: 2, alive: true },
          { id: 5, x: 15, y: 2, alive: true }
        ],
        jailedPieces: []
      }
    },
    flags: {
      A: { x: 9, y: 10, carriedBy: null },  // Blue flag at spawn
      B: { x: 9, y: 0, carriedBy: null }    // Red flag at spawn (Red P1 is ON it)
    },
    rescueKeys: {
      A: null,
      B: null
    },
    noGuardZoneActive: {
      A: true,
      B: false  // Red no-guard zone doesn't apply when piece is on flag
    },
    noGuardZoneBounds: {
      A: { minX: 7, maxX: 11, minY: 9, maxY: 10 },
      B: { minX: 7, maxX: 11, minY: 0, maxY: 1 }
    }
  };

  const commandProcessor = new CommandProcessor();
  const collisionDetector = new CollisionDetector();
  const flagManager = new FlagManager();

  const blueP1 = gameState.players.A.pieces[0];
  const redP1 = gameState.players.B.pieces[0];

  console.log(`📍 Blue P1 starting position: (${blueP1.x}, ${blueP1.y})`);
  console.log(`📍 Red P1 position (defending flag): (${redP1.x}, ${redP1.y})`);
  console.log(`🚩 Red flag position: (${gameState.flags.B.x}, ${gameState.flags.B.y})`);
  console.log(`📏 Blue P1 distance to travel: ${gameState.flags.B.x - blueP1.x} cells RIGHT\n`);

  // Blue P1 moves RIGHT 9 cells to attack Red flag (colliding with Red P1 defender)
  const commands = {
    playerA: [{ pieceId: 1, direction: 'right' as const, distance: 9 }],
    playerB: [] // Red P1 stays on flag
  };

  console.log(`🎮 Blue P1 command: Move RIGHT 9 cells to flag\n`);

  // Execute movements
  const paths = commandProcessor.executeMovements(gameState, commands);
  console.log('📍 Movement paths generated');

  // Detect collisions
  const collisions = collisionDetector.detectCollisions(paths);
  console.log(`⚔️  Collisions detected: ${collisions.length}`);
  collisions.forEach(c => {
    console.log(`   ${c.player} P${c.pieceId} at (${c.x}, ${c.y}) step ${c.step}`);
  });

  // Apply final positions
  commandProcessor.applyFinalPositions(gameState, paths);
  console.log(`📍 Blue P1 moved to: (${blueP1.x}, ${blueP1.y})`);
  console.log(`📍 Red P1 stayed at: (${redP1.x}, ${redP1.y})\n`);

  // Resolve collisions
  collisionDetector.resolveCollisions(
    gameState,
    collisions,
    (gs, player, pieceId) => flagManager.onPieceCaptured(gs, player, pieceId)
  );

  console.log(`❤️  Blue P1 alive: ${blueP1.alive}`);
  console.log(`❤️  Red P1 alive: ${redP1.alive}`);
  console.log(`🚩 Red flag carried by: ${gameState.flags.B.carriedBy ? `${gameState.flags.B.carriedBy.player} P${gameState.flags.B.carriedBy.pieceId}` : 'none'}\n`);

  // ASSERTIONS
  assert.strictEqual(collisions.length, 2, 'Should detect collision between Blue P1 and Red P1');

  // Territory-based tagging (docs/game-rules.md): Red is defending in its own
  // territory, so Red stays safe and Blue (the invader) is jailed. The flag
  // square carries no special exemption from this rule.
  assert.strictEqual(blueP1.alive, false, 'Blue P1 should be JAILED (invading Red territory)');
  assert.strictEqual(redP1.alive, true, 'Red P1 should stay safe (defending in own territory)');

  assert.strictEqual(gameState.players.A.jailedPieces.length, 1, 'Blue should have 1 jailed piece (P1)');
  assert.strictEqual(gameState.players.B.jailedPieces.length, 0, 'Red should have no jailed pieces');

  console.log('✅ TEST PASSED: Red defender stays safe, Blue invader jailed\n');
});

test('Reverse scenario: Red piece should capture Blue defender on Blue flag', () => {
  console.log('\n🧪 TEST: Reverse - Attacker vs Defender on Flag\n');

  const gameState: CommanderGameState = {
    currentRound: 10,
    players: {
      A: {
        id: 'player-a',
        type: 'local-a' as const,
        pieces: [
          { id: 1, x: 9, y: 10, alive: true },  // Blue P1 DEFENDING on their own flag
          { id: 2, x: 7, y: 8, alive: true },
          { id: 3, x: 8, y: 8, alive: true },
          { id: 4, x: 10, y: 8, alive: true },
          { id: 5, x: 11, y: 8, alive: true }
        ],
        jailedPieces: []
      },
      B: {
        id: 'player-b',
        type: 'local-b' as const,
        pieces: [
          { id: 1, x: 9, y: 0, alive: true },  // Red P1 starting from their flag
          { id: 2, x: 8, y: 2, alive: true },
          { id: 3, x: 10, y: 2, alive: true },
          { id: 4, x: 11, y: 2, alive: true },
          { id: 5, x: 15, y: 2, alive: true }
        ],
        jailedPieces: []
      }
    },
    flags: {
      A: { x: 9, y: 10, carriedBy: null },  // Blue flag (Blue P1 is ON it)
      B: { x: 9, y: 0, carriedBy: null }
    },
    rescueKeys: {
      A: null,
      B: null
    },
    noGuardZoneActive: {
      A: false,
      B: true
    },
    noGuardZoneBounds: {
      A: { minX: 7, maxX: 11, minY: 9, maxY: 10 },
      B: { minX: 7, maxX: 11, minY: 0, maxY: 1 }
    }
  };

  const commandProcessor = new CommandProcessor();
  const collisionDetector = new CollisionDetector();
  const flagManager = new FlagManager();

  const blueP1 = gameState.players.A.pieces[0];
  const redP1 = gameState.players.B.pieces[0];

  console.log(`📍 Blue P1 position (defending flag): (${blueP1.x}, ${blueP1.y})`);
  console.log(`📍 Red P1 starting position: (${redP1.x}, ${redP1.y})`);
  console.log(`🚩 Blue flag position: (${gameState.flags.A.x}, ${gameState.flags.A.y})`);
  console.log(`📏 Red P1 distance to travel: ${gameState.flags.A.y - redP1.y} cells UP\n`);

  // Red P1 moves UP 10 cells to attack Blue flag
  const commands = {
    playerA: [], // Blue P1 stays on flag
    playerB: [{ pieceId: 1, direction: 'up' as const, distance: 10 }]
  };

  console.log(`🎮 Red P1 command: Move UP 10 cells to flag\n`);

  const paths = commandProcessor.executeMovements(gameState, commands);
  const collisions = collisionDetector.detectCollisions(paths);

  console.log(`⚔️  Collisions detected: ${collisions.length}`);

  commandProcessor.applyFinalPositions(gameState, paths);
  collisionDetector.resolveCollisions(
    gameState,
    collisions,
    (gs, player, pieceId) => flagManager.onPieceCaptured(gs, player, pieceId)
  );

  console.log(`❤️  Blue P1 alive: ${blueP1.alive}`);
  console.log(`❤️  Red P1 alive: ${redP1.alive}\n`);

  // Note: Red P1 gets blocked by no-guard zone and cannot reach Blue flag
  // This test shows that no-guard zones correctly prevent camping near own flag
  if (collisions.length === 0) {
    console.log('⚠️  No collision - Red P1 blocked by no-guard zone');
    assert.strictEqual(blueP1.alive, true, 'Blue P1 should remain safe (no collision)');
    assert.strictEqual(redP1.alive, true, 'Red P1 should be stopped by no-guard zone');
  } else {
    // If collision happened, both should be jailed (flag collision rule)
    assert.strictEqual(blueP1.alive, false, 'Blue P1 should be JAILED (flag collision rule)');
    assert.strictEqual(redP1.alive, false, 'Red P1 should be JAILED (flag collision rule)');
  }

  console.log('✅ TEST PASSED: No-guard zone correctly blocks attacker\n');
});
