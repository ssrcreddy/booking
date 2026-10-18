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
  /** Validate the history the browser sent back. null if it isn't this provider's format. */
  parseHistory(value: unknown): History | null;
  /**
   * Run one player turn to completion, calling ctx.tools as the model asks.
   * Throw HttpError for failures the player should see with a status.
   */
  runTurn(ctx: TurnContext, history: History, message: string): Promise<TurnResult>;
}
