/**
 * Fake model for prompt-mode tests: reads "piece N <direction> D" phrases out of the orders
 * and answers in the same JSON shape gpt-4o-mini is asked for. Anything else gets no commands.
 */

import type { ChatMessage, ModelClient } from '../PromptTranslator.js';

export function ordersFrom(messages: ChatMessage[]): string {
  const user = messages.find(m => m.role === 'user')?.content ?? '';
  return user.match(/<orders>\n([\s\S]*)\n<\/orders>/)?.[1] ?? '';
}

export function createFakeModel(): ModelClient & { calls: ChatMessage[][] } {
  const calls: ChatMessage[][] = [];
  const client = async (messages: ChatMessage[]) => {
    calls.push(messages);
    const orders = ordersFrom(messages);
    const commands = [...orders.matchAll(/piece (\d+) (up|down|left|right) (\d+)/gi)].map(m => ({
      pieceId: Number(m[1]),
      direction: m[2].toLowerCase(),
      distance: Number(m[3])
    }));
    return JSON.stringify({ summary: commands.length ? `Moving ${commands.length} piece(s).` : 'No clear orders.', commands });
  };
  return Object.assign(client, { calls });
}
