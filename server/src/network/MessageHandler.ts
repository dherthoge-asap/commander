/**
 * MessageHandler
 * Handles WebSocket message routing and game room operations
 */

import type { WebSocket } from 'ws';
import type { GameMessage } from '../game/types.js';
import { RoomManager } from '../game/RoomManager.js';
import type { PromptOrchestrator } from '../ai/PromptOrchestrator.js';
import { STARTING_POSITIONS } from '../game/constants.js';
import type { Movement } from '../game/types.js';
import { normalizeMovement } from '../game/CommandProcessor.js';

export class MessageHandler {
  private roomManager: RoomManager;
  private connections: Set<WebSocket>;
  private onStartGameLoop: (roomCode: string) => void;
  private onStopGameLoop: (roomCode: string) => void;
  private promptOrchestrator: PromptOrchestrator | null;
  // Every room ticks every 3 s and can spend model calls, so cap how many exist at once
  private readonly maxRooms = Number(process.env.MAX_ROOMS) || 50;

  constructor(
    roomManager: RoomManager,
    connections: Set<WebSocket>,
    onStartGameLoop: (roomCode: string) => void,
    onStopGameLoop: (roomCode: string) => void,
    promptOrchestrator: PromptOrchestrator | null = null
  ) {
    this.roomManager = roomManager;
    this.connections = connections;
    this.onStartGameLoop = onStartGameLoop;
    this.onStopGameLoop = onStopGameLoop;
    this.promptOrchestrator = promptOrchestrator;
  }

  /**
   * Main message router
   */
  handleMessage(ws: WebSocket, message: GameMessage): void {
    switch (message.type) {
      case 'createRoom':
        this.handleCreateRoom(ws, message.payload);
        break;
      case 'createAIRoom':
        this.handleCreateAIRoom(ws, message.payload);
        break;
      case 'joinRoom':
        this.handleJoinRoom(ws, message.payload);
        break;
      case 'leaveRoom':
        this.handleLeaveRoom(ws, message.payload);
        break;
      case 'getGamesList':
        this.handleGetGamesList(ws);
        break;
      case 'queueMove':
        this.handleQueueMove(ws, message.payload);
        break;
      case 'mcpQueueMove':
        this.handleMcpQueueMove(ws, message.payload);
        break;
      case 'submitPrompt':
        this.handleSubmitPrompt(ws, message.payload);
        break;
    }
  }

  /**
   * Handle player disconnection
   */
  handleDisconnect(ws: WebSocket): void {
    const playerId = (ws as any)._playerId;
    const room = this.roomManager.getRoomByConnection(ws);

    if (room) {
      const roomCode = room.roomCode;
      console.log(`💥 Player ${playerId} disconnected from room ${roomCode}. Destroying room...`);

      // Notify all other players in the room that it's being destroyed
      this.roomManager.broadcastToRoom(roomCode, {
        type: 'roomDestroyed',
        payload: {
          roomCode,
          reason: 'A player disconnected'
        }
      });

      // Stop game loop
      this.onStopGameLoop(roomCode);

      // Remove connection (RoomManager handles cleanup)
      this.roomManager.removeConnection(ws);

      console.log(`✅ Room ${roomCode} destroyed`);

      // Broadcast updated games list to all clients
      this.broadcastGamesList();
    }
  }

  /**
   * Generate random room code
   */
  private generateRoomCode(): string {
    return Math.random().toString(36).substr(2, 6).toUpperCase();
  }

  /**
   * Handle room creation
   */
  /**
   * Refuse a new room once the server holds maxRooms (tells the client why)
   */
  private roomLimitReached(ws: WebSocket): boolean {
    if (this.roomManager.getAllRooms().length < this.maxRooms) return false;
    console.warn(`⚠️ Room limit (${this.maxRooms}) reached; refusing a new room`);
    ws.send(JSON.stringify({ type: 'error', payload: { message: 'The server is full right now; try again in a few minutes' } }));
    return true;
  }

