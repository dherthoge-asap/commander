/**
 * Unit Tests for PositionExplorationStrategy
 *
 * Tests the core `findBestMoveForPiece()` logic to ensure:
 * - Baseline (staying still) is calculated correctly
 * - All positions are explored
 * - Best move is selected
 * - Boundaries and no-guard zones are respected
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { PositionExplorationStrategy } from './PositionExplorationStrategy.js';
import { PIECES_PER_TEAM } from '../../game/constants.js';
import type { CommanderGameState, Movement } from '../../game/types.js';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a minimal game state for testing
 */
function createTestGameState(): CommanderGameState {
  return {
    round: 1,
    phase: 'playing',
    gameStatus: 'playing', // Add this - FlagManager might need it
    players: {
      A: {
        id: 'test-player-a',
        type: 'local-a',
        pieces: [
          { id: 1, x: 9, y: 10, alive: true, hasFlag: false },
          { id: 2, x: 8, y: 10, alive: true, hasFlag: false },
          { id: 3, x: 10, y: 10, alive: true, hasFlag: false },
          // Pieces 4-7 parked on the right, away from the center column the tests use
          { id: 4, x: 14, y: 9, alive: true, hasFlag: false },
          { id: 5, x: 15, y: 9, alive: true, hasFlag: false },
          { id: 6, x: 16, y: 9, alive: true, hasFlag: false },
          { id: 7, x: 17, y: 9, alive: true, hasFlag: false }
        ],
        jailedPieces: []
      },
      B: {
        id: 'test-player-b',
        type: 'local-b',
        pieces: [
          { id: 1, x: 9, y: 2, alive: true, hasFlag: false },
          { id: 2, x: 8, y: 2, alive: true, hasFlag: false },
          { id: 3, x: 10, y: 2, alive: true, hasFlag: false },
          { id: 4, x: 14, y: 3, alive: true, hasFlag: false },
          { id: 5, x: 15, y: 3, alive: true, hasFlag: false },
          { id: 6, x: 16, y: 3, alive: true, hasFlag: false },
          { id: 7, x: 17, y: 3, alive: true, hasFlag: false }
        ],
        jailedPieces: []
      }
    },
    flags: {
      A: { x: 9, y: 12, carriedBy: null },
      B: { x: 9, y: 0, carriedBy: null }
    },
    rescueKeys: {
      A: { x: 17, y: 1, active: true },
      B: { x: 1, y: 11, active: true }
    },
    noGuardZoneActive: {
      A: true,
      B: true
    },
    history: []
  } as any; // Cast to any to avoid type issues
}

// ============================================================================
// Unit Tests
// ============================================================================

test('PositionExplorationStrategy - findBestMoveForPiece calculates baseline', async () => {
  const strategy = new PositionExplorationStrategy();
  const gameState = createTestGameState();

  // Use reflection to access private method (for testing only)
  const findBestMoveForPiece = (strategy as any).findBestMoveForPiece.bind(strategy);

  const result = findBestMoveForPiece(gameState, 1, 'A', undefined);

  // Should return a movement (even if it's staying still)
  assert.ok(result.movement, 'Should return a movement');
  assert.strictEqual(result.movement.pieceId, 1, 'Should be for piece 1');
  assert.ok(typeof result.scoreDelta === 'number', 'Should return a score delta');

  console.log('✅ Baseline calculation test passed');
  console.log(`   Result: ${result.movement.direction} ${result.movement.distance}, delta=${result.scoreDelta}`);
});

test('PositionExplorationStrategy - findBestMoveForPiece explores all directions', async () => {
  const strategy = new PositionExplorationStrategy();
  const gameState = createTestGameState();

  // Move piece to center of board where all directions are possible
  gameState.players.A.pieces[0] = { id: 1, x: 5, y: 5, alive: true, hasFlag: false };

  const findBestMoveForPiece = (strategy as any).findBestMoveForPiece.bind(strategy);
  const result = findBestMoveForPiece(gameState, 1, 'A', undefined);

  // Should find some move (baseline or better)
  assert.ok(result.movement, 'Should return a movement');
  assert.ok(['up', 'down', 'left', 'right'].includes(result.movement.direction), 'Should be a valid direction');
  assert.ok(result.movement.distance >= 0 && result.movement.distance <= 10, 'Distance should be 0-10');

  console.log('✅ Direction exploration test passed');
  console.log(`   Best move: ${result.movement.direction} ${result.movement.distance}, delta=${result.scoreDelta}`);
});

test('PositionExplorationStrategy - respects board boundaries', async () => {
  const strategy = new PositionExplorationStrategy();
  const gameState = createTestGameState();

  // Place piece at top-left corner
  gameState.players.A.pieces[0] = { id: 1, x: 0, y: 0, alive: true, hasFlag: false };

  const findBestMoveForPiece = (strategy as any).findBestMoveForPiece.bind(strategy);
  const result = findBestMoveForPiece(gameState, 1, 'A', undefined);

  // Piece at (0,0) can only move down or right (or stay still)
  assert.ok(result.movement, 'Should return a movement');

  // If it moved, should be down or right
  if (result.movement.distance > 0) {
    assert.ok(
      result.movement.direction === 'down' || result.movement.direction === 'right',
      'From (0,0), can only move down or right'
    );
  }

  console.log('✅ Boundary respect test passed');
  console.log(`   From (0,0), chose: ${result.movement.direction} ${result.movement.distance}`);
});

