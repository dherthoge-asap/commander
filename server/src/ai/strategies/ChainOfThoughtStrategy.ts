/**
 * ChainOfThoughtStrategy - Improved AI with Chain-of-Thought reasoning
 * Uses explicit step-by-step reasoning to make better strategic decisions
 */

import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import type { AIStrategy, AIResponse, Command } from './AIStrategy.js';
import { GAME_RULES as SHARED_GAME_RULES, territoryRows } from '../AIService.js';
import { PIECES_PER_TEAM } from '../../game/constants.js';
import type { GameState } from '../../game/types.js';
import { BOARD_WIDTH, BOARD_HEIGHT } from '../../game/constants.js';

// Created on first use: the OpenAI constructor throws without a key
let openaiClient: OpenAI | null = null;
const getOpenAI = () => (openaiClient ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY }));

// Enable/disable prompt logging (set to true to capture prompts/responses)
const ENABLE_PROMPT_LOGGING = true;
const LOG_DIR = path.join(process.cwd(), 'ai-logs');

// Track which game sessions we've initialized logs for
const initializedSessions = new Set<string>();

// Shared with AIService, which builds it from constants.ts (the old copy here described an 11x11 board)
const GAME_RULES = SHARED_GAME_RULES;

export class ChainOfThoughtStrategy implements AIStrategy {
  readonly name = 'chain-of-thought';
  readonly version = 'v1';
  readonly description = 'Improved AI using explicit step-by-step reasoning';

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
      const filename = `game-session_${this.name}-${this.version}_${timestamp}.md`;
      const filepath = path.join(LOG_DIR, filename);

