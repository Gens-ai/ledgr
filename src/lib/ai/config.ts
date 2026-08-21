import type { LanguageModel, Tool } from "ai";
import { createUserModel, createUserSearchTool, type AiProvider, type ProviderConfig } from "./provider";

const VALID_PROVIDERS: AiProvider[] = ["openai", "anthropic", "google", "custom"];

export function getAiConfig(): ProviderConfig | null {
  const provider = process.env.AI_PROVIDER;
  const model = process.env.AI_MODEL;
  const apiKey = process.env.AI_API_KEY;

  if (!provider || !model) return null;

  if (!VALID_PROVIDERS.includes(provider as AiProvider)) {
    console.warn(
      `[ledgr] AI_PROVIDER must be one of: ${VALID_PROVIDERS.join(", ")}. Got: "${provider}" — AI features disabled`,
    );
    return null;
  }

  const isCustom = provider === "custom";

  if (!apiKey && !isCustom) {
    console.warn(
      "[ledgr] AI_PROVIDER and AI_MODEL are set but AI_API_KEY is missing — AI features disabled",
    );
    return null;
  }

  const rawThreshold = parseFloat(process.env.AI_CONFIDENCE_THRESHOLD ?? "0.7");
  const confidenceThreshold = Math.min(0.9, Math.max(0.5, rawThreshold));

  const toolCalling =
    process.env.AI_TOOL_CALLING !== undefined
      ? process.env.AI_TOOL_CALLING !== "false"
      : !isCustom;

  return {
    aiProvider: provider as AiProvider,
    aiModel: model,
    aiApiKey: apiKey || "none",
    aiBaseUrl: process.env.AI_BASE_URL || undefined,
    confidenceThreshold,
    toolCalling,
  };
}

export function isAiConfigured(): boolean {
  return getAiConfig() !== null;
}

export function createAiModel(): LanguageModel | null {
  const config = getAiConfig();
  if (!config) return null;
  return createUserModel(config);
}

/** The household's provider's hosted web-search tool, if it has one and AI
 * is configured — see createUserSearchTool() for which providers qualify. */
export function createAiSearchTool(): Tool | null {
  const config = getAiConfig();
  if (!config) return null;
  return createUserSearchTool(config);
}

/** Whether the configured provider has a hosted web-search tool at all —
 * used to gate the Savings Advisor's deals opt-in in Settings without
 * actually constructing the tool. */
export function hasWebSearchProvider(): boolean {
  const config = getAiConfig();
  return config !== null && config.aiProvider !== "custom";
}