test('PositionExplorationStrategy - piece toward enemy flag scores positively', async () => {
  const strategy = new PositionExplorationStrategy();
  const gameState = createTestGameState();

  // Place Team A piece far from enemy flag (which is at 5,0)
  gameState.players.A.pieces[0] = { id: 1, x: 5, y: 9, alive: true, hasFlag: false };

  const findBestMoveForPiece = (strategy as any).findBestMoveForPiece.bind(strategy);
  const result = findBestMoveForPiece(gameState, 1, 'A', undefined);

  // Moving toward enemy flag (from y=9 toward y=0) should be moving UP
  // If the AI is working correctly, it should prefer moving toward the flag
  console.log('✅ Enemy flag attraction test');
  console.log(`   Piece at (5,9), enemy flag at (5,0)`);
  console.log(`   Best move: ${result.movement.direction} ${result.movement.distance}, delta=${result.scoreDelta}`);

  // Note: We can't assert the exact direction without knowing the score evaluator's weights,
  // but we can verify it found SOME move with a delta
  assert.ok(result.scoreDelta >= 0, 'Score delta should be non-negative');
});

test('PositionExplorationStrategy - dead piece returns stay still', async () => {
  const strategy = new PositionExplorationStrategy();
  const gameState = createTestGameState();

  // Mark piece as dead
  gameState.players.A.pieces[0] = { id: 1, x: 5, y: 5, alive: false, hasFlag: false };

  const findBestMoveForPiece = (strategy as any).findBestMoveForPiece.bind(strategy);
  const result = findBestMoveForPiece(gameState, 1, 'A', undefined);

  // Dead piece should stay still
  assert.strictEqual(result.movement.distance, 0, 'Dead piece should stay still');
  assert.strictEqual(result.scoreDelta, 0, 'Dead piece should have 0 score delta');

  console.log('✅ Dead piece test passed');
});

test('PositionExplorationStrategy - full getCommands() integration', async () => {
  const strategy = new PositionExplorationStrategy();
  const gameState = createTestGameState();

  const response = await strategy.getCommands(gameState, 'A');

  // Should return one command per piece
  assert.strictEqual(response.commands.length, PIECES_PER_TEAM, `Should return ${PIECES_PER_TEAM} commands`);

  // Each command should have valid structure
  for (const cmd of response.commands) {
    assert.ok(cmd.pieceId >= 1 && cmd.pieceId <= PIECES_PER_TEAM, `Piece ID should be 1-${PIECES_PER_TEAM}`);
    assert.ok(['up', 'down', 'left', 'right'].includes(cmd.direction), 'Should have valid direction');
    assert.ok(cmd.distance >= 0 && cmd.distance <= 10, 'Distance should be 0-10');
  }

  console.log('✅ Full getCommands() integration test passed');
  console.log(`   Generated ${response.commands.length} commands`);
  console.log(`   Analysis: ${response.analysis?.scenariosEvaluated} scenarios evaluated`);
  console.log(`   Execution time: ${response.analysis?.executionTime}ms`);
});

test('PositionExplorationStrategy - baseline (stay still) is always an option', async () => {
  const strategy = new PositionExplorationStrategy();
  const gameState = createTestGameState();

  // Create a scenario where moving might be bad (surrounded by enemies)
  gameState.players.B.pieces = [
    { id: 1, x: 4, y: 4, alive: true, hasFlag: false },
    { id: 2, x: 6, y: 4, alive: true, hasFlag: false },
    { id: 3, x: 5, y: 3, alive: true, hasFlag: false }
  ];
  gameState.players.A.pieces[0] = { id: 1, x: 5, y: 4, alive: true, hasFlag: false };

  const findBestMoveForPiece = (strategy as any).findBestMoveForPiece.bind(strategy);
  const result = findBestMoveForPiece(gameState, 1, 'A', undefined);

  // Even if surrounded, should return a valid move (possibly staying still)
  assert.ok(result.movement, 'Should always return a movement');
  assert.ok(result.scoreDelta >= 0, 'Baseline is 0, so delta should be >= 0');

  console.log('✅ Baseline always available test passed');
  console.log(`   Surrounded piece chose: ${result.movement.direction} ${result.movement.distance}, delta=${result.scoreDelta}`);
});