      const header = `# AI Game Session Log
**Strategy**: ${this.name} ${this.version}
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

  async getCommands(gameState: GameState, aiPlayer: 'A' | 'B'): Promise<AIResponse> {
    const boardState = this.formatBoardState(gameState, aiPlayer);
    const prompt = this.buildPrompt(boardState, aiPlayer);

    // Initialize session log on first call (round 1)
    const sessionId = `game-${Date.now()}`;
    if (gameState.round === 1 || !this.currentLogFile) {
      this.initializeSessionLog(sessionId, GAME_RULES);
    }

    try {
      console.log(`🤖 AI (${this.name}-${this.version}, Player ${aiPlayer}) thinking...`);

      const completion = await getOpenAI().chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: GAME_RULES },
          { role: 'user', content: prompt }
        ],
        temperature: 0.7,
        max_tokens: 1500 // Increased for Chain-of-Thought reasoning
      });

      const response = completion.choices[0]?.message?.content;
      if (!response) {
        console.error('❌ No response from AI');
        return { commands: [], reasoning: 'No response from AI' };
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

  private formatBoardState(gameState: GameState, aiPlayer: 'A' | 'B'): string {
    const enemyPlayer = aiPlayer === 'A' ? 'B' : 'A';

    const myPieces = gameState.players[aiPlayer]?.pieces || [];
    const enemyPieces = gameState.players[enemyPlayer]?.pieces || [];

    // Calculate restricted squares (no-guard zones)
    const myRestrictedSquares = this.getRestrictedSquares(gameState, aiPlayer);
    const enemyRestrictedSquares = this.getRestrictedSquares(gameState, enemyPlayer);

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
      },
      restrictedSquares: {
        yours: myRestrictedSquares,
        enemy: enemyRestrictedSquares
      }
    };

    return JSON.stringify(boardState, null, 2);
  }

  /**
   * Calculate which squares are restricted (no-guard zone) for a team
   * Returns array of {x, y} coordinates that cannot be entered
   */
  private getRestrictedSquares(gameState: GameState, team: 'A' | 'B'): Array<{ x: number; y: number }> {
    const flag = gameState.flags[team];

    // If flag is carried, no-guard zone doesn't apply
    if (flag.carriedBy !== null) {
      return [];
    }

    // Calculate 1-cell radius around flag (no-guard zone)
    const { x, y } = flag;
    const restrictedSquares: Array<{ x: number; y: number }> = [];

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const nx = x + dx;
        const ny = y + dy;

        // Check bounds and exclude the flag square itself
        if (nx >= 0 && nx < BOARD_WIDTH && ny >= 0 && ny < BOARD_HEIGHT && !(dx === 0 && dy === 0)) {
          restrictedSquares.push({ x: nx, y: ny });
        }
      }
    }

    return restrictedSquares;
  }

  private buildPrompt(boardState: string, aiPlayer: 'A' | 'B'): string {
    const teamName = aiPlayer === 'A' ? 'Blue' : 'Red';
    const myTerritory = territoryRows(aiPlayer);
    const enemyTerritory = territoryRows(aiPlayer === 'A' ? 'B' : 'A');
    const myFlagKey = aiPlayer;
    const enemyFlagKey = aiPlayer === 'A' ? 'B' : 'A';

    return `You are a MASTER Capture the Flag strategist playing as ${teamName} team (Player ${aiPlayer}).

Current board state:
${boardState}

## CHAIN-OF-THOUGHT REASONING PROCESS

Before making any moves, you MUST work through this reasoning process step-by-step:

### STEP 1: THREAT ASSESSMENT
Analyze the current board state:
- Does the enemy have MY flag? (check if ${myFlagKey}Flag.carriedBy exists)
  - If YES: Where are they? Calculate their distance to their territory (${enemyTerritory})
  - How many turns until they score? (this is CRITICAL - you LOSE if they reach their territory)
- Do I have the ENEMY flag? (check if ${enemyFlagKey}Flag.carriedBy exists and it's me)
  - If YES: What's my shortest path to MY territory (${myTerritory})?
  - Which enemies can intercept me? Calculate their distances.

**CRITICAL: NO-GUARD ZONE RULE**
- Check the board state for "restrictedSquares.yours" - these squares are OFF-LIMITS to your pieces
- These are the squares immediately around your flag (when your flag is still at its spawn point)
- You CANNOT move into these squares - any command that would land on a restricted square will FAIL
- Once your flag is carried away, the no-guard zone disappears and those squares become accessible
- ENEMY restricted squares ("restrictedSquares.enemy") are squares THEY cannot enter (you can enter them)

### STEP 2: PIECE ACCOUNTING
Count your resources:
- How many of my pieces are active and alive? (not jailed)
- How many of my pieces are jailed?
- How many enemy pieces are active?
- How many enemy pieces are jailed?
- Do I have numerical advantage or disadvantage?

### STEP 3: STRATEGIC PRIORITY DECISION
Based on steps 1-2, determine your PRIMARY goal for THIS turn:

**PRIORITY 1: EMERGENCY DEFENSE**
- If enemy has my flag AND is close to scoring (within 3-4 moves of their territory):
  → PRIMARY GOAL: Intercept flag carrier with multiple pieces
  → Calculate intercept points along their path
  → Commit 2-3 pieces to intercept, not just 1

**PRIORITY 2: SECURE THE WIN**
- If I have enemy flag AND path to my territory is clear:
  → PRIMARY GOAL: Move flag carrier to safety as FAST as possible
  → Use OTHER pieces as blockers/decoys
  → Take shortest path with large distance moves (5-10 cells per turn)

**PRIORITY 3: CAPTURE ENEMY FLAG**
- If enemy flag is unguarded OR weakly defended:
  → PRIMARY GOAL: Coordinate flag grab with 2+ pieces
  → Send decoys to split their defense
  → Use fast, aggressive moves through enemy territory

**PRIORITY 4: RESCUE OPERATIONS**
- If I have pieces jailed AND rescue key is available in my territory:
  → Calculate: Is it worth a piece to grab rescue key?
  → Only if it frees multiple pieces or enemy is winning

**PRIORITY 5: POSITIONAL PLAY**
- If no immediate threats/opportunities:
  → Keep 1-2 pieces near my flag as defenders
  → Push 2-3 pieces toward enemy flag
  → Spread out pieces - don't cluster

### STEP 4: TACTICAL CALCULATIONS
For your chosen priority, calculate specific moves:

**If defending:**
- Enemy flag carrier position: (x, y)
- Their path to territory: calculate likely direction
- My pieces that can intercept: list piece IDs and distances
- Best intercept point: where can I meet them fastest?

**If attacking:**
- My flag carrier position: (x, y)
- Distance to safety: calculate exact cells
- Obstacles in path: any enemy pieces blocking?
- Best escape route: straight line or evasive?

**If capturing flag:**
- Enemy flag position: (x, y)
- Enemy defenders nearby: how many within 3 cells?
- My raiders: which pieces are closest?
- Attack angle: which direction is least defended?

### STEP 5: MOVEMENT OPTIMIZATION
For each piece you're moving:
- Calculate exact distance needed (don't use tiny moves like 1-2 cells unless necessary)
- Use LONG moves (5-10 cells) to cross the board quickly
- Remember: you can move until you hit a wall or piece
- Consider where this piece will be NEXT turn after this move

### STEP 6: FINAL DECISION
State your FINAL STRATEGY for this turn in 2-3 sentences, then provide commands.

---

## OUTPUT FORMAT

You MUST structure your response exactly like this:

CHAIN-OF-THOUGHT:
[Your step-by-step reasoning through all 6 steps above - be specific with positions and calculations]

STRATEGY:
[Your final strategic decision for THIS turn - 2-3 sentences]

COMMANDS:
[
  {"pieceId": 1, "direction": "down", "distance": 6},
  {"pieceId": 2, "direction": "right", "distance": 4}
]

Each command must have:
- pieceId: The ID of your piece (1-${PIECES_PER_TEAM})
- direction: One of "up", "down", "left", "right"
- distance: Any positive number (use large distances! 5-10 cells is normal)

Remember:
- Work through ALL steps before deciding
- Calculate exact positions and distances
- Make BOLD, aggressive moves when you have advantage
- INTERCEPT flag carriers immediately - don't let them score!
- Use long-distance moves to control the board

Play to WIN.`;
  }

  private parseAIResponse(response: string, gameState: GameState, aiPlayer: 'A' | 'B'): { commands: Command[]; reasoning: string } {
    try {
      // Extract full chain-of-thought reasoning
      const cotMatch = response.match(/CHAIN-OF-THOUGHT:\s*([\s\S]*?)(?=STRATEGY:|$)/);
      const strategyMatch = response.match(/STRATEGY:\s*([\s\S]*?)(?=COMMANDS:|$)/);

      const chainOfThought = cotMatch ? cotMatch[1].trim() : '';
      const strategy = strategyMatch ? strategyMatch[1].trim() : '';

      // Combine both for full reasoning display
      const reasoning = chainOfThought && strategy
        ? `${strategy}\n\n[Chain-of-Thought Details]\n${chainOfThought.substring(0, 500)}...`
        : chainOfThought || strategy || 'No reasoning provided';

      // Extract JSON array from response
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
        const validDistance = cmd.distance >= 1;
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
