/**
 * GameLoopManager
 * Manages game loop timing and round execution for rooms
 */

import type { GameRoom } from './types.js';
import { RoomManager } from './RoomManager.js';
import { GameEngine } from './GameEngine.js';
import { RescueKeyManager } from './RescueKeyManager.js';
import { FlagManager } from './FlagManager.js';
import { AIOrchestrator } from '../ai/AIOrchestrator.js';
import { evaluateGameState } from './ScoreEvaluator.js';

export class GameLoopManager {
  private roomManager: RoomManager;
  private gameEngine: GameEngine;
  private rescueKeyManager: RescueKeyManager;
  private flagManager: FlagManager;
  private aiOrchestrator: AIOrchestrator;

  constructor(
    roomManager: RoomManager,
    gameEngine: GameEngine,
    rescueKeyManager: RescueKeyManager,
    flagManager: FlagManager,
    aiOrchestrator: AIOrchestrator
  ) {
    this.roomManager = roomManager;
    this.gameEngine = gameEngine;
    this.rescueKeyManager = rescueKeyManager;
    this.flagManager = flagManager;
    this.aiOrchestrator = aiOrchestrator;
  }

  /**
   * Start game loop for a room
   */
  startGameLoop(roomCode: string): void {
    const room = this.roomManager.getRoom(roomCode);
    if (!room) return;

    console.log(`🎮 Starting game loop for room ${roomCode}`);

    // Update game status
    room.gameState.gameStatus = 'playing';
    room.gameState.lastRoundTime = Date.now();

    // Start AI generation immediately so it has 3 seconds to think during first countdown
    this.aiOrchestrator.checkAndStartAIGeneration(roomCode);

    // Start round execution timer (every 3 seconds)
    room.gameTimer = setInterval(() => {
      this.executeRound(roomCode);
    }, 3000);

    // Broadcast initial state (include history for live score breakdown)
    this.roomManager.broadcastToRoom(roomCode, {
      type: 'gameState',
      payload: {
        ...room.gameState,
        history: room.history
      }
    });
  }

  /**
   * Stop game loop for a room
   */
  stopGameLoop(roomCode: string): void {
    const room = this.roomManager.getRoom(roomCode);
    if (!room) return;

    console.log(`🛑 Stopping game loop for room ${roomCode}`);

    if (room.gameTimer) {
      clearInterval(room.gameTimer);
      room.gameTimer = null;
    }

    room.gameState.gameStatus = 'paused';
  }

