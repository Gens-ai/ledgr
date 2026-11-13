import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel, Tool } from "ai";

export type AiProvider = "openai" | "anthropic" | "google" | "openrouter" | "custom";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export interface ProviderConfig {
  aiProvider: AiProvider;
  aiModel: string;
  aiApiKey: string;
  aiBaseUrl?: string;
  confidenceThreshold: number;
  toolCalling: boolean;
}

export function createUserModel(config: ProviderConfig): LanguageModel {
  switch (config.aiProvider) {
    case "openai": {
      const provider = createOpenAI({ apiKey: config.aiApiKey });
      return provider(config.aiModel);
    }
    case "anthropic": {
      const provider = createAnthropic({ apiKey: config.aiApiKey });
      return provider(config.aiModel);
    }
    case "google": {
      const provider = createGoogleGenerativeAI({ apiKey: config.aiApiKey });
      return provider(config.aiModel);
    }
    case "openrouter": {
      // OpenRouter speaks the OpenAI-compatible API, but unlike an arbitrary
      // `custom` endpoint it honours json_schema response formats — without
      // supportsStructuredOutputs the adapter drops the schema and sends a
      // bare json_object, leaving categorization to guess the shape.
      const provider = createOpenAICompatible({
        baseURL: config.aiBaseUrl ?? OPENROUTER_BASE_URL,
        apiKey: config.aiApiKey,
        name: "openrouter",
        supportsStructuredOutputs: true,
      });
      return provider(config.aiModel);
    }
    case "custom": {
      if (!config.aiBaseUrl) {
        throw new Error("aiBaseUrl is required for custom provider");
      }
      const provider = createOpenAICompatible({
        baseURL: config.aiBaseUrl,
        apiKey: config.aiApiKey || "none",
        name: "custom",
        // Without this, the AI SDK silently downgrades any JSON-schema
        // response format to plain `json_object` mode (or drops it
        // entirely) — the model then free-writes prose instead of the
        // schema-constrained JSON that Output.object() expects, and
        // parsing throws. Most OpenAI-compatible endpoints (OpenRouter,
        // vLLM, LM Studio, Ollama) support strict JSON schema responses.
        supportsStructuredOutputs: true,
      });
      return provider(config.aiModel);
    }
  }
}

/**
 * Returns the household's provider's own hosted web-search tool, when it has
 * one. Only Anthropic, OpenAI, and Google ship a provider-executed search
 * tool through the AI SDK — "openrouter" and "custom" (OpenAI-compatible/local models) have no
 * standard equivalent, so callers get null and fall back to no live search.
 * Used only by the Savings Advisor's opt-in deals search (see
 * lib/ai/savings/deals.ts) — never enabled for chat or categorization.
 */
export function createUserSearchTool(config: ProviderConfig): Tool | null {
  switch (config.aiProvider) {
    case "anthropic": {
      const provider = createAnthropic({ apiKey: config.aiApiKey });
      return provider.tools.webSearch_20250305({ maxUses: 5 });
    }
    case "openai": {
      const provider = createOpenAI({ apiKey: config.aiApiKey });
      return provider.tools.webSearch({ searchContextSize: "medium" });
    }
    case "google": {
      const provider = createGoogleGenerativeAI({ apiKey: config.aiApiKey });
      return provider.tools.googleSearch({});
    }
    // OpenRouter is OpenAI-compatible but exposes no provider-executed search
    // tool through the AI SDK, so it falls back the same way "custom" does.
    case "openrouter":
    case "custom":
      return null;
  }
}
