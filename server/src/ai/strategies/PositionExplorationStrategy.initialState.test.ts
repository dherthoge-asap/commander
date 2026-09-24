/**
 * Position Exploration Strategy - Initial State Test
 *
 * CRITICAL TEST: Verifies AI behavior in perfectly symmetrical initial board state.
 *
 * In the initial state, all pieces are lined up symmetrically. No move provides
 * any advantage because:
 * 1. Enemy staying still means no threats to exploit
 * 2. Moving forward/sideways creates no score advantage
 * 3. All score deltas = 0
 *
 * EXPECTED BEHAVIOR: AI should choose to stay still (all pieces distance = 0)
 *
 * If AI chooses to move ANY piece, it indicates:
 * - Strategy is broken
 * - OR wrong strategy is being used
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PositionExplorationStrategy } from './PositionExplorationStrategy.js';
import { STARTING_POSITIONS, PIECES_PER_TEAM } from '../../game/constants.js';
import type { CommanderGameState } from '../../game/types.js';

test('PositionExplorationStrategy - Initial state: AI should choose to stay still', async () => {
  // Create EXACT initial board state (perfectly symmetrical)
  const initialState: CommanderGameState = {
    round: 1,
    players: {
      A: {
        id: 'player-a',
        player: { id: 'player-a', side: 'A', type: 'ai' },
        pieces: STARTING_POSITIONS.A.map(pos => ({ ...pos, alive: true })),
        jailedPieces: []
      },
      B: {
        id: 'player-b',
        player: { id: 'player-b', side: 'B', type: 'ai' },
        pieces: STARTING_POSITIONS.B.map(pos => ({ ...pos, alive: true })),
        jailedPieces: []
      }
    },
    commandQueue: {},
    rescueKeys: { A: null, B: null },
    flags: {
      A: { x: 5, y: 10, carriedBy: null }, // Blue flag at center back
      B: { x: 5, y: 0, carriedBy: null }   // Red flag at center back
    },
    noGuardZoneActive: { A: true, B: true },
    noGuardZoneBounds: {
      A: { minX: 4, maxX: 6, minY: 9, maxY: 10 },
      B: { minX: 4, maxX: 6, minY: 0, maxY: 1 }
    },
    gameStatus: 'playing',
    nextTickIn: 3,
    lastRoundTime: Date.now(),
    serverStartTime: Date.now()
  };

  console.log('\n🧪 INITIAL STATE TEST: Symmetrical board');
  console.log('   Blue pieces:', initialState.players.A.pieces.map(p => `(${p.x},${p.y})`));
  console.log('   Red pieces:', initialState.players.B!.pieces.map(p => `(${p.x},${p.y})`));

  // Ask AI to decide moves for Blue (side A)
  const strategy = new PositionExplorationStrategy();
  const result = await strategy.getCommands(initialState, 'A');

  console.log('\n📊 AI Decision:');
  console.log('   Commands returned:', result.commands);

  // CRITICAL ASSERTIONS: Verify AI chose to stay still
  assert.strictEqual(result.commands.length, PIECES_PER_TEAM, `Should return ${PIECES_PER_TEAM} commands (one per piece)`);

  for (let i = 0; i < result.commands.length; i++) {
    const cmd = result.commands[i];
    console.log(`   Piece ${cmd.pieceId}: ${cmd.direction} ${cmd.distance}`);

    // PRECISE CHECK: Distance must be 0 for all pieces
    assert.strictEqual(
      cmd.distance,
      0,
      `Piece ${cmd.pieceId} should stay still (distance=0), but chose ${cmd.direction} ${cmd.distance}`
    );
  }

  console.log('\n✅ PASS: AI correctly chose to stay still in initial state');
  console.log('   All pieces have distance=0 (no movement)');
});

console.log('\n✅ Initial state test defined\n');
