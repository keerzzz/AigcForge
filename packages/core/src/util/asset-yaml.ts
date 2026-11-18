import YAML from "yaml"

export function parse(source: string): unknown {
  // Bun's asset parser keeps core scalars even under a YAML 1.1 directive,
  // expands merge keys, and accepts the last value of duplicate keys.
  return YAML.parse(source, { schema: "core", merge: true, uniqueKeys: false, maxAliasCount: 100 })
}

export function stringify(value: unknown) {
  return YAML.stringify(value)
}

export * as AssetYaml from "./asset-yaml"