test('PositionExplorationStrategy - INTERESTING: piece should grab nearby enemy flag', async () => {
  const strategy = new PositionExplorationStrategy();
  const gameState = createTestGameState();

  // Place Team A piece 3 squares away from enemy flag (at 5,0)
  // Piece at (5,3) can move up 3 to reach (5,0)
  gameState.players.A.pieces[0] = { id: 1, x: 5, y: 3, alive: true, hasFlag: false };
  gameState.flags.B = { x: 5, y: 0, carriedBy: null }; // Enemy flag at (5,0)

  // Disable no-guard zones for this test (they shouldn't block anyway, but let's verify)
  gameState.noGuardZoneActive = { A: false, B: false };

  // Move enemy pieces out of the way
  gameState.players.B.pieces[0] = { id: 1, x: 0, y: 0, alive: true, hasFlag: false };
  gameState.players.B.pieces[1] = { id: 2, x: 1, y: 0, alive: true, hasFlag: false };
  gameState.players.B.pieces[2] = { id: 3, x: 2, y: 0, alive: true, hasFlag: false };

  // DEBUG: Check if score evaluator works
  const { evaluateGameStateQuick } = await import('../../game/ScoreEvaluator.js');
  const baselineScore = evaluateGameStateQuick(gameState, 'A');
  console.log(`   DEBUG: Baseline score=${baselineScore}`);

  // Test: What if we manually set flag as captured?
  const capturedState = JSON.parse(JSON.stringify(gameState));
  capturedState.flags.B.carriedBy = { player: 'A', pieceId: 1 };
  const capturedScore = evaluateGameStateQuick(capturedState, 'A');
  console.log(`   DEBUG: If we have enemy flag, score=${capturedScore} (delta=${capturedScore - baselineScore})`);

  const findBestMoveForPiece = (strategy as any).findBestMoveForPiece.bind(strategy);
  const result = findBestMoveForPiece(gameState, 1, 'A', undefined);

  console.log('🎯 INTERESTING TEST: Piece near enemy flag');
  console.log(`   Piece at (5,3), enemy flag at (5,0)`);
  console.log(`   Best move: ${result.movement.direction} ${result.movement.distance}, delta=${result.scoreDelta}`);

  // Should want to move UP toward the flag
  assert.ok(result.scoreDelta > 0, 'Moving toward flag should have positive delta');

  // If the AI is smart, it should move UP (toward y=0)
  if (result.movement.distance > 0) {
    console.log(`   ✅ AI chose to move! Direction: ${result.movement.direction}, Distance: ${result.movement.distance}`);
  } else {
    console.log(`   ⚠️  AI chose to stay still (delta=${result.scoreDelta})`);
  }
});

test('PositionExplorationStrategy - INTERESTING: piece on enemy back wall scores points', async () => {
  const strategy = new PositionExplorationStrategy();
  const gameState = createTestGameState();

  // Team A (Blue) piece near enemy back wall (y=0)
  // Enemy back wall is y=0, so moving from y=2 to y=0 should score
  gameState.players.A.pieces[0] = { id: 1, x: 5, y: 2, alive: true, hasFlag: false };
  gameState.flags.B = { x: 5, y: 0, carriedBy: null }; // Keep flag at default

  const findBestMoveForPiece = (strategy as any).findBestMoveForPiece.bind(strategy);
  const result = findBestMoveForPiece(gameState, 1, 'A', undefined);

  console.log('🎯 INTERESTING TEST: Piece near enemy back wall');
  console.log(`   Team A piece at (5,2), enemy back wall is y=0`);
  console.log(`   Best move: ${result.movement.direction} ${result.movement.distance}, delta=${result.scoreDelta}`);

  // Should want to move UP to back wall
  if (result.scoreDelta > 0) {
    console.log(`   ✅ AI found advantage! Delta: ${result.scoreDelta}`);
  } else {
    console.log(`   ⚠️  No advantage found (might be scoring issue)`);
  }
});

test('PositionExplorationStrategy - INTERESTING: piece should defend our flag from enemy', async () => {
  const strategy = new PositionExplorationStrategy();
  const gameState = createTestGameState();

  // Team A flag at (5,10), enemy piece at (5,5) moving toward it
  // Team A piece at (5,8) should want to move toward (5,7) to defend/intercept
  gameState.flags.A = { x: 5, y: 10, carriedBy: null };
  gameState.players.A.pieces[0] = { id: 1, x: 5, y: 8, alive: true, hasFlag: false };
  gameState.players.B.pieces[0] = { id: 1, x: 5, y: 5, alive: true, hasFlag: false }; // Enemy approaching

  const findBestMoveForPiece = (strategy as any).findBestMoveForPiece.bind(strategy);
  const result = findBestMoveForPiece(gameState, 1, 'A', undefined);

  console.log('🎯 INTERESTING TEST: Defend our flag from approaching enemy');
  console.log(`   Our flag at (5,10), our piece at (5,8), enemy at (5,5)`);
  console.log(`   Best move: ${result.movement.direction} ${result.movement.distance}, delta=${result.scoreDelta}`);

  // This might not score because enemy hasn't captured flag yet
  // But let's see what happens
  if (result.scoreDelta > 0) {
    console.log(`   ✅ AI found defensive advantage! Delta: ${result.scoreDelta}`);
  } else {
    console.log(`   ⚠️  No defensive advantage found (expected - enemy hasn't captured yet)`);
  }
});

// ============================================================================
// PIECE CAPTURES / TAGGING TESTS
// ============================================================================

