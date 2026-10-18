import type { AssistantProvider } from '../src/config.js';
import type { ClubNow, ToolRunner } from './bookingTools.js';

export interface TurnContext {
  now: ClubNow;
  tools: ToolRunner;
}

export interface TurnResult {
  reply: string;
  /** Transcript to send back next turn, in the provider's own format. */
  history: unknown;
}

/**
 * One AI provider behind the booking assistant. A provider only runs the
 * model loop; instructions, tools and the endpoint itself are shared.
 */
export interface AgentProvider<History = unknown> {
  readonly name: AssistantProvider;
  /**
   * Validate the history the browser sent back (`[]` for a new conversation).
   * null if it isn't this provider's format. Must reject roles the player
   * shouldn't be able to inject, such as system messages.
   */
  parseHistory(value: unknown): History | null;
  /**
   * Run one player turn to completion, calling ctx.tools as the model asks.
   * Throw HttpError for failures the player should see with a status.
   */
  runTurn(ctx: TurnContext, history: History, message: string): Promise<TurnResult>;
}

export const MAX_HISTORY_MESSAGES = 120;

export const REFUSAL_REPLY = "Sorry, I can't help with that. I can check availability and book courts.";
export const EMPTY_REPLY = 'Sorry, something went wrong. Please try again.';
export const TOO_MANY_STEPS_REPLY = 'Sorry, that took too many steps. Please try again with a date and time.';
export const MAX_STEPS = 8;

/** Array of plain objects, within the length cap, each passing `check`. */
export function isMessageArray(value: unknown, check: (m: Record<string, unknown>) => boolean): boolean {
  return (
    Array.isArray(value) &&
    value.length <= MAX_HISTORY_MESSAGES &&
    value.every((m) => typeof m === 'object' && m !== null && !Array.isArray(m) && check(m as Record<string, unknown>))
  );
}
