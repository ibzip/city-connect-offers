export type LLMAgentErrorType =
  | "missing_config"
  | "request_failed"
  | "request_timeout"
  | "empty_response"
  | "json_parse_failed"
  | "schema_validation_failed"
  | "repair_attempt_failed"
  | "unknown";

export class LLMAgentError extends Error {
  readonly type: LLMAgentErrorType;
  readonly stage: string;
  readonly cause?: unknown;

  constructor(stage: string, type: LLMAgentErrorType, message: string, cause?: unknown) {
    super(message);
    this.name = "LLMAgentError";
    this.stage = stage;
    this.type = type;
    if (cause !== undefined) this.cause = cause;
  }
}
