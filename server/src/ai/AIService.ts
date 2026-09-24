/**
 * AIService
 * Handles AI opponent integration using OpenAI API
 */

import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import {
  BOARD_WIDTH,
  BOARD_HEIGHT,
  PIECES_PER_TEAM,
  STARTING_POSITIONS,
  FLAG_POSITIONS,
  TERRITORY,
  NO_GUARD_ZONES,
  KEY_POSITIONS
} from '../game/constants.js';

// Created on first use: the OpenAI constructor throws without a key, which would crash any import
let openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!openai) openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return openai;
}

// Enable/disable prompt logging (set to true to capture prompts/responses)
const ENABLE_PROMPT_LOGGING = true;
const LOG_DIR = path.join(process.cwd(), 'ai-logs');

// Track which game sessions we've initialized logs for
const initializedSessions = new Set<string>();

type Piece = {
  id: number;
  x: number;
  y: number;
  alive: boolean;
};

type PlayerData = {
  id: string;
  type: string;
  pieces: Piece[];
  jailedPieces: number[];
};

type GameState = {
  round: number;
  players: {
    A: PlayerData | null;
    B: PlayerData | null;
  };
  flags: {
    A: { x: number; y: number; carriedBy: { player: 'A' | 'B'; pieceId: number } | null };
    B: { x: number; y: number; carriedBy: { player: 'A' | 'B'; pieceId: number } | null };
  };
  rescueKeys: {
    A: { x: number; y: number } | null;
    B: { x: number; y: number } | null;
  };
  [key: string]: any;
};

type Command = {
  pieceId: number;
  direction: 'up' | 'down' | 'left' | 'right';
  distance: number;
};

export type AIResponse = {
  commands: Command[];
  reasoning: string;
  prompt: string; // The full user prompt sent to AI
};

const NEUTRAL_MIN = TERRITORY.B.max + 1;
const NEUTRAL_MAX = TERRITORY.A.min - 1;
export const territoryRows = (side: 'A' | 'B') => `rows ${TERRITORY[side].min}-${TERRITORY[side].max}`;

// Built from constants.ts so the rules the model reads can never drift from the real board again
export const GAME_RULES = `# Commander's Flag War - Game Rules

## Objective
Capture the enemy flag and bring it back to your territory to win.

## Board
- ${BOARD_WIDTH}x${BOARD_HEIGHT} grid (x: 0-${BOARD_WIDTH - 1}, y: 0-${BOARD_HEIGHT - 1})
- Blue territory: ${territoryRows('A')} (Player A)
- Neutral zone: rows ${NEUTRAL_MIN}-${NEUTRAL_MAX}
- Red territory: ${territoryRows('B')} (Player B)

## Teams
- Blue (Player A): pieces start on row ${STARTING_POSITIONS.A[0].y}
- Red (Player B): pieces start on row ${STARTING_POSITIONS.B[0].y}
- Each team has ${PIECES_PER_TEAM} pieces (IDs 1-${PIECES_PER_TEAM})

## Flags
- Blue flag spawns at (${FLAG_POSITIONS.A.x}, ${FLAG_POSITIONS.A.y})
- Red flag spawns at (${FLAG_POSITIONS.B.x}, ${FLAG_POSITIONS.B.y})
- Land on enemy flag to pick it up
- Bring enemy flag to your territory to WIN
- If flag carrier is tagged, flag returns to spawn

## No-Guard Zones
- Blue no-guard zone: x ${NO_GUARD_ZONES.A.minX}-${NO_GUARD_ZONES.A.maxX}, rows ${NO_GUARD_ZONES.A.minY}-${NO_GUARD_ZONES.A.maxY}
- Red no-guard zone: x ${NO_GUARD_ZONES.B.minX}-${NO_GUARD_ZONES.B.maxX}, rows ${NO_GUARD_ZONES.B.minY}-${NO_GUARD_ZONES.B.maxY}
- You cannot enter your OWN no-guard zone (no camping on your flag), unless you carry the enemy flag
- A team's zone switches off once the enemy picks up that team's flag

## Tagging & Jail
- Two enemy pieces meeting in the neutral zone: both go to jail
- In enemy territory: you are the invader and go to jail if you meet a defender
- In your territory: you tag invaders and stay safe
- Jailed pieces are off the board
- When you have jailed pieces, your rescue key appears in enemy territory
  (Blue key at (${KEY_POSITIONS.A.x}, ${KEY_POSITIONS.A.y}), Red key at (${KEY_POSITIONS.B.x}, ${KEY_POSITIONS.B.y}))
- Pick up your rescue key to free all your jailed pieces back to their start squares

## Movement
- Each round, give commands for your pieces
- Format: {pieceId, direction, distance}
- Directions: 'up' (y+1, toward Blue's side), 'down' (y-1, toward Red's side), 'left' (x-1), 'right' (x+1)
- Distance: Any number of cells (up to board edge or until blocked)
- Pieces move simultaneously, then check collisions/tags
- Movement stops when hitting a wall, another piece, or the target distance

## Strategy Tips
- Protect your flag
- Coordinate attacks
- Use rescue keys to free teammates
- Balance offense and defense`;