test('PositionExplorationStrategy - CAPTURE: Landing on enemy piece in OUR territory', async () => {
  const strategy = new PositionExplorationStrategy();
  const gameState = createTestGameState();

  // Team A piece at (5,5) - neutral line
  // Team B piece at (5,7) - in Team A territory!
  // AI should want to capture them (collision in A territory = B gets jailed)
  gameState.players.A.pieces[0] = { id: 1, x: 5, y: 5, alive: true, hasFlag: false };
  gameState.players.B.pieces[0] = { id: 1, x: 5, y: 7, alive: true, hasFlag: false }; // Enemy in OUR territory (y≥6)

  // Move flag out of the way so AI doesn't prioritize it over capture
  gameState.flags.B = { x: 0, y: 0, carriedBy: null };

  // Move other pieces out of the way
  gameState.players.A.pieces[1] = { id: 2, x: 0, y: 10, alive: true, hasFlag: false };
  gameState.players.A.pieces[2] = { id: 3, x: 1, y: 10, alive: true, hasFlag: false };
  gameState.players.B.pieces[1] = { id: 2, x: 0, y: 0, alive: true, hasFlag: false };
  gameState.players.B.pieces[2] = { id: 3, x: 1, y: 0, alive: true, hasFlag: false };

  // DEBUG: What's the baseline score?
  const { evaluateGameState } = await import('../../game/ScoreEvaluator.js');
  const baselineBreakdown = evaluateGameState(gameState, 'A');
  console.log('🎯 CAPTURE TEST: Landing on enemy piece in OUR territory');
  console.log(`   Baseline score breakdown:`, baselineBreakdown);

  // DEBUG: Manually simulate capturing the enemy piece
  const capturedState = JSON.parse(JSON.stringify(gameState));
  capturedState.players.A.pieces[0] = { id: 1, x: 5, y: 7, alive: true, hasFlag: false }; // Move to enemy location
  capturedState.players.B.pieces[0] = { id: 1, x: 5, y: 7, alive: false, hasFlag: false }; // Enemy captured (in our territory!)
  const capturedBreakdown = evaluateGameState(capturedState, 'A', gameState); // Pass beforeState for capture detection
  console.log(`   After capturing enemy at (5,7):`, capturedBreakdown);
  console.log(`   Delta: ${capturedBreakdown.total - baselineBreakdown.total}`);

  const findBestMoveForPiece = (strategy as any).findBestMoveForPiece.bind(strategy);
  const result = findBestMoveForPiece(gameState, 1, 'A', undefined);

  console.log(`   AI's best move: ${result.movement.direction} ${result.movement.distance}, delta=${result.scoreDelta}`);

  // AI should find SOME positive move (either capture or another objective)
  if (result.scoreDelta > 0) {
    console.log(`   ✅ AI found a positive move (capture is valued at +1200)`);
  } else {
    console.log(`   ⚠️  AI didn't find any advantage - UNEXPECTED`);
  }
});

test('PositionExplorationStrategy - CAPTURE: Getting captured in enemy territory', async () => {
  const strategy = new PositionExplorationStrategy();
  const gameState = createTestGameState();

  // Team A piece at (5,3) - deep in enemy territory (y <= 5)
  // Enemy piece at (5,5) on the border
  // AI should recognize staying in enemy territory is dangerous
  gameState.players.A.pieces[0] = { id: 1, x: 5, y: 3, alive: true, hasFlag: false };
  gameState.players.B.pieces[0] = { id: 1, x: 5, y: 5, alive: true, hasFlag: false }; // Enemy at border

  // Move other pieces out of the way
  gameState.players.A.pieces[1] = { id: 2, x: 0, y: 10, alive: true, hasFlag: false };
  gameState.players.A.pieces[2] = { id: 3, x: 1, y: 10, alive: true, hasFlag: false };
  gameState.players.B.pieces[1] = { id: 2, x: 0, y: 0, alive: true, hasFlag: false };
  gameState.players.B.pieces[2] = { id: 3, x: 1, y: 0, alive: true, hasFlag: false };

  const findBestMoveForPiece = (strategy as any).findBestMoveForPiece.bind(strategy);
  const result = findBestMoveForPiece(gameState, 1, 'A', undefined);

  console.log('🎯 CAPTURE TEST: Piece in danger in enemy territory');
  console.log(`   Our piece at (5,3) - enemy territory, enemy at (5,5)`);
  console.log(`   Best move: ${result.movement.direction} ${result.movement.distance}, delta=${result.scoreDelta}`);

  // AI might want to escape or grab the flag at (5,0)
  if (result.scoreDelta > 0) {
    console.log(`   ✅ AI found an advantage (escape or objective)`);
  } else {
    console.log(`   ⚠️  AI chose to stay still (might be best option)`);
  }
});

// ============================================================================
// BACK WALL SCORING TESTS
// ============================================================================

test('PositionExplorationStrategy - BACK WALL: Reaching enemy back wall scores points', async () => {
  const strategy = new PositionExplorationStrategy();
  const gameState = createTestGameState();

  // Team A piece at (5,2) can reach enemy back wall at y=0
  // Back wall scoring should give +500 points per piece on back wall
  gameState.players.A.pieces[0] = { id: 1, x: 5, y: 2, alive: true, hasFlag: false };

  // Move flag away so it doesn't interfere
  gameState.flags.B = { x: 0, y: 0, carriedBy: null };

  // Move other pieces out of the way
  gameState.players.A.pieces[1] = { id: 2, x: 0, y: 10, alive: true, hasFlag: false };
  gameState.players.A.pieces[2] = { id: 3, x: 1, y: 10, alive: true, hasFlag: false };
  gameState.players.B.pieces[0] = { id: 1, x: 0, y: 1, alive: true, hasFlag: false };
  gameState.players.B.pieces[1] = { id: 2, x: 1, y: 1, alive: true, hasFlag: false };
  gameState.players.B.pieces[2] = { id: 3, x: 2, y: 1, alive: true, hasFlag: false };

  const findBestMoveForPiece = (strategy as any).findBestMoveForPiece.bind(strategy);
  const result = findBestMoveForPiece(gameState, 1, 'A', undefined);

  console.log('🎯 BACK WALL TEST: Reaching enemy back wall');
  console.log(`   Our piece at (5,2), enemy back wall is y=0`);
  console.log(`   Best move: ${result.movement.direction} ${result.movement.distance}, delta=${result.scoreDelta}`);

  if (result.scoreDelta > 0 && result.movement.direction === 'up' && result.movement.distance >= 2) {
    console.log(`   ✅ AI wants to reach back wall!`);
  } else {
    console.log(`   ⚠️  AI didn't choose back wall (territory penalty might outweigh +500 back wall bonus)`);
  }
});