  private handleCreateRoom(ws: WebSocket, payload: any): void {
    if (this.roomLimitReached(ws)) return;
    const playerId = (ws as any)._playerId;
    const roomCode = this.generateRoomCode();

    console.log(`🎯 Creating new room: ${roomCode} for player ${playerId}`);

    const room = this.roomManager.createRoom(roomCode, ws, 'local-a');

    // Update player ID to match connection ID
    if (room.gameState.players.A) {
      room.gameState.players.A.id = playerId;
    }

    // Send roomCreated response to trigger arena transition
    ws.send(JSON.stringify({
      type: 'roomCreated',
      payload: { roomCode }
    }));

    // Send initial game state to creator
    ws.send(JSON.stringify({
      type: 'gameState',
      payload: room.gameState
    }));

    console.log(`✅ Room ${roomCode} created successfully with creator ${playerId} as Player A (1/2 players)`);

    // Broadcast updated games list to all connected clients
    this.broadcastGamesList();
  }

  /**
   * Handle AI room creation
   */
  private handleCreateAIRoom(ws: WebSocket, payload: any): void {
    if (this.roomLimitReached(ws)) return;
    const playerId = (ws as any)._playerId;
    const roomCode = this.generateRoomCode();

    console.log(`🤖 Creating new AI room: ${roomCode} for player ${playerId}`);

    const room = this.roomManager.createRoom(roomCode, ws, 'local-a');

    // Update player ID to match connection ID
    if (room.gameState.players.A) {
      room.gameState.players.A.id = playerId;
    }

    // Use RoomManager's joinRoom to properly initialize AI player
    this.roomManager.joinRoom(roomCode, ws, 'ai');
    room.status = 'playing';

    // Send roomCreated response to trigger arena transition
    ws.send(JSON.stringify({
      type: 'roomCreated',
      payload: { roomCode, playerSide: 'A', isAI: true }
    }));

    // Send initial game state
    ws.send(JSON.stringify({
      type: 'gameState',
      payload: room.gameState
    }));

    console.log(`✅ AI room ${roomCode} created - Player vs AI`);

    // Start game loop immediately
    console.log(`🎮 Starting AI game loop for room ${roomCode}`);
    this.onStartGameLoop(roomCode);

    // Don't broadcast to games list (private AI match)
  }

  /**
   * Handle room join
   */
  private handleJoinRoom(ws: WebSocket, payload: { roomCode: string }): void {
    const playerId = (ws as any)._playerId;
    const { roomCode } = payload;

    console.log(`🚪 Player ${playerId} trying to join room: ${roomCode}`);

    const room = this.roomManager.joinRoom(roomCode, ws, 'local-b');
    if (!room) {
      ws.send(JSON.stringify({
        type: 'error',
        payload: { message: 'Room not found or full' }
      }));
      return;
    }

    // Update player ID to match connection ID
    if (room.gameState.players.B) {
      room.gameState.players.B.id = playerId;
    }

    // Send joinedRoom response to trigger arena transition
    ws.send(JSON.stringify({
      type: 'joinedRoom',
      payload: { roomCode }
    }));

    // Broadcast updated game state to all players in room
    this.roomManager.broadcastToRoom(roomCode, {
      type: 'gameState',
      payload: room.gameState
    });

    console.log(`✅ Player ${playerId} joined room ${roomCode} as Player B (${room.playerCount}/2 players)`);

    // Start game loop when both players have joined
    if (room.playerCount === 2) {
      room.status = 'playing';
      console.log(`🎮 Both players in room ${roomCode} - starting game loop!`);
      this.onStartGameLoop(roomCode);
    }

    // Broadcast updated games list to all connected clients
    this.broadcastGamesList();
  }

