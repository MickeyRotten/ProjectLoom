import { useEffect, useState } from "react";
import { fetchModels, type OpenRouterModel } from "../lib/openrouter";

/**
 * The OpenRouter model catalog, fetched once and shared by the Setup screen and
 * Model & Key. Lives in a hook rather than each screen so the two can never
 * disagree about what "loading" or "the list failed" looks like.
 */
export function useModelCatalog(): {
  models: OpenRouterModel[];
  loading: boolean;
  error: string | null;
} {
  const [models, setModels] = useState<OpenRouterModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    fetchModels(ctrl.signal)
      .then(setModels)
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Could not load model list.");
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, []);

  return { models, loading, error };
}

/** Split the catalog the way the two model fields need it. */
export function splitModels(models: OpenRouterModel[]): {
  text: OpenRouterModel[];
  image: OpenRouterModel[];
} {
  const image = models.filter((m) => m.outputModalities.includes("image"));
  const text = models.filter((m) => !m.outputModalities.includes("image"));
  return { text, image };
}