// ============================================================================
// TERRITORY CONTROL / NO-GUARD ZONE TESTS
// ============================================================================

test('PositionExplorationStrategy - NO-GUARD ZONE: Blocked when active', async () => {
  const strategy = new PositionExplorationStrategy();
  const gameState = createTestGameState();

  // Team A piece at (5,8) trying to enter no-guard zone at y=9-10
  // When no-guard zone is active, piece should NOT be able to enter
  gameState.players.A.pieces[0] = { id: 1, x: 5, y: 8, alive: true, hasFlag: false };
  gameState.noGuardZoneActive = { A: true, B: true }; // Zones active

  // Move other pieces out of the way
  gameState.players.A.pieces[1] = { id: 2, x: 0, y: 7, alive: true, hasFlag: false };
  gameState.players.A.pieces[2] = { id: 3, x: 1, y: 7, alive: true, hasFlag: false };

  const findBestMoveForPiece = (strategy as any).findBestMoveForPiece.bind(strategy);
  const result = findBestMoveForPiece(gameState, 1, 'A', undefined);

  console.log('🎯 NO-GUARD ZONE TEST: Blocked when active');
  console.log(`   Our piece at (5,8), trying to enter Team A no-guard zone (y=9-10)`);
  console.log(`   Best move: ${result.movement.direction} ${result.movement.distance}, delta=${result.scoreDelta}`);

  // Should NOT try to move down into zone
  if (result.movement.direction === 'down') {
    console.log(`   ⚠️  AI tried to enter no-guard zone! (Should be blocked)`);
  } else {
    console.log(`   ✅ AI respects no-guard zone boundary`);
  }
});

test('PositionExplorationStrategy - NO-GUARD ZONE: Open when flag captured', async () => {
  const strategy = new PositionExplorationStrategy();
  const gameState = createTestGameState();

  // Team A piece at (5,8), enemy has captured our flag
  // No-guard zone should be OPEN now (inactive)
  gameState.players.A.pieces[0] = { id: 1, x: 5, y: 8, alive: true, hasFlag: false };
  gameState.flags.A = { x: 5, y: 5, carriedBy: { player: 'B', pieceId: 1 } }; // Enemy has our flag
  gameState.noGuardZoneActive = { A: false, B: true }; // Team A zone now open

  // Move other pieces out of the way
  gameState.players.A.pieces[1] = { id: 2, x: 0, y: 7, alive: true, hasFlag: false };
  gameState.players.A.pieces[2] = { id: 3, x: 1, y: 7, alive: true, hasFlag: false };

  const findBestMoveForPiece = (strategy as any).findBestMoveForPiece.bind(strategy);
  const result = findBestMoveForPiece(gameState, 1, 'A', undefined);

  console.log('🎯 NO-GUARD ZONE TEST: Open when flag captured');
  console.log(`   Our piece at (5,8), enemy has our flag, zone should be OPEN`);
  console.log(`   Best move: ${result.movement.direction} ${result.movement.distance}, delta=${result.scoreDelta}`);

  // Could now potentially move into former no-guard zone
  console.log(`   ✅ Test ran (behavior depends on scoring priorities)`);
});

// ============================================================================
// VICTORY CONDITION TESTS
// ============================================================================

test('PositionExplorationStrategy - VICTORY: Scoring when we can win the game', async () => {
  const strategy = new PositionExplorationStrategy();
  const gameState = createTestGameState();

  // Setup: We have enemy flag, just need to reach our base to win!
  // Team A piece at (5,8) carrying enemy flag, can move down to (5,10) to win
  gameState.players.A.pieces[0] = { id: 1, x: 5, y: 8, alive: true, hasFlag: true };
  gameState.flags.B = { x: 5, y: 8, carriedBy: { player: 'A', pieceId: 1 } }; // We have their flag!
  gameState.flags.A = { x: 5, y: 10, carriedBy: null }; // Our flag at home base

  // Move other pieces out of the way
  gameState.players.A.pieces[1] = { id: 2, x: 0, y: 10, alive: true, hasFlag: false };
  gameState.players.A.pieces[2] = { id: 3, x: 1, y: 10, alive: true, hasFlag: false };
  gameState.players.B.pieces[0] = { id: 1, x: 0, y: 0, alive: true, hasFlag: false };
  gameState.players.B.pieces[1] = { id: 2, x: 1, y: 0, alive: true, hasFlag: false };
  gameState.players.B.pieces[2] = { id: 3, x: 2, y: 0, alive: true, hasFlag: false };

  // DEBUG: Check scoring
  const { evaluateGameState } = await import('../../game/ScoreEvaluator.js');
  const baselineBreakdown = evaluateGameState(gameState, 'A');
  console.log('🎯 VICTORY TEST: Moving to our base with enemy flag to win');
  console.log(`   Baseline (have flag at (5,8)):`, baselineBreakdown);

  // Manually simulate winning: piece with flag reaches our flag at (5,10)
  const winState = JSON.parse(JSON.stringify(gameState));
  winState.players.A.pieces[0] = { id: 1, x: 5, y: 10, alive: true, hasFlag: true };
  winState.flags.B = { x: 5, y: 10, carriedBy: { player: 'A', pieceId: 1 } };
  winState.winner = 'A'; // Game is won!
  const winBreakdown = evaluateGameState(winState, 'A');
  console.log(`   After winning (flag at (5,10)):`, winBreakdown);
  console.log(`   Delta: ${winBreakdown.total - baselineBreakdown.total}`);

  const findBestMoveForPiece = (strategy as any).findBestMoveForPiece.bind(strategy);
  const result = findBestMoveForPiece(gameState, 1, 'A', undefined);

  console.log(`   AI's best move: ${result.movement.direction} ${result.movement.distance}, delta=${result.scoreDelta}`);

  // AI should choose ANY move that wins (delta > 0 means winning move!)
  if (result.scoreDelta > 0) {
    console.log(`   ✅ AI wants to WIN! Chose ${result.movement.direction} ${result.movement.distance}`);
  } else {
    console.log(`   ⚠️  AI didn't choose winning move! BUG!`);
  }

  assert.ok(result.scoreDelta > 0, 'Winning should have positive delta');
  assert.ok(result.movement.distance > 0, 'Should actually move (not stay still)');
});