  /**
   * Handle room leave
   */
  private handleLeaveRoom(ws: WebSocket, payload: { roomCode: string }): void {
    const playerId = (ws as any)._playerId;
    const { roomCode } = payload;

    console.log(`🚪 Player ${playerId} leaving room: ${roomCode}`);

    const room = this.roomManager.getRoom(roomCode);
    if (!room) {
      console.log(`❌ Room ${roomCode} not found`);
      return;
    }

    // Notify all other players in the room that it's being destroyed
    this.roomManager.broadcastToRoom(roomCode, {
      type: 'roomDestroyed',
      payload: {
        roomCode,
        reason: 'A player left the room'
      }
    });

    // Stop game loop before destroying room
    this.onStopGameLoop(roomCode);

    // Remove connection (RoomManager handles cleanup)
    this.roomManager.removeConnection(ws);

    console.log(`✅ Room ${roomCode} destroyed`);

    // Broadcast updated games list to all clients
    this.broadcastGamesList();
  }

  /**
   * Handle games list request
   */
  private handleGetGamesList(ws: WebSocket): void {
    const playerId = (ws as any)._playerId;
    console.log(`📋 Player ${playerId} requesting games list`);

    const gamesList = this.roomManager.getAllRooms().map(room => ({
      roomCode: room.roomCode,
      playerCount: room.playerCount,
      status: room.status
    }));

    ws.send(JSON.stringify({
      type: 'gamesList',
      payload: { games: gamesList }
    }));

    console.log(`📤 Sent games list: ${gamesList.length} rooms available`);
  }

  /**
   * Handle a prompt-mode order: the team's plain English is translated into moves for its own pieces
   */
  private handleSubmitPrompt(ws: WebSocket, payload: { roomCode: string; prompt: string }): void {
    const playerId = (ws as any)._playerId;
    const room = this.roomManager.getRoom(payload?.roomCode);

    // Side comes from the connection, never from the payload
    let side: 'A' | 'B' | null = null;
    if (room && room.connections.has(ws)) {
      if (room.gameState.players.A?.id === playerId) side = 'A';
      else if (room.gameState.players.B?.id === playerId && room.gameState.players.B.player.type === 'human') side = 'B';
    }

    if (!room || !side || !this.promptOrchestrator) {
      ws.send(JSON.stringify({ type: 'error', payload: { message: 'Not a player in that room' } }));
      return;
    }

    console.log(`🗣️ Player ${side} submitted a prompt in room ${room.roomCode}`);
    void this.promptOrchestrator.submit(room.roomCode, side, payload.prompt, ws);
  }

  /**
   * Handle move queue
   */
  private handleQueueMove(ws: WebSocket, payload: { roomCode: string; pieceId: number; direction: 'up' | 'down' | 'left' | 'right'; distance: number; targetRound?: number }): void {
    const playerId = (ws as any)._playerId;
    const { roomCode, targetRound } = payload;
    const valid = normalizeMovement(payload);
    if (!valid) {
      console.log(`❌ Rejected invalid move from ${playerId}:`, payload);
      return;
    }
    const { pieceId, direction, distance } = valid;

    const room = this.roomManager.getRoom(roomCode);
    if (!room) {
      console.log(`❌ Room ${roomCode} not found`);
      return;
    }

    // Determine which player this is
    let player: 'A' | 'B' | null = null;
    if (room.gameState.players.A?.id === playerId) {
      player = 'A';
    } else if (room.gameState.players.B?.id === playerId) {
      player = 'B';
    }

    if (!player) {
      console.log(`❌ Player ${playerId} not found in room ${roomCode}`);
      return;
    }

    // Default to current round if not specified (executes at end of this round)
    const round = this.resolveTargetRound(targetRound, room.gameState.round);

    // Initialize command queue for this round if it doesn't exist
    if (!room.gameState.commandQueue[round]) {
      room.gameState.commandQueue[round] = {
        playerA: [],
        playerB: []
      };
    }

    // Add/replace move in queue (only one move per piece per round)
    const movement: Movement = { pieceId, direction, distance };
    const playerKey = `player${player}` as 'playerA' | 'playerB';

    // Remove any existing move for this piece in this round
    const existingIndex = room.gameState.commandQueue[round][playerKey].findIndex(m => m.pieceId === pieceId);
    if (existingIndex !== -1) {
      room.gameState.commandQueue[round][playerKey].splice(existingIndex, 1);
      console.log(`📝 Player ${player} replaced move for Piece ${pieceId} in Round ${round}`);
    }

    room.gameState.commandQueue[round][playerKey].push(movement);
    console.log(`📝 Player ${player} queued move for Round ${round}: P${pieceId}→${direction}(${distance})`);

    // Broadcast updated game state
    this.roomManager.broadcastToRoom(roomCode, {
      type: 'gameState',
      payload: room.gameState
    });
  }

