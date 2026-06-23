/*
 * Minimal typings for the Python Environments extension API
 * (ms-python.vscode-python-envs). This is a hand-trimmed subset of the upstream
 * `src/api.ts` from https://github.com/microsoft/vscode-python-environments
 * (MIT License, (c) Microsoft Corporation), containing only the members this
 * extension consumes. The extension publishes no typings package, so we vendor
 * the shapes we depend on. Field names match upstream so the runtime `exports`
 * object is structurally assignable to these interfaces.
 */
import type { Uri } from "vscode";

/** Unique identifier of a Python environment. */
export interface PythonEnvironmentId {
  readonly id: string;
  readonly managerId: string;
}

/** A resolved Python environment (subset of upstream PythonEnvironmentInfo). */
export interface PythonEnvironment {
  readonly envId: PythonEnvironmentId;
  readonly name: string;
  readonly displayName: string;
  /** Path to the python binary or environment folder. */
  readonly environmentPath: Uri;
}

/** A Python project: any folder/file the env extension treats as a unit. */
export interface PythonProject {
  readonly name: string;
  readonly uri: Uri;
}

/** Scope for setEnvironment: undefined (global), or a project/folder/file Uri. */
export type SetEnvironmentScope = undefined | Uri | Uri[];

/** Scope for getEnvironment: undefined (global), or a single Uri. */
export type GetEnvironmentScope = undefined | Uri;

/** Context for resolveEnvironment: a Uri to an environment folder or interpreter. */
export type ResolveEnvironmentContext = Uri;

/**
 * The subset of the Python Environments extension API used here. The real
 * `extension.exports` implements far more; this declares only what we call.
 */
export interface PythonEnvironmentApi {
  getPythonProject(uri: Uri): PythonProject | undefined;
  resolveEnvironment(
    context: ResolveEnvironmentContext,
  ): Promise<PythonEnvironment | undefined>;
  setEnvironment(
    scope: SetEnvironmentScope,
    environment?: PythonEnvironment,
  ): Promise<void>;
  getEnvironment(
    scope: GetEnvironmentScope,
  ): Promise<PythonEnvironment | undefined>;
}