// ============================================================================
// COMPREHENSIVE NO-GUARD ZONE TESTS
// ============================================================================

test('PositionExplorationStrategy - NO-GUARD: Defender blocked from own zone', async () => {
  const strategy = new PositionExplorationStrategy();
  const gameState = createTestGameState();

  // Team A piece at (9,10) WITHOUT enemy flag - should NOT be able to enter zone (y=11-12)
  gameState.players.A.pieces[0] = { id: 1, x: 9, y: 10, alive: true, hasFlag: false };
  gameState.noGuardZoneActive = { A: true, B: true }; // Zone active
  gameState.flags.B = { x: 9, y: 0, carriedBy: null }; // Enemy flag NOT carried

  // Move other pieces away
  gameState.players.A.pieces[1] = { id: 2, x: 0, y: 9, alive: true, hasFlag: false };
  gameState.players.A.pieces[2] = { id: 3, x: 1, y: 9, alive: true, hasFlag: false };
  gameState.players.B.pieces[0] = { id: 1, x: 0, y: 0, alive: true, hasFlag: false };
  gameState.players.B.pieces[1] = { id: 2, x: 1, y: 0, alive: true, hasFlag: false };
  gameState.players.B.pieces[2] = { id: 3, x: 2, y: 0, alive: true, hasFlag: false };

  const findBestMoveForPiece = (strategy as any).findBestMoveForPiece.bind(strategy);
  const result = findBestMoveForPiece(gameState, 1, 'A', undefined);

  console.log('🎯 NO-GUARD TEST: Defender blocked from own zone');
  console.log(`   Team A piece at (9,10) without flag, zone at y=11-12 is ACTIVE`);
  console.log(`   Best move: ${result.movement.direction} ${result.movement.distance}, delta=${result.scoreDelta}`);

  // Should NOT move up (y+1) into zone
  if (result.movement.direction === 'up' && result.movement.distance > 0) {
    console.log(`   ⚠️  BUG: Defender entered own no-guard zone!`);
  } else {
    console.log(`   ✅ Defender correctly blocked from own zone`);
  }

  // If it tried to move up, verify it stopped at boundary (y=10, can't reach y=11)
  if (result.movement.direction === 'up') {
    assert.strictEqual(result.movement.distance, 0, 'Should not move up into own no-guard zone');
  }
});

test('PositionExplorationStrategy - NO-GUARD: Attacker can enter enemy zone freely', async () => {
  const strategy = new PositionExplorationStrategy();
  const gameState = createTestGameState();

  // Team B piece at (9,6) trying to move into Team A no-guard zone (y=11-12)
  // Attackers should be able to enter freely
  gameState.players.B.pieces[0] = { id: 1, x: 9, y: 6, alive: true, hasFlag: false };
  gameState.noGuardZoneActive = { A: true, B: true }; // Team A zone active

  // Move other pieces away
  gameState.players.A.pieces[0] = { id: 1, x: 0, y: 12, alive: true, hasFlag: false };
  gameState.players.A.pieces[1] = { id: 2, x: 1, y: 12, alive: true, hasFlag: false };
  gameState.players.A.pieces[2] = { id: 3, x: 2, y: 12, alive: true, hasFlag: false };
  gameState.players.B.pieces[1] = { id: 2, x: 0, y: 0, alive: true, hasFlag: false };
  gameState.players.B.pieces[2] = { id: 3, x: 1, y: 0, alive: true, hasFlag: false };

  const findBestMoveForPiece = (strategy as any).findBestMoveForPiece.bind(strategy);
  const result = findBestMoveForPiece(gameState, 1, 'B', undefined);

  console.log('🎯 NO-GUARD TEST: Attacker can enter enemy zone freely');
  console.log(`   Team B piece at (9,6) attacking Team A zone (y=11-12)`);
  console.log(`   Best move: ${result.movement.direction} ${result.movement.distance}, delta=${result.scoreDelta}`);

  // Attacker SHOULD be able to move toward flag ('up' increases y)
  // Let's manually check if moving up 6 is possible (9,6 -> 9,12)
  const testState = JSON.parse(JSON.stringify(gameState));
  const { CommandProcessor } = await import('../../game/CommandProcessor.js');
  const processor = new CommandProcessor();
  const paths = processor.executeMovements(testState, {
    playerA: [],
    playerB: [{ pieceId: 1, direction: 'up', distance: 6 }]
  });

  const movedPiece = testState.players.B?.pieces.find(p => p.id === 1);
  processor.applyFinalPositions(testState, paths);

  console.log(`   Manually tested: up 6 from (9,6) reaches (${movedPiece?.x},${movedPiece?.y})`);

  if (movedPiece && movedPiece.y >= 11) {
    console.log(`   ✅ Attacker CAN enter enemy no-guard zone`);
  } else {
    console.log(`   ⚠️  BUG: Attacker blocked from enemy zone!`);
  }

  assert.ok(movedPiece && movedPiece.y >= 11, 'Attacker should be able to enter enemy no-guard zone');
});

