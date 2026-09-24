import { createCommanderServer } from "./app.js";

const httpServer = createCommanderServer();

const PORT = process.env.PORT || 9999;

httpServer.listen(PORT, () => {
  console.log(`Movement Commander MCP server listening on http://localhost:${PORT}`);
  console.log(`  SSE stream: GET http://localhost:${PORT}/mcp`);
  console.log(`  Message post endpoint: POST http://localhost:${PORT}/mcp/messages?sessionId=...`);
  console.log(`  🎮 WebSocket server: ws://localhost:${PORT}/ws`);
});