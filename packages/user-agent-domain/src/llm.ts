import { withTimeout } from "@city-wallet/utils";
import type { z } from "zod";

import { LLMAgentError } from "./errors.js";

/**
 * Built-in fallback for AZURE_OPENAI_API_VERSION. Azure OpenAI requires an
 * api-version on every call, but most local setups don't bother setting it
 * because the value is essentially a constant tied to the SDK behavior. We
 * default to a stable Azure OpenAI GA version so that operators only have to
 * provide the secret-bearing variables (endpoint, deployment, api key).
 *
 * Override via AZURE_OPENAI_API_VERSION if you need a specific version.
 */
export const DEFAULT_AZURE_OPENAI_API_VERSION = "2024-10-21";

export function resolveAzureApiVersion(value?: string): string {
  return value && value.trim().length > 0 ? value : DEFAULT_AZURE_OPENAI_API_VERSION;
}

export type AgentMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type JsonAgentInvocation<TSchema extends z.ZodTypeAny> = {
  stage: string;
  schema: TSchema;
  systemPrompt: string;
  userPayload: unknown;
  temperature?: number;
  timeoutMs?: number;
};

export type JsonAgentResult<T> = {
  output: T;
  validationStatus: "ok" | "repaired";
  provider: "azure_openai";
  model?: string;
  latencyMs: number;
  raw: string;
};

export interface JsonAgentClient {
  invoke<TSchema extends z.ZodTypeAny>(
    invocation: JsonAgentInvocation<TSchema>,
  ): Promise<JsonAgentResult<z.infer<TSchema>>>;
}

export type AzureClientConfig = {
  endpoint: string;
  deployment: string;
  apiKey: string;
  apiVersion: string;
  defaultTimeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export class AzureOpenAIJsonAgentClient implements JsonAgentClient {
  private readonly config: AzureClientConfig;

  constructor(config?: Partial<AzureClientConfig>) {
    const endpoint = config?.endpoint ?? process.env.AZURE_OPENAI_ENDPOINT ?? "";
    const deployment = config?.deployment ?? process.env.AZURE_OPENAI_DEPLOYMENT ?? "";
    const apiKey = config?.apiKey ?? process.env.AZURE_OPENAI_API_KEY ?? "";
    const apiVersion = resolveAzureApiVersion(config?.apiVersion ?? process.env.AZURE_OPENAI_API_VERSION);
    this.config = {
      endpoint,
      deployment,
      apiKey,
      apiVersion,
      defaultTimeoutMs: config?.defaultTimeoutMs ?? Number(process.env.AZURE_OPENAI_TIMEOUT_MS ?? 15_000),
      fetchImpl: config?.fetchImpl ?? fetch,
    };
  }

  async invoke<TSchema extends z.ZodTypeAny>(
    invocation: JsonAgentInvocation<TSchema>,
  ): Promise<JsonAgentResult<z.infer<TSchema>>> {
    const { endpoint, deployment, apiKey, apiVersion } = this.config;
    if (!endpoint || !deployment || !apiKey || !apiVersion) {
      throw new LLMAgentError(
        invocation.stage,
        "missing_config",
        "Azure OpenAI is not configured (endpoint/deployment/apiKey/apiVersion missing).",
      );
    }

    const initialMessages: AgentMessage[] = [
      { role: "system", content: invocation.systemPrompt },
      { role: "user", content: JSON.stringify(invocation.userPayload) },
    ];

    const start = Date.now();
    const firstAttempt = await this.callOnce(invocation, initialMessages);

    const firstParsed = tryParseAndValidate(invocation.schema, firstAttempt.content);
    if (firstParsed.success) {
      return {
        output: firstParsed.data as z.infer<TSchema>,
        validationStatus: "ok",
        provider: "azure_openai",
        model: firstAttempt.model,
        latencyMs: Date.now() - start,
        raw: firstAttempt.content,
      };
    }

    if (process.env.DEBUG_LLM_AGENTS === "true") {
      console.warn(
        `[city-wallet] LLM agent ${invocation.stage}: first attempt failed schema validation. ` +
          `Reason: ${firstParsed.reason}. Raw (first 800 chars): ${truncate(firstAttempt.content, 800)}`,
      );
    }

    const repairMessages: AgentMessage[] = [
      ...initialMessages,
      { role: "assistant", content: firstAttempt.content },
      {
        role: "user",
        content: [
          "Your previous response did not validate against the required JSON schema.",
          `Reason: ${firstParsed.reason}`,
          "Return only a corrected JSON object that satisfies the schema. Do not include explanations.",
        ].join("\n"),
      },
    ];

    let secondAttempt: AzureCallResult;
    try {
      secondAttempt = await this.callOnce(invocation, repairMessages);
    } catch (error) {
      if (error instanceof LLMAgentError) throw error;
      throw new LLMAgentError(invocation.stage, "repair_attempt_failed", String(error), error);
    }

    const secondParsed = tryParseAndValidate(invocation.schema, secondAttempt.content);
    if (!secondParsed.success) {
      // Always log the failure reason + raw content here, since we're about to
      // halt the orchestration and the user will otherwise just see
      // schema_validation_failed with no clue why.
      console.warn(
        `[city-wallet] LLM agent ${invocation.stage}: repair attempt also failed schema validation. ` +
          `Reason: ${secondParsed.reason}. Raw (first 800 chars): ${truncate(secondAttempt.content, 800)}`,
      );
      throw new LLMAgentError(
        invocation.stage,
        "schema_validation_failed",
        `Repair attempt failed schema validation: ${secondParsed.reason}`,
      );
    }

    return {
      output: secondParsed.data as z.infer<TSchema>,
      validationStatus: "repaired",
      provider: "azure_openai",
      model: secondAttempt.model,
      latencyMs: Date.now() - start,
      raw: secondAttempt.content,
    };
  }

  private async callOnce<TSchema extends z.ZodTypeAny>(
    invocation: JsonAgentInvocation<TSchema>,
    messages: AgentMessage[],
  ): Promise<AzureCallResult> {
    const { endpoint, deployment, apiKey, apiVersion, fetchImpl, defaultTimeoutMs } = this.config;
    const fetchFn = fetchImpl ?? fetch;
    const url = new URL(`/openai/deployments/${deployment}/chat/completions`, endpoint);
    url.searchParams.set("api-version", apiVersion);

    const timeoutMs = invocation.timeoutMs ?? defaultTimeoutMs ?? 15_000;

    const temperature = resolveOptionalTemperature(invocation.temperature);
    const requestBody: Record<string, unknown> = {
      response_format: { type: "json_object" },
      messages,
    };
    // Only include `temperature` when explicitly set. Newer Azure deployments
    // (o1/o3/gpt-5-class reasoning models) reject any value other than the
    // default and 400 the request. Omitting the field lets the model use its
    // own default, which works across all current Azure OpenAI models.
    if (temperature !== undefined) {
      requestBody.temperature = temperature;
    }

    let response: Response;
    try {
      response = await withTimeout(
        fetchFn(url.toString(), {
          method: "POST",
          headers: { "content-type": "application/json", "api-key": apiKey },
          body: JSON.stringify(requestBody),
        }),
        timeoutMs,
        `Azure OpenAI ${invocation.stage} request`,
      );
    } catch (error) {
      const isTimeout = String(error).includes("timed out");
      throw new LLMAgentError(
        invocation.stage,
        isTimeout ? "request_timeout" : "request_failed",
        `Azure OpenAI request failed: ${String(error)}`,
        error,
      );
    }

    if (!response.ok) {
      throw new LLMAgentError(
        invocation.stage,
        "request_failed",
        `Azure OpenAI ${response.status}: ${await safeText(response)}`,
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      throw new LLMAgentError(invocation.stage, "json_parse_failed", "Azure OpenAI body was not valid JSON.", error);
    }

    const content = extractContent(body);
    if (!content) {
      throw new LLMAgentError(invocation.stage, "empty_response", "Azure OpenAI returned no content.");
    }
    const model = extractModel(body);
    return { content, model };
  }
}

type AzureCallResult = { content: string; model?: string };

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "<no body>";
  }
}

