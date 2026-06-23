import * as vscode from "vscode";

import type { PythonEnvironmentApi } from "./pythonEnvsApi.types";

const ENV_EXTENSION_ID = "ms-python.vscode-python-envs";

let cached: PythonEnvironmentApi | undefined;

/**
 * Acquire the Python Environments extension API, activating it if needed.
 * Modelled on the upstream sample (`examples/sample1/src/pythonEnvsApi.ts`).
 *
 * This extension declares `ms-python.vscode-python-envs` as an
 * `extensionDependency`, so the extension is guaranteed present and installed
 * in the same extension host — but it may not be activated yet when we run.
 */
export async function getEnvExtApi(): Promise<PythonEnvironmentApi> {
  if (cached) {
    return cached;
  }
  const extension =
    vscode.extensions.getExtension<PythonEnvironmentApi>(ENV_EXTENSION_ID);
  if (!extension) {
    throw new Error(
      `Extension '${ENV_EXTENSION_ID}' not found; it is a declared dependency.`,
    );
  }
  cached = extension.isActive
    ? extension.exports
    : await extension.activate();
  return cached;
}