  /**
   * Handle MCP queue move - auto-detects active human game
   */
  private handleMcpQueueMove(ws: WebSocket, payload: { pieceId: number; direction: 'up' | 'down' | 'left' | 'right'; distance: number; targetRound?: number }): void {
    const { targetRound } = payload;
    const valid = normalizeMovement(payload);
    if (!valid) {
      console.log('❌ MCP: Rejected invalid move:', payload);
      return;
    }
    const { pieceId, direction, distance } = valid;

    // Find the active human game
    const allRooms = this.roomManager.getAllRooms();
    const activeGames = allRooms.filter(room => room.status === 'playing');

    if (activeGames.length === 0) {
      console.log('❌ MCP: No active games found');
      return;
    }

    if (activeGames.length > 1) {
      console.log('❌ MCP: Multiple active games found, cannot auto-detect');
      return;
    }

    const room = activeGames[0];
    const roomCode = room.roomCode;

    // Determine human player (assume Player A is human)
    const humanPlayer: 'A' | 'B' = 'A';
    const playerId = room.gameState.players[humanPlayer]?.id;

    if (!playerId) {
      console.log(`❌ MCP: No human player found in room ${roomCode}`);
      return;
    }

    // Default to current round if not specified
    const round = this.resolveTargetRound(targetRound, room.gameState.round);

    // Initialize command queue for this round if it doesn't exist
    if (!room.gameState.commandQueue[round]) {
      room.gameState.commandQueue[round] = {
        playerA: [],
        playerB: []
      };
    }

    // Add/replace move in queue
    const movement: Movement = { pieceId, direction, distance };
    const playerKey = `player${humanPlayer}` as 'playerA' | 'playerB';

    // Remove any existing move for this piece in this round
    const existingIndex = room.gameState.commandQueue[round][playerKey].findIndex(m => m.pieceId === pieceId);
    if (existingIndex !== -1) {
      room.gameState.commandQueue[round][playerKey].splice(existingIndex, 1);
      console.log(`📝 MCP: Player ${humanPlayer} replaced move for Piece ${pieceId} in Round ${round}`);
    }

    room.gameState.commandQueue[round][playerKey].push(movement);
    console.log(`📝 MCP: Player ${humanPlayer} queued move for Round ${round}: P${pieceId}→${direction}(${distance})`);

    // Broadcast updated game state
    this.roomManager.broadcastToRoom(roomCode, {
      type: 'gameState',
      payload: room.gameState
    });
  }

  /**
   * Pick the round a move is queued for: the requested round if it's current or soon, else the current round.
   * A past round would never execute and would sit in the queue forever.
   */
  private resolveTargetRound(targetRound: unknown, currentRound: number): number {
    const requested = Number(targetRound);
    if (Number.isInteger(requested) && requested >= currentRound && requested <= currentRound + 10) {
      return requested;
    }
    return currentRound;
  }

  /**
   * Broadcast games list to all connected clients
   */
  private broadcastGamesList(): void {
    const gamesList = this.roomManager.getAllRooms().map(room => ({
      roomCode: room.roomCode,
      playerCount: room.playerCount,
      status: room.status
    }));

    const message = JSON.stringify({
      type: 'gamesList',
      payload: { games: gamesList }
    });

    console.log(`📢 Broadcasting games list to all clients: ${gamesList.length} rooms available`);

    this.connections.forEach(client => {
      if (client.readyState === 1) { // WebSocket.OPEN
        client.send(message);
      }
    });
  }
}
