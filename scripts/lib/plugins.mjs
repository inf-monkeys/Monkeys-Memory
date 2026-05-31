import path from "node:path";
import { pathExists } from "./utils.mjs";

export async function loadCompilerPlugins(projectRoot, config) {
  const pluginSpecs = config.plugins ?? [];
  const plugins = [];
  for (const spec of pluginSpecs) {
    const pluginPath = path.isAbsolute(spec) ? spec : path.join(projectRoot, spec);
    if (!(await pathExists(pluginPath))) continue;
    const mod = await import(`${pluginPath}?t=${Date.now()}`);
    const plugin = mod.default ?? mod;
    plugins.push({ name: plugin.name ?? path.basename(pluginPath), path: pluginPath, plugin });
  }
  return plugins;
}

export async function runPluginHook(plugins, hookName, payload, context = {}) {
  let current = payload;
  for (const entry of plugins) {
    const plugin = entry.plugin ?? entry;
    if (typeof plugin[hookName] === "function") {
      try {
        current = await plugin[hookName](current, {
          ...context,
          hook: hookName,
          plugin: { name: entry.name ?? plugin.name ?? "anonymous", path: entry.path ?? null },
        });
      } catch (error) {
        throw new Error(`Plugin ${entry.name ?? plugin.name ?? "anonymous"} failed in ${hookName}: ${error.message}`);
      }
    }
  }
  return current;
}

export function createNoopEmbeddingProvider() {
  return {
    name: "noop",
    async embed(text) {
      const values = Array.from(text).slice(0, 16).map((char) => (char.charCodeAt(0) % 31) / 31);
      while (values.length < 16) values.push(0);
      return values;
    },
  };
}

const DEFAULT_VECTOR_DIMENSIONS = 64;

function tokenize(text) {
  return String(text ?? "")
    .toLowerCase()
    .split(/[^a-z0-9_.$:/-]+/)
    .filter((token) => token.length > 1);
}

function hashToken(token, dimensions) {
  let hash = 2166136261;
  for (let i = 0; i < token.length; i += 1) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % dimensions;
}

export function createLocalEmbeddingProvider(options = {}) {
  const dimensions = Math.max(8, Number(options.dimensions ?? DEFAULT_VECTOR_DIMENSIONS));
  return {
    name: `local-hash-${dimensions}`,
    dimensions,
    async embed(text) {
      const vector = Array(dimensions).fill(0);
      const tokens = tokenize(text);
      for (const token of tokens) {
        vector[hashToken(token, dimensions)] += 1;
      }
      const norm = Math.sqrt(vector.reduce((total, value) => total + value * value, 0));
      return norm === 0 ? vector : vector.map((value) => Number((value / norm).toFixed(6)));
    },
  };
}

export async function createEmbeddingProvider(projectRoot, config) {
  const embeddingConfig = config.embedding ?? {};
  if (!embeddingConfig.enabled) return null;
  if (embeddingConfig.provider === "noop") return createNoopEmbeddingProvider();
  if (embeddingConfig.provider === "plugin" && embeddingConfig.plugin) {
    const pluginPath = path.isAbsolute(embeddingConfig.plugin)
      ? embeddingConfig.plugin
      : path.join(projectRoot, embeddingConfig.plugin);
    if (await pathExists(pluginPath)) {
      const mod = await import(`${pluginPath}?t=${Date.now()}`);
      const factory = mod.createEmbeddingProvider ?? mod.default?.createEmbeddingProvider ?? mod.default;
      if (typeof factory === "function") return factory(embeddingConfig);
    }
  }
  return createLocalEmbeddingProvider(embeddingConfig);
}