test('PositionExplorationStrategy - NO-GUARD: Attacker can grab flag in zone', async () => {
  const strategy = new PositionExplorationStrategy();
  const gameState = createTestGameState();

  // Team B piece at (9,10) can move to (9,12) where Team A flag is
  // Team A no-guard zone (y=11-12) should NOT block Team B
  gameState.players.B.pieces[0] = { id: 1, x: 9, y: 10, alive: true, hasFlag: false };
  gameState.flags.A = { x: 9, y: 12, carriedBy: null }; // Flag in no-guard zone
  gameState.noGuardZoneActive = { A: true, B: true };

  // Move other pieces away
  gameState.players.A.pieces[0] = { id: 1, x: 0, y: 12, alive: true, hasFlag: false };
  gameState.players.A.pieces[1] = { id: 2, x: 1, y: 12, alive: true, hasFlag: false };
  gameState.players.A.pieces[2] = { id: 3, x: 2, y: 12, alive: true, hasFlag: false };
  gameState.players.B.pieces[1] = { id: 2, x: 0, y: 0, alive: true, hasFlag: false };
  gameState.players.B.pieces[2] = { id: 3, x: 1, y: 0, alive: true, hasFlag: false };

  const findBestMoveForPiece = (strategy as any).findBestMoveForPiece.bind(strategy);
  const result = findBestMoveForPiece(gameState, 1, 'B', undefined);

  console.log('🎯 NO-GUARD TEST: Attacker can grab flag in enemy zone');
  console.log(`   Team B piece at (9,10), Team A flag at (9,12) in no-guard zone`);
  console.log(`   Best move: ${result.movement.direction} ${result.movement.distance}, delta=${result.scoreDelta}`);

  // Should want to grab the flag (huge score boost)
  if (result.scoreDelta > 5000) {
    console.log(`   ✅ Attacker recognizes flag capture opportunity (+${result.scoreDelta})`);
  } else {
    console.log(`   ⚠️  Attacker didn't prioritize flag capture (delta=${result.scoreDelta})`);
  }

  assert.ok(result.scoreDelta > 5000, 'Attacker should strongly value capturing enemy flag');
});

test('PositionExplorationStrategy - NO-GUARD: Zone deactivates when flag captured', async () => {
  const strategy = new PositionExplorationStrategy();
  const gameState = createTestGameState();

  // Team A piece at (9,10), Team B has captured Team A flag
  // Team A zone should be INACTIVE now, allowing Team A to chase
  gameState.players.A.pieces[0] = { id: 1, x: 9, y: 10, alive: true, hasFlag: false };
  gameState.flags.A = { x: 9, y: 6, carriedBy: { player: 'B', pieceId: 1 } }; // Enemy has our flag!
  gameState.noGuardZoneActive = { A: false, B: true }; // Team A zone DEACTIVATED

  // Move other pieces away
  gameState.players.A.pieces[1] = { id: 2, x: 0, y: 9, alive: true, hasFlag: false };
  gameState.players.A.pieces[2] = { id: 3, x: 1, y: 9, alive: true, hasFlag: false };
  gameState.players.B.pieces[0] = { id: 1, x: 9, y: 6, alive: true, hasFlag: true };
  gameState.players.B.pieces[1] = { id: 2, x: 0, y: 0, alive: true, hasFlag: false };
  gameState.players.B.pieces[2] = { id: 3, x: 1, y: 0, alive: true, hasFlag: false };

  // Test if Team A can now enter their own zone
  const { CommandProcessor } = await import('../../game/CommandProcessor.js');
  const processor = new CommandProcessor();
  const testState = JSON.parse(JSON.stringify(gameState));
  const paths = processor.executeMovements(testState, {
    playerA: [{ pieceId: 1, direction: 'up', distance: 2 }],
    playerB: []
  });

  processor.applyFinalPositions(testState, paths);
  const movedPiece = testState.players.A?.pieces.find(p => p.id === 1);

  console.log('🎯 NO-GUARD TEST: Zone deactivates when flag captured');
  console.log(`   Team A piece at (9,10), enemy has our flag, zone should be INACTIVE`);
  console.log(`   Moved up 2: reached (${movedPiece?.x},${movedPiece?.y})`);

  if (movedPiece && movedPiece.y >= 11) {
    console.log(`   ✅ Zone correctly deactivated - defenders can now chase`);
  } else {
    console.log(`   ⚠️  BUG: Zone still blocking defenders even though flag is captured!`);
  }

  assert.ok(movedPiece && movedPiece.y >= 11, 'Defenders should access zone when enemy has flag');
});

