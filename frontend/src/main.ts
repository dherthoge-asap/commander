import './style.css';
import { GameInterface } from './components/GameInterface';
import './diagnostic';

// WebSocket URL: VITE_WS_URL when set at build time, otherwise the page's own host
// (the server serves this page and /ws from one origin), or the local dev server on localhost.
// An access code on the page URL (?code=...) is passed through to the socket.
const getWebSocketUrl = (): string => {
  const { protocol, hostname, host, search } = window.location;
  const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
  const sameOrigin = `${protocol === 'https:' ? 'wss' : 'ws'}://${host}/ws`;
  const base = import.meta.env.VITE_WS_URL || (isLocal ? 'ws://localhost:9999/ws' : sameOrigin);

  const code = new URLSearchParams(search).get('code');
  if (!code) return base;
  const url = new URL(base);
  url.searchParams.set('code', code);
  return url.toString();
};

// Initialize the game interface
const serverUrl = getWebSocketUrl();
console.log(`🔌 Connecting to WebSocket: ${serverUrl}`);
console.log('🎯 TEST LOG: If you can see this in your terminal, console monitoring works!');
const gameInterface = new GameInterface('app', serverUrl);

// Make it globally accessible for onclick handlers
window.gameInterface = gameInterface;