export class AIService {
  private currentSessionId: string | null = null;
  private currentLogFile: string | null = null;

  /**
   * Initialize a new game session log file
   */
  private initializeSessionLog(sessionId: string, systemPrompt: string): void {
    if (initializedSessions.has(sessionId)) return;

    try {
      if (!fs.existsSync(LOG_DIR)) {
        fs.mkdirSync(LOG_DIR, { recursive: true });
      }

      const timestamp = new Date().toISOString().replace(/:/g, '-');
      const filename = `game-session_${timestamp}.md`;
      const filepath = path.join(LOG_DIR, filename);

      const header = `# AI Game Session Log
**Session ID**: ${sessionId}
**Started**: ${new Date().toISOString()}

---

## System Prompt (Game Rules)

\`\`\`
${systemPrompt}
\`\`\`

---

# Round-by-Round Interactions

`;

      fs.writeFileSync(filepath, header, 'utf-8');
      this.currentSessionId = sessionId;
      this.currentLogFile = filepath;
      initializedSessions.add(sessionId);
      console.log(`📝 Started new AI log session: ${filename}`);
    } catch (error) {
      console.error('❌ Failed to initialize AI session log:', error);
    }
  }

  /**
   * Append round data to the session log
   */
  private appendRoundToLog(round: number, aiPlayer: 'A' | 'B', userPrompt: string, response: string): void {
    if (!ENABLE_PROMPT_LOGGING || !this.currentLogFile) return;

    try {
      const roundContent = `
## Round ${round} - Player ${aiPlayer}
**Timestamp**: ${new Date().toISOString()}

### User Prompt (Board State + Strategy)

\`\`\`
${userPrompt}
\`\`\`

### AI Response

\`\`\`
${response}
\`\`\`

---

`;

      fs.appendFileSync(this.currentLogFile, roundContent, 'utf-8');
      console.log(`📝 Logged round ${round} to session log`);
    } catch (error) {
      console.error('❌ Failed to append round to log:', error);
    }
  }

