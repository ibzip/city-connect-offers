import { AzureOpenAIJsonAgentClient, isAzureLlmConfigured, isContextAgentMode, type JsonAgentClient } from "./llm.js";

export function createDefaultJsonAgentClient(): JsonAgentClient | null {
  if (process.env.LLM_PROVIDER !== "azure_openai") return null;
  if (!isAzureLlmConfigured()) return null;
  return new AzureOpenAIJsonAgentClient();
}

export { isAzureLlmConfigured, isContextAgentMode };
