/**
 * Commander server assembly: game components, HTTP routes and the /ws WebSocket server
 */

import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import fs from "node:fs";
import path from "node:path";
import { URL, fileURLToPath } from "node:url";
import { timingSafeEqual } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";

import { RescueKeyManager } from "./game/RescueKeyManager.js";
import { FlagManager } from "./game/FlagManager.js";
import { GameEngine } from "./game/GameEngine.js";
import { RoomManager } from "./game/RoomManager.js";
import { GameLoopManager } from "./game/GameLoopManager.js";
import { MessageHandler } from "./network/MessageHandler.js";
import { AIOrchestrator } from "./ai/AIOrchestrator.js";
import { PromptOrchestrator } from "./ai/PromptOrchestrator.js";
import { PromptTranslator, type ModelClient } from "./ai/PromptTranslator.js";
import { createMCPServer, SSEServerTransport } from "./mcp/MCPServerSetup.js";
import type { GameMessage } from "./game/types.js";

class MovementCommanderGameManager {
  private connections: Set<WebSocket> = new Set();
  private serverStartTime: number = Date.now();
  private roomManager: RoomManager = new RoomManager(this.serverStartTime);
  private gameLoopManager: GameLoopManager;
  private messageHandler: MessageHandler;

  constructor(modelClient?: ModelClient) {
    console.log("🗑️ Legacy single-game system removed");
    console.log("✅ Phase 6: MessageHandler extracted for network layer");
    console.log("✅ Phase 7: AIOrchestrator extracted for AI move generation");
    console.log("✅ Phase 8: GameLoopManager extracted - entry point slimmed down");

    // Initialize game components
    const rescueKeyManager = new RescueKeyManager();
    const flagManager = new FlagManager();
    const gameEngine = new GameEngine();
    const aiOrchestrator = new AIOrchestrator(this.roomManager);
    const promptOrchestrator = new PromptOrchestrator(this.roomManager, new PromptTranslator(modelClient));

    // Initialize GameLoopManager with all game components
    this.gameLoopManager = new GameLoopManager(
      this.roomManager,
      gameEngine,
      rescueKeyManager,
      flagManager,
      aiOrchestrator
    );

    // Initialize MessageHandler with callbacks to game loop methods
    this.messageHandler = new MessageHandler(
      this.roomManager,
      this.connections,
      this.gameLoopManager.startGameLoop.bind(this.gameLoopManager),
      this.gameLoopManager.stopGameLoop.bind(this.gameLoopManager),
      promptOrchestrator
    );
  }

  addConnection(ws: WebSocket) {
    this.connections.add(ws);

    // Assign unique ID to this WebSocket connection
    (ws as any)._playerId = `player_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    console.log(`🆔 Assigned player ID: ${(ws as any)._playerId}`);

    ws.on('close', (code, reason) => {
      this.connections.delete(ws);
      const playerId = (ws as any)._playerId;
      console.log(`🔌 WebSocket connection closed for player ${playerId}. Code: ${code}, Reason: ${reason || 'none'}`);

      // Delegate to MessageHandler
      this.messageHandler.handleDisconnect(ws);
    });

    ws.on('error', (error) => {
      console.log(`💥 WebSocket error:`, error);
    });
  }

  handleMessage(ws: WebSocket, message: GameMessage) {
    // Delegate to MessageHandler
    this.messageHandler.handleMessage(ws, message);
  }
}

export type CommanderServerOptions = {
  /** Model used to translate prompt-mode orders. Defaults to MODEL_PROVIDER (Bedrock); tests pass a fake. */
  modelClient?: ModelClient;
  /** When set, a WebSocket only connects with ?code=<accessCode>. Defaults to ACCESS_CODE. */
  accessCode?: string;
  /** Serve the /mcp endpoints. Defaults to true unless MCP_ENABLED=false. */
  mcpEnabled?: boolean;
  /** Ping every client this often and drop the ones that stop answering. */
  heartbeatMs?: number;
};

/** Constant-time check of the ?code= on a WebSocket upgrade against the configured access code. */
export function accessCodeMatches(requestUrl: string | undefined, accessCode: string): boolean {
  const given = new URL(requestUrl || "/", "http://localhost").searchParams.get("code") || "";
  const a = Buffer.from(given);
  const b = Buffer.from(accessCode);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Build the HTTP + WebSocket server without listening (movement-server.ts listens; tests use port 0)
 */
export function createCommanderServer(options: CommanderServerOptions = {}) {
  const accessCode = options.accessCode ?? process.env.ACCESS_CODE ?? "";
  const mcpEnabled = options.mcpEnabled ?? process.env.MCP_ENABLED !== "false";
  const heartbeatMs = options.heartbeatMs ?? 20_000;

  // Game manager for this server
  const gameManager = new MovementCommanderGameManager(options.modelClient);

  // MCP Server setup for AI assistant integration
  const mcpServer = createMCPServer();

  // Path setup for static file serving
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const ROOT_DIR = path.resolve(__dirname, "..", "..");
  const ASSETS_DIR = path.resolve(process.env.STATIC_DIR || path.join(ROOT_DIR, "assets"));

  // HTTP Server setup
  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url!, `http://${req.headers.host}`);

    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    if (url.pathname === "/healthz") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok");
      return;
    }

