import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { AzureOpenAIJsonAgentClient } from "./llm.js";
import { LLMAgentError } from "./errors.js";

const TestSchema = z.object({
  intent: z.enum(["browse", "eat", "shop"]),
  confidence: z.number().min(0).max(1),
});

function makeFetchSequence(responses: Array<{ status: number; body: unknown }>) {
  let index = 0;
  const calls: Array<{ url: string; body: unknown }> = [];
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    const current = responses[index] ?? responses[responses.length - 1];
    index += 1;
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
    return new Response(JSON.stringify(current.body), {
      status: current.status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls, getIndex: () => index };
}

function makeClient(fetchImpl: typeof fetch) {
  return new AzureOpenAIJsonAgentClient({
    endpoint: "https://example-azure.openai.azure.com",
    deployment: "test-deploy",
    apiKey: "test-key",
    apiVersion: "2024-06-01",
    defaultTimeoutMs: 5_000,
    fetchImpl,
  });
}

test("JsonAgentClient accepts a valid first response with status=ok", async () => {
  const { fetchImpl, calls } = makeFetchSequence([
    { status: 200, body: { model: "gpt-test", choices: [{ message: { content: JSON.stringify({ intent: "eat", confidence: 0.8 }) } }] } },
  ]);
  const client = makeClient(fetchImpl);
  const result = await client.invoke({
    stage: "test",
    schema: TestSchema,
    systemPrompt: "system",
    userPayload: { foo: "bar" },
  });
  assert.equal(result.validationStatus, "ok");
  assert.equal(result.output.intent, "eat");
  assert.equal(result.output.confidence, 0.8);
  assert.equal(calls.length, 1);
});

test("JsonAgentClient performs a single repair attempt on invalid first response", async () => {
  const { fetchImpl, calls } = makeFetchSequence([
    { status: 200, body: { model: "gpt-test", choices: [{ message: { content: JSON.stringify({ intent: "wat", confidence: 5 }) } }] } },
    { status: 200, body: { model: "gpt-test", choices: [{ message: { content: JSON.stringify({ intent: "shop", confidence: 0.42 }) } }] } },
  ]);
  const client = makeClient(fetchImpl);
  const result = await client.invoke({
    stage: "test",
    schema: TestSchema,
    systemPrompt: "system",
    userPayload: { foo: "bar" },
  });
  assert.equal(result.validationStatus, "repaired");
  assert.equal(result.output.intent, "shop");
  assert.equal(result.output.confidence, 0.42);
  assert.equal(calls.length, 2, "should call exactly twice (one initial + one repair)");
  const repairBody = calls[1].body as { messages: Array<{ role: string; content: string }> };
  assert.ok(
    repairBody.messages.some((m) => m.role === "user" && m.content.includes("did not validate")),
    "repair attempt should send schema-validation feedback",
  );
});

test("JsonAgentClient throws after a failed repair attempt (no second repair)", async () => {
  const { fetchImpl, calls } = makeFetchSequence([
    { status: 200, body: { model: "gpt-test", choices: [{ message: { content: JSON.stringify({ intent: "wat", confidence: 5 }) } }] } },
    { status: 200, body: { model: "gpt-test", choices: [{ message: { content: JSON.stringify({ intent: "still wrong" }) } }] } },
    { status: 200, body: { model: "gpt-test", choices: [{ message: { content: JSON.stringify({ intent: "eat", confidence: 0.5 }) } }] } },
  ]);
  const client = makeClient(fetchImpl);
  await assert.rejects(
    () =>
      client.invoke({
        stage: "test",
        schema: TestSchema,
        systemPrompt: "system",
        userPayload: { foo: "bar" },
      }),
    (error: unknown) => error instanceof LLMAgentError && error.type === "schema_validation_failed",
  );
  assert.equal(calls.length, 2, "should not attempt a third call after the repair fails");
});

test("JsonAgentClient throws missing_config when Azure config is incomplete", async () => {
  const client = new AzureOpenAIJsonAgentClient({
    endpoint: "",
    deployment: "",
    apiKey: "",
    apiVersion: "",
    fetchImpl: (async () => new Response("", { status: 200 })) as unknown as typeof fetch,
  });
  await assert.rejects(
    () =>
      client.invoke({
        stage: "test",
        schema: TestSchema,
        systemPrompt: "system",
        userPayload: { foo: "bar" },
      }),
    (error: unknown) => error instanceof LLMAgentError && error.type === "missing_config",
  );
});
