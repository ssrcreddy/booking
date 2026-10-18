import Anthropic from '@anthropic-ai/sdk';
import type { AgentProvider } from '../agentProvider.js';
import { clubTimeNote, HttpError, SYSTEM_PROMPT, TOOL_DEFINITIONS } from '../bookingTools.js';

type MessageParam = Anthropic.Beta.Messages.BetaMessageParam;
type ToolResult = Anthropic.Beta.Messages.BetaToolResultBlockParam;

const MODEL = 'claude-opus-5-5';
const MAX_STEPS = 8;
const MAX_HISTORY_MESSAGES = 120;

const TOOLS: Anthropic.Beta.Messages.BetaTool[] = TOOL_DEFINITIONS.map((t) => ({
  name: t.name,
  description: t.description,
  strict: true,
  input_schema: t.parameters,
}));

function isHistory(value: unknown): value is MessageParam[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_HISTORY_MESSAGES &&
    value.every(
      (m) =>
        typeof m === 'object' &&
        m !== null &&
        ((m as MessageParam).role === 'user' || (m as MessageParam).role === 'assistant'),
    )
  );
}

/** Claude via the Anthropic API: a manual tool-use loop, so the full transcript can go back to the browser. */
export function createClaudeProvider(apiKey: string): AgentProvider<MessageParam[]> {
  const client = new Anthropic({ apiKey });

  return {
    parseHistory(value) {
      return isHistory(value) ? value : null;
    },

    async runTurn({ now, tools }, history, message) {
      const messages: MessageParam[] = [
        ...history,
        {
          role: 'user',
          content: [
            { type: 'text', text: clubTimeNote(now) },
            { type: 'text', text: message },
          ],
        },
      ];

      try {
        for (let step = 0; step < MAX_STEPS; step++) {
          const response = await client.beta.messages.create({
            model: MODEL,
            max_tokens: 16000,
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
            output_config: { effort: 'medium' },
            system: SYSTEM_PROMPT,
            tools: TOOLS,
            messages,
          });

          if (response.stop_reason === 'refusal') {
            // Drop the refused turn so the conversation can carry on.
            return { reply: "Sorry, I can't help with that. I can check availability and book courts.", history };
          }

          messages.push({ role: 'assistant', content: response.content });

          if (response.stop_reason !== 'tool_use') {
            const reply = response.content
              .flatMap((b) => (b.type === 'text' ? [b.text] : []))
              .join('\n')
              .trim();
            return { reply: reply || 'Sorry, something went wrong. Please try again.', history: messages };
          }

          const results: ToolResult[] = [];
          for (const block of response.content) {
            if (block.type !== 'tool_use') continue;
            const outcome = await tools.run(block.name, block.input);
            results.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: outcome.content,
              ...(outcome.isError && { is_error: true }),
            });
          }
          messages.push({ role: 'user', content: results });
        }
      } catch (err) {
        if (err instanceof Anthropic.RateLimitError) {
          throw new HttpError(503, 'The assistant is busy right now. Please try again in a moment.');
        }
        if (err instanceof Anthropic.BadRequestError) {
          console.error('Claude rejected the request', err.message);
          throw new HttpError(400, 'Something went wrong with this conversation. Reload to start a new one.');
        }
        throw err;
      }

      return { reply: 'Sorry, that took too many steps. Please try again with a date and time.', history: messages };
    },
  };
}