function extractContent(body: unknown): string | null {
  const message = (body as { choices?: Array<{ message?: { content?: string } }> })?.choices?.[0]?.message;
  return message?.content ?? null;
}

function extractModel(body: unknown): string | undefined {
  return (body as { model?: string })?.model;
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…(truncated ${value.length - max} chars)`;
}

/**
 * Returns the temperature to send to Azure OpenAI:
 *   - explicit per-invocation override wins,
 *   - else AZURE_OPENAI_TEMPERATURE env var if set and a finite number,
 *   - else undefined (omit the field; let the model use its default).
 *
 * Reasoning-class deployments (o1/o3/gpt-5) reject any non-default temperature.
 */
function resolveOptionalTemperature(override?: number): number | undefined {
  if (typeof override === "number" && Number.isFinite(override)) return override;
  const raw = process.env.AZURE_OPENAI_TEMPERATURE;
  if (raw === undefined || raw === "") return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function tryParseAndValidate<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  content: string,
): { success: true; data: z.infer<TSchema> } | { success: false; reason: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    return { success: false, reason: `JSON parse failed: ${String(error)}` };
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    return {
      success: false,
      reason: result.error.errors
        .slice(0, 6)
        .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
        .join("; "),
    };
  }
  return { success: true, data: result.data };
}

export function isAzureLlmConfigured(): boolean {
  return getMissingAzureLlmVars().length === 0;
}

/**
 * Returns the names of required AZURE_OPENAI_* env vars that are missing.
 * AZURE_OPENAI_API_VERSION has a built-in default and is never reported here.
 */
export function getMissingAzureLlmVars(): string[] {
  const missing: string[] = [];
  if (!process.env.AZURE_OPENAI_ENDPOINT) missing.push("AZURE_OPENAI_ENDPOINT");
  if (!process.env.AZURE_OPENAI_DEPLOYMENT) missing.push("AZURE_OPENAI_DEPLOYMENT");
  if (!process.env.AZURE_OPENAI_API_KEY) missing.push("AZURE_OPENAI_API_KEY");
  return missing;
}

export function isContextAgentMode(): "azure_openai" | "skip" {
  if (process.env.LLM_PROVIDER === "azure_openai") {
    return "azure_openai";
  }
  return "skip";
}
