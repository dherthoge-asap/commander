/**
 * Bedrock client unit tests
 * The Converse request is shaped right and the forced tool call comes back as JSON.
 * The Bedrock SDK is faked here, no AWS calls.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildConverseInput, createBedrockClient, extractOrders, ORDERS_TOOL_NAME, DEFAULT_BEDROCK_MODEL_ID } from './bedrockClient.js';

const messages = [
  { role: 'system' as const, content: 'rules' },
  { role: 'user' as const, content: 'board + orders' },
];

test('system prompt goes in system, user turn in messages, output forced through the orders tool', () => {
  const input = buildConverseInput(messages, 'model-x');
  assert.equal(input.modelId, 'model-x');
  assert.deepEqual(input.system, [{ text: 'rules' }]);
  assert.deepEqual(input.messages, [{ role: 'user', content: [{ text: 'board + orders' }] }]);
  assert.deepEqual(input.toolConfig?.toolChoice, { tool: { name: ORDERS_TOOL_NAME } });
  assert.equal(input.inferenceConfig?.maxTokens, 400);
});

test('the forced tool call comes back as JSON', () => {
  const input = { summary: 'Piece 4 heads down.', commands: [{ pieceId: 4, direction: 'down', distance: 3 }] };
  const out = extractOrders({ message: { content: [{ toolUse: { name: ORDERS_TOOL_NAME, input } }] } });
  assert.deepEqual(JSON.parse(out), input);
});

test('plain text is passed through when the model answers without the tool', () => {
  assert.equal(extractOrders({ message: { content: [{ text: '{"commands": []}' }] } }), '{"commands": []}');
  assert.equal(extractOrders(undefined), '');
});

test('client sends one Converse call to Haiku 4.5 by default', async () => {
  const sent: any[] = [];
  const sender = {
    async send(command: any) {
      sent.push(command.input);
      return { output: { message: { content: [{ toolUse: { name: ORDERS_TOOL_NAME, input: { summary: 's', commands: [] } } }] } } };
    },
  };
  const previous = process.env.BEDROCK_MODEL_ID;
  delete process.env.BEDROCK_MODEL_ID;
  try {
    const raw = await createBedrockClient({ sender })(messages);
    assert.deepEqual(JSON.parse(raw), { summary: 's', commands: [] });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].modelId, DEFAULT_BEDROCK_MODEL_ID);
  } finally {
    if (previous !== undefined) process.env.BEDROCK_MODEL_ID = previous;
  }
});

test('SDK errors reach the caller so PromptTranslator can report model_error', async () => {
  const sender = { async send(): Promise<any> { throw new Error('ThrottlingException'); } };
  await assert.rejects(createBedrockClient({ sender })(messages), /ThrottlingException/);
});