  /**
   * Get AI's move commands and reasoning for the current round
   */
  async getAICommands(gameState: GameState, aiPlayer: 'A' | 'B'): Promise<AIResponse> {
    const boardState = this.formatBoardState(gameState, aiPlayer);
    const prompt = this.buildPrompt(boardState, aiPlayer);

    // Initialize session log on first call (round 1)
    const sessionId = `game-${Date.now()}`;
    if (gameState.round === 1 || !this.currentLogFile) {
      this.initializeSessionLog(sessionId, GAME_RULES);
    }

    try {
      console.log(`🤖 AI (Player ${aiPlayer}) thinking...`);

      const completion = await getOpenAI().chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: GAME_RULES },
          { role: 'user', content: prompt }
        ],
        temperature: 0.7,
        max_tokens: 800
      });

      const response = completion.choices[0]?.message?.content;
      if (!response) {
        console.error('❌ No response from AI');
        return { commands: [], reasoning: 'No response from AI', prompt };
      }

      console.log(`🤖 AI Response:\n${response}`);

      // Append round to session log
      this.appendRoundToLog(gameState.round, aiPlayer, prompt, response);

      const { commands, reasoning } = this.parseAIResponse(response, gameState, aiPlayer);
      console.log(`✅ AI Commands:`, commands);
      console.log(`💭 AI Reasoning:`, reasoning);

      return { commands, reasoning, prompt };
    } catch (error) {
      console.error('❌ AI Error:', error);
      return { commands: [], reasoning: `Error: ${error}`, prompt };
    }
  }

  /**
   * Format board state as clear JSON for AI
   */
  private formatBoardState(gameState: GameState, aiPlayer: 'A' | 'B'): string {
    const enemyPlayer = aiPlayer === 'A' ? 'B' : 'A';

    const myPieces = gameState.players[aiPlayer]?.pieces || [];
    const enemyPieces = gameState.players[enemyPlayer]?.pieces || [];

    const boardState = {
      round: gameState.round,
      yourTeam: aiPlayer,
      yourPieces: myPieces.map(p => ({ id: p.id, x: p.x, y: p.y, alive: p.alive })),
      yourJailedPieces: gameState.players[aiPlayer]?.jailedPieces || [],
      enemyPieces: enemyPieces.map(p => ({ id: p.id, x: p.x, y: p.y, alive: p.alive })),
      enemyJailedPieces: gameState.players[enemyPlayer]?.jailedPieces || [],
      blueFlag: gameState.flags.A,
      redFlag: gameState.flags.B,
      rescueKeys: {
        yours: gameState.rescueKeys[aiPlayer],
        enemy: gameState.rescueKeys[enemyPlayer]
      }
    };

    return JSON.stringify(boardState, null, 2);
  }

  /**
   * Build prompt for AI
   */
  private buildPrompt(boardState: string, aiPlayer: 'A' | 'B'): string {
    const teamName = aiPlayer === 'A' ? 'Blue' : 'Red';
    const myTerritory = territoryRows(aiPlayer);
    const enemyTerritory = territoryRows(aiPlayer === 'A' ? 'B' : 'A');

    return `You are an EXPERT Capture the Flag strategist playing as ${teamName} team (Player ${aiPlayer}).

Current board state:
${boardState}

CRITICAL STRATEGIC PRIORITIES (in order):

1. **DEFEND AGAINST FLAG CAPTURE**
   - If enemy has YOUR flag and is heading to their territory → INTERCEPT IMMEDIATELY
   - Calculate their path and cut them off - use multiple pieces if needed
   - This is your #1 priority - if they score, you lose

2. **SECURE THE WIN**
   - If YOU have enemy flag, get it to your territory (${myTerritory}) as fast as possible
   - Have other pieces run interference to protect the flag carrier
   - Take the shortest path but avoid enemy pieces that could tag you

3. **TACTICAL FLAG CAPTURE**
   - Send fast raiders to grab enemy flag when path is clear
   - Use decoys: send 2-3 pieces toward flag, enemy can't defend everywhere
   - Coordinate timing: attack when enemy is out of position

4. **RESCUE OPERATIONS**
   - If you have jailed pieces AND a rescue key exists in your territory → grab it!
   - Freed pieces can immediately help with offense/defense
   - Don't waste a trip - only go for rescue key if it's strategically valuable

5. **DEFENSIVE POSITIONING**
   - Keep 1-2 pieces near your flag AT ALL TIMES
   - Position defenders to cover likely attack routes
   - If enemy is in your territory (${myTerritory}), TAG THEM - you have tagging power here

6. **OFFENSIVE POSITIONING**
   - When in enemy territory (${enemyTerritory}), you're at risk of being tagged
   - Move FAST through enemy territory - don't linger
   - Use long-distance moves (you can move 5-10 cells in one turn!)

TACTICAL EXECUTION:

**Piece Coordination:**
- Attack with 2-3 pieces simultaneously to overwhelm defense
- If splitting forces, have clear roles: raiders, defenders, support
- Don't cluster all pieces - spread out for better board control

**Movement Mastery:**
- You can move ANY distance in a turn (up to board edge)
- Use long moves: "distance": 8 is valid! Don't waste turns with tiny moves
- Plan multi-turn sequences: where will this piece be NEXT turn?

**Situational Awareness:**
- Track enemy piece positions - where are their defenders?
- Identify weak points in their formation
- If enemy has multiple jailed pieces, they're weakened - PRESS THE ATTACK

**Decision Making:**
- Be AGGRESSIVE when you have an advantage (more pieces, flag in hand)
- Be CAUTIOUS when at a disadvantage (pieces jailed, flag stolen)
- ADAPT: if original plan is blocked, pivot immediately

Provide your response in TWO parts:

1. REASONING: Explain your tactical decision for this turn (2-3 sentences max)
2. COMMANDS: JSON array of commands

Format your response exactly like this:
REASONING: [Your strategic explanation here]

COMMANDS:
[
  {"pieceId": 1, "direction": "down", "distance": 6},
  {"pieceId": 2, "direction": "right", "distance": 4}
]

Each command must have:
- pieceId: The ID of your piece (1-${PIECES_PER_TEAM})
- direction: One of "up", "down", "left", "right"
- distance: Any positive number (use large distances! 5-10 cells is normal)

Give commands for THIS ROUND ONLY. Play to WIN.`;
  }

  /**
   * Parse AI's text response into commands and reasoning
   */
  private parseAIResponse(response: string, gameState: GameState, aiPlayer: 'A' | 'B'): { commands: Command[]; reasoning: string } {
    try {
      // Extract reasoning
      const reasoningMatch = response.match(/REASONING:\s*(.+?)(?=COMMANDS:|$)/s);
      const reasoning = reasoningMatch ? reasoningMatch[1].trim() : 'No reasoning provided';

      // Extract JSON array from response (AI might wrap it in markdown)
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        console.error('❌ No JSON array found in AI response');
        return { commands: [], reasoning };
      }

      const commands = JSON.parse(jsonMatch[0]) as Command[];

      // Validate commands
      const validCommands = commands.filter(cmd => {
        const piece = gameState.players[aiPlayer]?.pieces.find(p => p.id === cmd.pieceId);
        const validDirection = ['up', 'down', 'left', 'right'].includes(cmd.direction);
        const validDistance = cmd.distance >= 1; // Any positive distance is valid
        const pieceAlive = piece && piece.alive;

        if (!piece) {
          console.warn(`⚠️  Invalid piece ID: ${cmd.pieceId}`);
          return false;
        }
        if (!pieceAlive) {
          console.warn(`⚠️  Piece ${cmd.pieceId} is not alive`);
          return false;
        }
        if (!validDirection) {
          console.warn(`⚠️  Invalid direction: ${cmd.direction}`);
          return false;
        }
        if (!validDistance) {
          console.warn(`⚠️  Invalid distance: ${cmd.distance} (must be >= 1)`);
          return false;
        }

        return true;
      });

      return { commands: validCommands, reasoning };
    } catch (error) {
      console.error('❌ Failed to parse AI response:', error);
      return { commands: [], reasoning: `Parse error: ${error}` };
    }
  }
}
