/**
 * PromptOrchestrator
 * Runs prompt-mode translation for human teams and queues the resulting commands.
 * One model call in flight per team: a prompt that arrives mid-call waits, and only the
 * latest waiting prompt runs next (earlier waiting ones are replaced), so spam can't fan out
 * into unbounded calls.
 */

import type { WebSocket } from 'ws';
import type { Movement } from '../game/types.js';
import { RoomManager } from '../game/RoomManager.js';
import { PromptTranslator } from './PromptTranslator.js';

type TeamState = {
  inFlight: boolean;
  waiting: { prompt: unknown; ws: WebSocket } | null;
};

export class PromptOrchestrator {
  private teams = new Map<string, TeamState>();

  constructor(
    private readonly roomManager: RoomManager,
    private readonly translator: PromptTranslator = new PromptTranslator()
  ) {}

  /**
   * Accept a team's prompt. Resolves when this prompt (or the one that replaced it) is done.
   */
  submit(roomCode: string, side: 'A' | 'B', prompt: unknown, ws: WebSocket): Promise<void> {
    const key = `${roomCode}:${side}`;
    const team = this.teams.get(key) ?? { inFlight: false, waiting: null };
    this.teams.set(key, team);

    if (team.inFlight) {
      if (team.waiting) {
        this.send(team.waiting.ws, { type: 'promptResult', payload: { side, commands: [], summary: 'Replaced by a newer prompt.', error: 'superseded' } });
      }
      team.waiting = { prompt, ws };
      return Promise.resolve();
    }

    return this.run(key, roomCode, side, prompt, ws);
  }

  private async run(key: string, roomCode: string, side: 'A' | 'B', prompt: unknown, ws: WebSocket): Promise<void> {
    const team = this.teams.get(key)!;
    team.inFlight = true;

    try {
      const room = this.roomManager.getRoom(roomCode);
      if (!room || room.gameState.gameStatus === 'finished') return;

      const requestedForRound = room.gameState.round;
      const result = await this.translator.translate(room.gameState, side, prompt);

      // Room may have been destroyed or finished while the model was thinking
      const freshRoom = this.roomManager.getRoom(roomCode);
      if (!freshRoom || freshRoom.gameState.gameStatus === 'finished') return;

      // Same rule as AIOrchestrator: if the requested round already ran, use the current one
      const targetRound = Math.max(requestedForRound, freshRoom.gameState.round);
      this.queueCommands(freshRoom.gameState.commandQueue, targetRound, side, result.commands);

      console.log(`🗣️ Prompt (side ${side}, room ${roomCode}) → ${result.commands.length} commands for round ${targetRound}`);

      this.send(ws, {
        type: 'promptResult',
        payload: { side, round: targetRound, commands: result.commands, summary: result.summary, error: result.error }
      });
      this.roomManager.broadcastToRoom(roomCode, { type: 'gameState', payload: freshRoom.gameState });
    } catch (error) {
      console.error(`❌ Prompt handling failed (side ${side}, room ${roomCode}):`, error);
      this.send(ws, { type: 'promptResult', payload: { side, commands: [], summary: 'Something went wrong; no moves this time.', error: 'server_error' } });
    } finally {
      team.inFlight = false;
      const next = team.waiting;
      team.waiting = null;
      if (next) {
        await this.run(key, roomCode, side, next.prompt, next.ws);
      } else {
        this.teams.delete(key);
      }
    }
  }

  /**
   * Merge commands into the round's queue, replacing any earlier move for the same piece
   */
  private queueCommands(
    commandQueue: Record<number, { playerA: Movement[]; playerB: Movement[] }>,
    round: number,
    side: 'A' | 'B',
    commands: Movement[]
  ): void {
    if (commands.length === 0) return;
    if (!commandQueue[round]) {
      commandQueue[round] = { playerA: [], playerB: [] };
    }
    const playerKey = side === 'A' ? 'playerA' : 'playerB';
    const replaced = new Set(commands.map(c => c.pieceId));
    commandQueue[round][playerKey] = [
      ...commandQueue[round][playerKey].filter(m => !replaced.has(m.pieceId)),
      ...commands
    ];
  }

  private send(ws: WebSocket, message: unknown): void {
    if (ws.readyState === 1) { // WebSocket.OPEN
      ws.send(JSON.stringify(message));
    }
  }
}
