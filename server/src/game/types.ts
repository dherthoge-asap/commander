/**
 * Game Types
 * Centralized type definitions for Commander's Flag War
 */

import type { WebSocket } from 'ws';
import type { Player } from './Player.js';

// ============================================================================
// Piece & Movement Types
// ============================================================================

export type Piece = {
  id: number;
  x: number;
  y: number;
  alive: boolean;
};

export type Movement = {
  pieceId: number;
  direction: 'up' | 'down' | 'left' | 'right';
  distance: number;
};

export type PlayerData = {
  id: string;
  player: Player;
  pieces: Piece[];
  jailedPieces: number[];
};

// ============================================================================
// Game State Types
// ============================================================================

export type CommanderGameState = {
  // Board configuration (sent from server, no hardcoding on frontend)
  boardWidth: number;
  boardHeight: number;
  piecesPerTeam: number;
  territoryBounds: {
    A: { min: number; max: number }; // Blue territory Y bounds
    B: { min: number; max: number }; // Red territory Y bounds
  };

  round: number;
  players: {
    A: PlayerData | null;
    B: PlayerData | null;
  };
  commandQueue: {
    [round: number]: {
      playerA: Movement[];
      playerB: Movement[];
      aiReasoning?: string; // Legacy AI reasoning text
      aiAnalysis?: AIAnalysis; // Structured AI analysis
      aiPrompt?: string; // The full prompt sent to AI for this round
    };
  };
  rescueKeys: {
    A: { x: number; y: number } | null; // Blue team's key - appears when Blue has jail
    B: { x: number; y: number } | null; // Red team's key - appears when Red has jail
  };
  flags: {
    A: { x: number; y: number; carriedBy: { player: 'A' | 'B'; pieceId: number } | null };
    B: { x: number; y: number; carriedBy: { player: 'A' | 'B'; pieceId: number } | null };
  };
  noGuardZoneActive?: {
    A: boolean; // Blue no-guard zone active
    B: boolean; // Red no-guard zone active
  };
  noGuardZoneBounds?: {
    A: { minX: number; maxX: number; minY: number; maxY: number };
    B: { minX: number; maxX: number; minY: number; maxY: number };
  };
  gameStatus: 'waiting' | 'playing' | 'finished' | 'paused';
  winner?: 'A' | 'B';
  nextTickIn: number; // seconds until next round execution
  lastRoundTime: number; // timestamp of last round execution
  serverStartTime?: number; // timestamp when server started (for uptime display)
};

// ============================================================================
// AI Analysis Types
// ============================================================================

export type PieceScoring = {
  pieceId: number;
  action: string;
  points: number;
};

export type TeamAnalysis = {
  teamName: 'Blue' | 'Red';
  alivePieces: number;
  scoringPieces: PieceScoring[];
  totalPoints: number;
};

export type AIAnalysis = {
  executionTime: number;
  scenariosEvaluated: number;
  worstCaseScore: number;
  similarMoves: number;
  chosenMoves: Movement[];  // The actual moves AI chose this round
  predictedEnemyMoves: Movement[];  // What AI thought enemy would do (worst case)
  predictedScoreBreakdown: {
    A: ScoreBreakdown; // Blue team's predicted score (from Blue's perspective)
    B: ScoreBreakdown; // Red team's predicted score (from Red's perspective)
  };
  finalScore: number;
};

// ============================================================================
// Room Types
// ============================================================================

// Import ScoreBreakdown from ScoreEvaluator
import type { ScoreBreakdown } from './ScoreEvaluator.js';

export type RoundHistory = {
  round: number;
  playerAMoves: Movement[];
  playerBMoves: Movement[];
  aiReasoning?: string; // Legacy text reasoning (still supported)
  aiAnalysis?: AIAnalysis; // New structured analysis
  aiPrompt?: string; // The full prompt sent to AI this round
  piecesBeforeMove?: {
    A: Piece[];
    B: Piece[];
  };
  piecesAfterMove?: {
    A: Piece[];
    B: Piece[];
  };
  actualScoreAfterMove?: {
    A: ScoreBreakdown; // Blue team's full score breakdown (from Blue's perspective)
    B: ScoreBreakdown; // Red team's full score breakdown (from Red's perspective)
  };
};

export type GameRoom = {
  roomCode: string;
  playerCount: number;
  status: 'waiting' | 'playing' | 'finished';
  createdAt: number;
  gameState: CommanderGameState;
  connections: Set<WebSocket>;
  gameTimer: NodeJS.Timeout | null;
  history: RoundHistory[];
  pendingAIGeneration?: boolean; // Track if AI is currently generating
};

// ============================================================================
// Message Types
// ============================================================================

export type GameMessage = {
  type: 'gameState' | 'move' | 'join' | 'reset' | 'start' | 'pause' | 'createRoom' | 'joinRoom' | 'getGamesList' | 'createAIRoom' | 'queueCommand' | 'gameHistory' | 'submitPrompt';
  payload: any;
};

// ============================================================================
// Widget Types (MCP)
// ============================================================================

export type PizzazWidget = {
  id: string;
  title: string;
  templateUri: string;
  invoking: string;
  invoked: string;
  html: string;
  responseText: string;
};