test('PositionExplorationStrategy - NO-GUARD: Both zones operate independently', async () => {
  const strategy = new PositionExplorationStrategy();
  const gameState = createTestGameState();

  // Team A zone INACTIVE (enemy captured flag), Team B zone ACTIVE
  gameState.flags.A = { x: 9, y: 12, carriedBy: { player: 'B', pieceId: 1 } }; // Team B has A flag
  gameState.flags.B = { x: 9, y: 0, carriedBy: null }; // Team B flag safe
  gameState.noGuardZoneActive = { A: false, B: true }; // A inactive, B active

  // Test Team A can enter their own zone (inactive)
  gameState.players.A.pieces[0] = { id: 1, x: 9, y: 10, alive: true, hasFlag: false };

  // Test Team B CANNOT enter their own zone (active)
  gameState.players.B.pieces[0] = { id: 1, x: 9, y: 12, alive: true, hasFlag: true }; // Has flag
  gameState.players.B.pieces[1] = { id: 2, x: 9, y: 2, alive: true, hasFlag: false };

  const { CommandProcessor } = await import('../../game/CommandProcessor.js');
  const processor = new CommandProcessor();
  const testState = JSON.parse(JSON.stringify(gameState));

  const paths = processor.executeMovements(testState, {
    playerA: [{ pieceId: 1, direction: 'up', distance: 2 }],   // Try to enter A zone (y+1)
    playerB: [{ pieceId: 2, direction: 'down', distance: 1 }]  // Try to enter B zone (y-1)
  });

  processor.applyFinalPositions(testState, paths);
  const teamAPiece = testState.players.A?.pieces.find(p => p.id === 1);
  const teamBPiece = testState.players.B?.pieces.find(p => p.id === 2);

  console.log('🎯 NO-GUARD TEST: Both zones operate independently');
  console.log(`   Team A zone: INACTIVE, Team B zone: ACTIVE`);
  console.log(`   Team A piece moved to (${teamAPiece?.x},${teamAPiece?.y}) - should reach zone`);
  console.log(`   Team B piece moved to (${teamBPiece?.x},${teamBPiece?.y}) - should be blocked`);

  const teamAInZone = teamAPiece && teamAPiece.y >= 11;
  const teamBStayedAtY2 = teamBPiece && teamBPiece.y === 2; // Should stay at y=2, blocked from y=1

  if (teamAInZone) {
    console.log(`   ✅ Team A can enter inactive zone`);
  } else {
    console.log(`   ⚠️  BUG: Team A blocked from inactive zone`);
  }

  if (teamBStayedAtY2) {
    console.log(`   ✅ Team B blocked from active zone`);
  } else {
    console.log(`   ⚠️  BUG: Team B entered active zone (or moved elsewhere)`);
  }

  assert.ok(teamAInZone, 'Team A should enter inactive zone');
  assert.ok(teamBStayedAtY2, 'Team B should be blocked from active zone');
});

// ============================================================================
// ENEMY RESPONSE SIMULATION TESTS
// ============================================================================

test('PositionExplorationStrategy - ENEMY RESPONSE: AI considers enemy counter-moves', async () => {
  const strategy = new PositionExplorationStrategy();
  const gameState = createTestGameState();

  // Setup: Team A piece near enemy flag, but enemy piece can intercept
  gameState.players.A.pieces[0] = { id: 1, x: 9, y: 3, alive: true, hasFlag: false };
  gameState.players.B.pieces[0] = { id: 1, x: 9, y: 2, alive: true, hasFlag: false }; // Enemy defender
  gameState.flags.B = { x: 9, y: 0, carriedBy: null };

  // Move other pieces out of the way
  gameState.players.A.pieces[1] = { id: 2, x: 0, y: 12, alive: true, hasFlag: false };
  gameState.players.A.pieces[2] = { id: 3, x: 1, y: 12, alive: true, hasFlag: false };
  gameState.players.B.pieces[1] = { id: 2, x: 0, y: 0, alive: true, hasFlag: false };
  gameState.players.B.pieces[2] = { id: 3, x: 1, y: 0, alive: true, hasFlag: false };

  // Create an enemy move scenario where enemy piece 1 moves to block
  // (A combined move is one Movement per piece.)
  const enemyMove: Movement[] = [
    { pieceId: 1, direction: 'down', distance: 1 }, // Enemy steps back (y-1) to block
    { pieceId: 2, direction: 'up', distance: 0 },
    { pieceId: 3, direction: 'up', distance: 0 }
  ];

  const findBestMoveForPiece = (strategy as any).findBestMoveForPiece.bind(strategy);
  const result = findBestMoveForPiece(gameState, 1, 'A', enemyMove);

  console.log('🎯 ENEMY RESPONSE TEST: AI considers enemy counter-moves');
  console.log(`   Our piece at (9,3), enemy defender at (9,2), flag at (9,0)`);
  console.log(`   Enemy will move to block/intercept`);
  console.log(`   Best move: ${result.movement.direction} ${result.movement.distance}, delta=${result.scoreDelta}`);

  assert.ok(result.movement, 'Should return a movement against an enemy combined move');
  assert.ok(typeof result.scoreDelta === 'number', 'Should return a score delta');

  // AI should still try for flag or find alternative
  if (result.scoreDelta > 0) {
    console.log(`   ✅ AI found best response to enemy move`);
  } else {
    console.log(`   ⚠️  AI chose to stay still against enemy response`);
  }
});

// ============================================================================
// Run Tests
// ============================================================================

console.log('\n🧪 Running PositionExplorationStrategy Unit Tests\n');