  /**
   * Execute a single round for a room
   */
  private async executeRound(roomCode: string): Promise<void> {
    const room = this.roomManager.getRoom(roomCode);
    if (!room) return;

    if (room.gameState.gameStatus !== 'playing') return;

    // ⏰ Set timestamp at START of round (before any game logic)
    room.gameState.lastRoundTime = Date.now();

    // Reduced logging - only log when there are commands to execute
    const roundCommands = room.gameState.commandQueue[room.gameState.round];
    if (roundCommands && (roundCommands.playerA.length > 0 || roundCommands.playerB.length > 0)) {
      console.log(`⚡ Executing Round ${room.gameState.round} for room ${roomCode}`);
      console.log(`📝 Player A commands:`, roundCommands.playerA);
      console.log(`📝 Player B commands:`, roundCommands.playerB);
    }

    // DEBUG: Log all queued future rounds
    const queuedRounds = Object.keys(room.gameState.commandQueue).map(Number).sort((a, b) => a - b);
    if (queuedRounds.length > 0) {
      console.log(`🔮 Future commands queued for rounds: ${queuedRounds.filter(r => r > room.gameState.round).join(', ') || 'none'}`);
    }

    // Reset any pieces that picked up keys in the previous round
    this.rescueKeyManager.resetRescuingPieces(room.gameState);

    // Snapshot piece positions and round number BEFORE moves are executed
    const currentRound = room.gameState.round;
    const piecesBeforeMove = {
      A: room.gameState.players.A ? JSON.parse(JSON.stringify(room.gameState.players.A.pieces)) : [],
      B: room.gameState.players.B ? JSON.parse(JSON.stringify(room.gameState.players.B.pieces)) : []
    };

    // Snapshot full game state BEFORE moves for capture detection
    const stateBeforeMove = JSON.parse(JSON.stringify(room.gameState));

    if (roundCommands) {
      // Execute round using GameEngine
      console.log('✅ Phase 5: Using GameEngine for round execution');
      this.gameEngine.executeRound(room.gameState, roundCommands);

      // After handling collisions, spawn rescue key if needed
      this.rescueKeyManager.updateKeys(room.gameState);

      // Check for rescue key pickups first (before collisions)
      this.rescueKeyManager.checkForRescue(room.gameState);

      // Check for flag pickups and scoring
      this.flagManager.checkFlagInteractions(room.gameState);

      // Deactivate no-guard zone when opposition picks up the flag
      // (Zone stays active even if opposition enters, only deactivates when flag is carried)
      if (room.gameState.noGuardZoneActive) {
        // Check if Red (B) picked up Blue's (A) flag - deactivate Blue zone
        if (room.gameState.noGuardZoneActive.A && room.gameState.flags.A.carriedBy?.player === 'B') {
          console.log(`🔓 Red team picked up Blue flag - deactivating Blue no-guard zone`);
          room.gameState.noGuardZoneActive.A = false;
        }

        // Check if Blue (A) picked up Red's (B) flag - deactivate Red zone
        if (room.gameState.noGuardZoneActive.B && room.gameState.flags.B.carriedBy?.player === 'A') {
          console.log(`🔓 Blue team picked up Red flag - deactivating Red no-guard zone`);
          room.gameState.noGuardZoneActive.B = false;
        }
      }

      // Snapshot piece positions AFTER moves are executed (for actual scoring display)
      const piecesAfterMove = {
        A: room.gameState.players.A ? JSON.parse(JSON.stringify(room.gameState.players.A.pieces)) : [],
        B: room.gameState.players.B ? JSON.parse(JSON.stringify(room.gameState.players.B.pieces)) : []
      };

      // Calculate actual position scores using centralized evaluator (with before state to detect captures)
      const actualScoreAfterMove = {
        A: evaluateGameState(room.gameState, 'A', stateBeforeMove), // Blue's perspective
        B: evaluateGameState(room.gameState, 'B', stateBeforeMove)  // Red's perspective
      };

      // Store round in history (use saved round number before increment)
      // Get AI reasoning, analysis, and prompt from the command queue for THIS round (not from room state)
      room.history.push({
        round: currentRound,
        playerAMoves: roundCommands.playerA || [],
        playerBMoves: roundCommands.playerB || [],
        aiReasoning: roundCommands.aiReasoning, // Legacy text reasoning
        aiAnalysis: roundCommands.aiAnalysis, // Structured analysis data
        aiPrompt: roundCommands.aiPrompt, // What was sent to AI this round
        piecesBeforeMove,
        piecesAfterMove,
        actualScoreAfterMove // Full score breakdown from both perspectives
      });

      // Clear executed commands (use saved round number)
      delete room.gameState.commandQueue[currentRound];
    } else {
      // No commands this round - still increment round and add empty history entry
      console.log(`⏭️ Round ${currentRound}: No commands queued, advancing round`);
      room.gameState.round++;
      room.gameState.lastRoundTime = Date.now();

      // Store empty round in history
      room.history.push({
        round: currentRound,
        playerAMoves: [],
        playerBMoves: [],
        aiReasoning: undefined,
        aiAnalysis: undefined,
        aiPrompt: undefined,
        piecesBeforeMove
      });
    }

    // NOW check if Player B is AI - start AI generation with UPDATED state (NON-BLOCKING)
    // AI will see the board state AFTER this round's moves have been executed
    // AI commands will be queued for next available round when they arrive
    this.aiOrchestrator.checkAndStartAIGeneration(roomCode);

    // Broadcast updated state (include history for live score breakdown)
    this.roomManager.broadcastToRoom(roomCode, {
      type: 'gameState',
      payload: {
        ...room.gameState,
        history: room.history
      }
    });

    // If game finished, send history after a delay to let animations play
    if (room.gameState.gameStatus === 'finished') {
      // Stop ticking: a finished room would otherwise keep its 3s timer until everyone disconnects
      if (room.gameTimer) {
        clearInterval(room.gameTimer);
        room.gameTimer = null;
      }
      room.status = 'finished';
      setTimeout(() => {
        this.roomManager.broadcastToRoom(roomCode, {
          type: 'gameHistory',
          payload: { history: room.history }
        });
      }, 2000); // 2 second delay to let final animations complete
    }
  }
}
