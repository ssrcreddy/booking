import OpenAI from 'openai';
import {
  EMPTY_REPLY,
  isMessageArray,
  MAX_STEPS,
  REFUSAL_REPLY,
  TOO_MANY_STEPS_REPLY,
  type AgentProvider,
} from '../agentProvider.js';
import { clubTimeNote, HttpError, SYSTEM_PROMPT, TOOL_DEFINITIONS, type ToolOutcome } from '../bookingTools.js';

type Message = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export const DEFAULT_OPENAI_MODEL = 'gpt-5.5';

const TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = TOOL_DEFINITIONS.map((t) => ({
  type: 'function',
  function: { name: t.name, description: t.description, parameters: t.parameters, strict: true },
}));

/** OpenAI Chat Completions with function calling; the transcript (minus the system prompt) goes back to the browser. */
export function createOpenAIProvider(client: OpenAI, model = DEFAULT_OPENAI_MODEL): AgentProvider<Message[]> {
  return {
    name: 'openai',

    parseHistory(value) {
      // No system/developer messages from the browser: those are ours.
      return isMessageArray(value, (m) => m.role === 'user' || m.role === 'assistant' || m.role === 'tool')
        ? (value as Message[])
        : null;
    },

    async runTurn({ now, tools }, history, message) {
      const messages: Message[] = [...history, { role: 'user', content: `${clubTimeNote(now)}\n\n${message}` }];

      try {
        for (let step = 0; step < MAX_STEPS; step++) {
          const completion = await client.chat.completions.create({
            model,
            messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
            tools: TOOLS,
          });
          const choice = completion.choices[0];
          const reply = choice?.message;
          if (!reply || reply.refusal || choice.finish_reason === 'content_filter') {
            return { reply: REFUSAL_REPLY, history };
          }

          const toolCalls = reply.tool_calls ?? [];
          messages.push({
            role: 'assistant',
            content: reply.content,
            ...(toolCalls.length > 0 && { tool_calls: toolCalls }),
          });

          if (toolCalls.length === 0) {
            return { reply: reply.content?.trim() || EMPTY_REPLY, history: messages };
          }

          for (const call of toolCalls) {
            let outcome: ToolOutcome;
            if (call.type !== 'function') {
              outcome = { content: 'Unknown tool.', isError: true };
            } else {
              let args: unknown;
              try {
                args = JSON.parse(call.function.arguments);
              } catch {
                args = undefined;
              }
              outcome = args
                ? await tools.run(call.function.name, args)
                : { content: 'The tool arguments were not valid JSON.', isError: true };
            }
            // Chat Completions has no error flag on tool results, so say it in the content.
            messages.push({
              role: 'tool',
              tool_call_id: call.id,
              content: outcome.isError ? `Error: ${outcome.content}` : outcome.content,
            });
          }
        }
      } catch (err) {
        if (err instanceof OpenAI.RateLimitError) {
          throw new HttpError(503, 'The assistant is busy right now. Please try again in a moment.');
        }
        if (err instanceof OpenAI.BadRequestError) {
          console.error('OpenAI rejected the request', err.message);
          throw new HttpError(400, 'Something went wrong with this conversation. Reload to start a new one.');
        }
        throw err;
      }

      return { reply: TOO_MANY_STEPS_REPLY, history: messages };
    },
  };
}
