/**
 * Bedrock ModelClient: Claude Haiku 4.5 through the Converse API.
 * Credentials come from the default AWS chain (the ECS task role when deployed, an SSO profile
 * locally); no access keys are ever read from env or config here.
 * Output is a forced tool call, so the model has to answer with the orders schema instead of
 * free text; the tool input is returned as JSON for PromptTranslator to parse and validate.
 */

import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ConverseCommandInput,
  type ToolConfiguration,
} from '@aws-sdk/client-bedrock-runtime';
import type { ChatMessage, ModelClient } from './PromptTranslator.js';

export const DEFAULT_BEDROCK_MODEL_ID = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';
const MODEL_TIMEOUT_MS = 10_000;
export const ORDERS_TOOL_NAME = 'submit_orders';

const ORDERS_TOOL: ToolConfiguration = {
  tools: [{
    toolSpec: {
      name: ORDERS_TOOL_NAME,
      description: "Submit this round's move commands for your team.",
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            summary: { type: 'string', description: 'One short sentence describing the moves, in your own words.' },
            commands: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  pieceId: { type: 'integer' },
                  direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] },
                  distance: { type: 'integer', minimum: 1 },
                },
                required: ['pieceId', 'direction', 'distance'],
              },
            },
          },
          required: ['summary', 'commands'],
        },
      },
    },
  }],
  toolChoice: { tool: { name: ORDERS_TOOL_NAME } },
};

/** The part of BedrockRuntimeClient this module uses, so tests can pass a fake. */
export type ConverseSender = { send(command: ConverseCommand): Promise<{ output?: any }> };

/** Build the Converse request for PromptTranslator's [system, user] messages. */
export function buildConverseInput(messages: ChatMessage[], modelId: string): ConverseCommandInput {
  const system = messages.filter(m => m.role === 'system').map(m => ({ text: m.content }));
  const turns = messages.filter(m => m.role === 'user').map(m => ({ role: 'user' as const, content: [{ text: m.content }] }));
  return {
    modelId,
    system,
    messages: turns,
    inferenceConfig: { maxTokens: 400, temperature: 0.2 },
    toolConfig: ORDERS_TOOL,
  };
}

/** Pull the orders out of a Converse response: the forced tool call, or plain text as a fallback. */
export function extractOrders(output: any): string {
  const content: any[] = output?.message?.content ?? [];
  const toolUse = content.find(block => block?.toolUse?.name === ORDERS_TOOL_NAME)?.toolUse;
  if (toolUse?.input && typeof toolUse.input === 'object') return JSON.stringify(toolUse.input);
  return content.map(block => (typeof block?.text === 'string' ? block.text : '')).join('');
}

export function createBedrockClient(options: { sender?: ConverseSender; modelId?: string; region?: string } = {}): ModelClient {
  const modelId = options.modelId || process.env.BEDROCK_MODEL_ID || DEFAULT_BEDROCK_MODEL_ID;
  let sender = options.sender;

  return async (messages) => {
    if (!sender) {
      sender = new BedrockRuntimeClient({
        region: options.region || process.env.AWS_REGION || 'us-east-1',
        maxAttempts: 2,
        requestHandler: { requestTimeout: MODEL_TIMEOUT_MS },
      });
    }
    const response = await sender.send(new ConverseCommand(buildConverseInput(messages, modelId)));
    return extractOrders(response.output);
  };
}
