import { access } from "node:fs/promises";
import { basename, dirname, join, parse } from "node:path";

import * as vscode from "vscode";

import { getEnvExtApi } from "./getEnvExtApi";
import type {
  PythonEnvironment,
  SetEnvironmentScope,
} from "./pythonEnvsApi.types";

const CONFIG_SECTION = "pythonEnvSwitcher";

// A LogOutputChannel gives us timestamps, log levels, and a user-controllable
// verbosity (Developer: Set Log Level) for free — no hand-rolled formatting.
let log: vscode.LogOutputChannel;
// Monotonic token so a slower in-flight switch can't clobber a newer one.
let runSeq = 0;

/** True if `p` exists, without throwing or blocking the extension host. */
async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

type Scope = "workspaceFolder" | "project" | "file";

interface Settings {
  venvName: string;
  scope: Scope;
  showNotifications: boolean;
}

function readSettings(): Settings {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  return {
    venvName: cfg.get<string>("venvName", ".venv"),
    scope: cfg.get<Scope>("scope", "workspaceFolder"),
    showNotifications: cfg.get<boolean>("showNotifications", false),
  };
}

/** The python interpreter inside a venv directory (POSIX or Windows), if any. */
async function venvInterpreter(venvDir: string): Promise<string | undefined> {
  const posix = join(venvDir, "bin", "python");
  if (await pathExists(posix)) {
    return posix;
  }
  const windows = join(venvDir, "Scripts", "python.exe");
  if (await pathExists(windows)) {
    return windows;
  }
  return undefined;
}

/** A directory is a venv if it holds a python executable (POSIX or Windows). */
async function isVenvDir(dir: string): Promise<boolean> {
  return (await venvInterpreter(dir)) !== undefined;
}

/**
 * Walk up from the file's directory to the nearest ancestor containing a
 * `<venvName>` directory, stopping at (and including) the workspace-folder root.
 * Returns the venv directory path, or undefined if none is found.
 */
export async function findNearestVenv(
  fileFsPath: string,
  workspaceRoot: string | undefined,
  venvName: string,
): Promise<string | undefined> {
  let dir = dirname(fileFsPath);
  for (;;) {
    const candidate = join(dir, venvName);
    if (await isVenvDir(candidate)) {
      return candidate;
    }
    if (workspaceRoot !== undefined && dir === workspaceRoot) {
      return undefined; // checked the workspace root; stop here
    }
    const parent = dirname(dir);
    if (parent === dir || parent === parse(dir).root) {
      // Reached the filesystem root; check it once then stop.
      const atRoot = join(parent, venvName);
      return (await isVenvDir(atRoot)) ? atRoot : undefined;
    }
    dir = parent;
  }
}

async function switchForEditor(
  editor: vscode.TextEditor | undefined,
): Promise<void> {
  if (!editor) {
    log.trace("skip: no active editor");
    return;
  }
  if (editor.document.languageId !== "python") {
    log.trace(`skip: not python (languageId=${editor.document.languageId}) ${editor.document.uri.fsPath}`);
    return;
  }
  const fileUri = editor.document.uri;
  if (fileUri.scheme !== "file") {
    log.trace(`skip: non-file scheme '${fileUri.scheme}'`);
    return;
  }
  const seq = ++runSeq;
  const { venvName, scope: scopeSetting, showNotifications } = readSettings();
  log.debug(`active: ${fileUri.fsPath} (scope=${scopeSetting}, venvName=${venvName})`);

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(fileUri);
  const venvDir = await findNearestVenv(
    fileUri.fsPath,
    workspaceFolder?.uri.fsPath,
    venvName,
  );
  if (seq !== runSeq) {
    log.trace("superseded during venv lookup; aborting");
    return;
  }
  if (!venvDir) {
    log.debug(`no '${venvName}' found walking up to ${workspaceFolder?.uri.fsPath ?? "<fs root>"}; leaving env unchanged`);
    return;
  }
  log.debug(`nearest venv: ${venvDir}`);

  try {
    const api = await getEnvExtApi();

    // Resolve the venv folder to an environment; fall back to the interpreter.
    let env: PythonEnvironment | undefined = await api.resolveEnvironment(
      vscode.Uri.file(venvDir),
    );
    if (!env) {
      const interpreter = await venvInterpreter(venvDir);
      if (interpreter) {
        log.debug(`folder did not resolve; trying interpreter ${interpreter}`);
        env = await api.resolveEnvironment(vscode.Uri.file(interpreter));
      }
    }
    if (!env) {
      log.warn(`could not resolve an environment at ${venvDir}`);
      return;
    }
    log.debug(`resolved env: ${env.displayName} (${env.envId.id})`);

    // A newer editor change superseded this run while we were awaiting.
    if (seq !== runSeq) {
      log.trace("superseded by a newer editor change; aborting");
      return;
    }

    let scope: SetEnvironmentScope;
    let scopeDesc: string;
    if (scopeSetting === "file") {
      scope = fileUri;
      scopeDesc = "file";
    } else if (scopeSetting === "workspaceFolder") {
      // The scope Pylance's single per-folder service actually reads.
      scope = workspaceFolder?.uri ?? fileUri;
      scopeDesc = workspaceFolder ? "workspaceFolder" : "no workspace folder → file";
    } else {
      const project = api.getPythonProject(fileUri);
      scope = project?.uri ?? fileUri;
      scopeDesc = project
        ? `project '${project.name}' (${basename(project.uri.fsPath)})`
        : "no project → file";
    }
    const scopeUri = scope instanceof vscode.Uri ? scope : undefined;
    log.debug(`scope: ${scopeDesc} → ${scopeUri?.fsPath ?? "<global>"}`);

    const current = await api.getEnvironment(scopeUri);
    log.debug(`current env for scope: ${current ? `${current.displayName} (${current.envId.id})` : "<none>"}`);
    if (current?.envId.id === env.envId.id) {
      log.debug("already correct → no change");
      return;
    }

    if (seq !== runSeq) {
      log.trace("superseded before set; aborting");
      return;
    }
    await api.setEnvironment(scope, env);
    log.info(`switched env for ${scopeUri?.fsPath ?? "<global>"} → ${env.displayName} (${env.envId.id})`);
    if (showNotifications) {
      vscode.window.showInformationMessage(
        `Python Env Switcher: Python env → ${env.displayName}`,
      );
    }
  } catch (err) {
    log.error(err instanceof Error ? err : new Error(String(err)));
  }
}

export function activate(context: vscode.ExtensionContext): void {
  log = vscode.window.createOutputChannel("Python Env Switcher", { log: true });
  context.subscriptions.push(log);
  log.info("activated");

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      log.trace(`event: onDidChangeActiveTextEditor → ${editor?.document.uri.fsPath ?? "<none>"}`);
      void switchForEditor(editor);
    }),
  );

  log.trace("running initial switch for the current active editor");
  void switchForEditor(vscode.window.activeTextEditor);
}

export function deactivate(): void {
  // OutputChannel disposed via context.subscriptions.
}
