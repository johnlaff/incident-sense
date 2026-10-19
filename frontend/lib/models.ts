// The chat models the UI can pick. Each id maps server-side to a real
// OpenRouter model (SELECTABLE_MODELS in backend/src/incident_sense/config.py);
// unknown ids fall back to the default, Claude Haiku 5.5.
export interface ModelOption {
  id: string;
  name: string;
  desc: string;
}

export const MODELS: ModelOption[] = [
  {
    id: "claude-haiku",
    name: "Claude Haiku 5.5",
    desc: "Padrão: rápido, preciso no formato e barato",
  },
  {
    id: "gpt-luna",
    name: "GPT-6 Luna",
    desc: "Modelo pequeno da OpenAI, mesmo custo do Haiku",
  },
  {
    id: "gemini-flash",
    name: "Gemini 3.8 Flash",
    desc: "Mais caro, bom em textos longos",
  },
  {
    id: "deepseek-flash",
    name: "DeepSeek V4.1 Flash",
    desc: "O mais barato da lista",
  },
  {
    id: "qwen-flash",
    name: "Qwen 3.7 Flash",
    desc: "Alternativa aberta e econômica",
  },
];

export const DEFAULT_MODEL = MODELS[0].id;

export function modelName(id: string): string {
  return MODELS.find((m) => m.id === id)?.name ?? id;
}

/** Friendly name for a real OpenRouter id echoed back by the API. */
export function modelNameFromRoute(route: string): string {
  const known: Record<string, string> = {
    "anthropic/claude-haiku-5.5": "Claude Haiku 5.5",
    "openai/gpt-6-luna": "GPT-6 Luna",
    "google/gemini-3.8-flash": "Gemini 3.8 Flash",
    "deepseek/deepseek-v4.1-flash": "DeepSeek V4.1 Flash",
    "qwen/qwen3.7-flash": "Qwen 3.7 Flash",
  };
  return known[route] ?? route;
}