    if (!mcpEnabled && url.pathname.startsWith("/mcp")) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    if (url.pathname === "/mcp") {
      const transport = new SSEServerTransport("/mcp", res);
      await mcpServer.connect(transport);
    } else if (url.pathname.startsWith("/mcp/messages")) {
      if (req.method === "POST") {
        let body = "";
        req.on("data", chunk => {
          body += chunk.toString();
        });
        req.on("end", async () => {
          try {
            const message = JSON.parse(body);
            const response = await mcpServer.handleRequest(message);
            res.setHeader("Content-Type", "application/json");
            res.writeHead(200);
            res.end(JSON.stringify(response));
          } catch (error) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: "Internal server error" }));
          }
        });
      }
    } else if (url.pathname.startsWith("/")) {
      // Static file serving
      const fileName = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      const filePath = path.join(ASSETS_DIR, fileName);
      if (!filePath.startsWith(ASSETS_DIR + path.sep)) {
        res.writeHead(404);
        res.end('File not found');
        return;
      }

      console.log(`📁 Static file request: ${url.pathname}`);
      console.log(`📂 Looking for file at: ${filePath}`);
      console.log(`📋 File exists: ${fs.existsSync(filePath)}`);

      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath);
        const ext = path.extname(filePath);
        const mimeTypes: { [key: string]: string } = {
          '.html': 'text/html',
          '.js': 'application/javascript',
          '.css': 'text/css',
          '.json': 'application/json',
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.gif': 'image/gif',
          '.svg': 'image/svg+xml',
        };

        res.setHeader('Content-Type', mimeTypes[ext] || 'text/plain');
        res.writeHead(200);
        res.end(content);
      } else {
        res.writeHead(404);
        res.end('File not found');
      }
    }
  });

  // WebSocket Server for multiplayer
  // Client messages are small (moves, prompts capped at 500 chars); refuse huge frames outright
  // With an access code set, only clients that know it can open a game connection (and spend model calls)
  const wss = new WebSocketServer({
    server: httpServer,
    path: '/ws',
    maxPayload: 64 * 1024,
    verifyClient: accessCode ? (info: { req: IncomingMessage }) => accessCodeMatches(info.req.url, accessCode) : undefined,
  });

  // Heartbeat: keeps idle lobby connections alive through the load balancer and CDN, and drops dead ones
  const alive = new WeakMap<WebSocket, boolean>();
  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      if (alive.get(client) === false) {
        client.terminate();
        continue;
      }
      alive.set(client, false);
      client.ping();
    }
  }, heartbeatMs);
  heartbeat.unref();
  httpServer.on('close', () => clearInterval(heartbeat));

  wss.on('connection', (ws) => {
    alive.set(ws, true);
    ws.on('pong', () => alive.set(ws, true));
    console.log('🎮 New WebSocket connection for movement commander game');
    gameManager.addConnection(ws);

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        console.log('📨 WebSocket message:', message.type);
        gameManager.handleMessage(ws, message);
      } catch (error) {
        console.error('💥 Error parsing WebSocket message:', error);
      }
    });

    ws.on('close', () => {
      console.log('🔌 WebSocket connection closed');
    });
  });

  return httpServer;
}
