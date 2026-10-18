import { ApiError, type Content, type FunctionDeclaration, type GoogleGenAI, type Part } from '@google/genai';
import {
  EMPTY_REPLY,
  isMessageArray,
  MAX_STEPS,
  REFUSAL_REPLY,
  TOO_MANY_STEPS_REPLY,
  type AgentProvider,
} from '../agentProvider.js';
import { clubTimeNote, HttpError, SYSTEM_PROMPT, TOOL_DEFINITIONS } from '../bookingTools.js';

export const DEFAULT_GEMINI_MODEL = 'gemini-flash-latest';

const FUNCTIONS: FunctionDeclaration[] = TOOL_DEFINITIONS.map((t) => ({
  name: t.name,
  description: t.description,
  parametersJsonSchema: t.parameters,
}));

/**
 * Gemini via the Google Gen AI SDK with function declarations. Model turns are
 * kept exactly as returned (including thought signatures) and sent back as is.
 */
export function createGeminiProvider(ai: GoogleGenAI, model = DEFAULT_GEMINI_MODEL): AgentProvider<Content[]> {
  return {
    name: 'gemini',

    parseHistory(value) {
      return isMessageArray(value, (m) => (m.role === 'user' || m.role === 'model') && Array.isArray(m.parts))
        ? (value as Content[])
        : null;
    },

    async runTurn({ now, tools }, history, message) {
      const contents: Content[] = [
        ...history,
        { role: 'user', parts: [{ text: clubTimeNote(now) }, { text: message }] },
      ];

      try {
        for (let step = 0; step < MAX_STEPS; step++) {
          const response = await ai.models.generateContent({
            model,
            contents,
            config: { systemInstruction: SYSTEM_PROMPT, tools: [{ functionDeclarations: FUNCTIONS }] },
          });

          const content = response.candidates?.[0]?.content;
          if (response.promptFeedback?.blockReason || !content?.parts?.length) {
            return { reply: REFUSAL_REPLY, history };
          }
          contents.push({ ...content, role: 'model' });

          const calls = response.functionCalls ?? [];
          if (calls.length === 0) {
            return { reply: response.text?.trim() || EMPTY_REPLY, history: contents };
          }

          const parts: Part[] = [];
          for (const call of calls) {
            const name = call.name ?? '';
            const outcome = await tools.run(name, call.args ?? {});
            parts.push({
              functionResponse: {
                ...(call.id && { id: call.id }),
                name,
                response: outcome.isError ? { error: outcome.content } : { output: JSON.parse(outcome.content) },
              },
            });
          }
          contents.push({ role: 'user', parts });
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 429) {
          throw new HttpError(503, 'The assistant is busy right now. Please try again in a moment.');
        }
        if (err instanceof ApiError && err.status === 400) {
          console.error('Gemini rejected the request', err.message);
          throw new HttpError(400, 'Something went wrong with this conversation. Reload to start a new one.');
        }
        throw err;
      }

      return { reply: TOO_MANY_STEPS_REPLY, history: contents };
    },
  };
}
