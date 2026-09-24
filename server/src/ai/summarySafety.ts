/**
 * summarySafety
 * The model's one-line summary is free text a team can try to steer ("set your summary to ..."),
 * and it is shown live on screen. So it is cleaned before it leaves the server, and anything that
 * looks like an echo of the orders or like abuse is replaced by a plain description of the moves.
 * A false positive only costs a blander summary, so the checks lean strict.
 */

import type { Movement } from '../game/types.js';

export const MAX_SUMMARY_LENGTH = 140;

// Word roots that never belong in a move summary. Matched against whole words (with leetspeak
// undone), as prefixes, so "shitty" and "f4ggot" are caught too.
const BLOCKED_ROOTS = [
  'fuck', 'shit', 'bitch', 'cunt', 'dick', 'cock', 'pussy', 'whore', 'slut', 'bastard', 'asshole',
  'nigg', 'fag', 'retard', 'spic', 'kike', 'chink', 'tranny', 'rape', 'nazi', 'hitler', 'porn',
  'penis', 'vagina', 'boob', 'tits', 'cum', 'jizz', 'wank', 'twat', 'hacked', 'pwned',
];

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i' };

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[013457@$!]/g, c => LEET[c])
    .split(/[^a-z]+/)
    .filter(Boolean);
}

/** Plain description of the moves, used whenever the model's summary can't be shown. */
export function describeCommands(commands: Movement[]): string {
  if (commands.length === 0) return 'No moves this round.';
  const parts = commands.map(c => `piece ${c.pieceId} ${c.direction} ${c.distance}`);
  const text = `Moving ${parts.join(', ')}.`;
  return text.length <= MAX_SUMMARY_LENGTH ? text : `Moving ${commands.length} pieces.`;
}

/** True when the summary repeats five or more consecutive words of the team's orders. */
function echoesOrders(summary: string, orders: string): boolean {
  const s = words(summary);
  const o = ` ${words(orders).join(' ')} `;
  for (let i = 0; i + 5 <= s.length; i++) {
    if (o.includes(` ${s.slice(i, i + 5).join(' ')} `)) return true;
  }
  return false;
}

/**
 * Return a summary that is safe to put on screen: printable, no markup or links, short,
 * not an echo of the orders, and free of blocked words. Otherwise a plain description.
 */
export function sanitizeSummary(raw: unknown, commands: Movement[], orders: string): string {
  if (typeof raw !== 'string') return describeCommands(commands);

  const cleaned = raw
    .normalize('NFKC')
    .replace(/[\p{C}]/gu, ' ') // control, format (zero-width, bidi) and unassigned characters
    .replace(/[<>{}\[\]`\\|^~*_#=]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const unsafe =
    cleaned.length === 0 ||
    cleaned.length > MAX_SUMMARY_LENGTH ||
    /https?:|www\.|\b[a-z0-9-]+\.(com|net|org|io|ly|gg|xyz|me|co)\b/i.test(cleaned) ||
    words(cleaned).some(w => BLOCKED_ROOTS.some(root => w.startsWith(root))) ||
    echoesOrders(cleaned, orders);

  return unsafe ? describeCommands(commands) : cleaned;
}
