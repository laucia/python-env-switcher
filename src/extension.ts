import { existsSync } from "node:fs";
import { basename, dirname, join, parse } from "node:path";

import * as vscode from "vscode";

import { getEnvExtApi } from "./getEnvExtApi";
import type {
  PythonEnvironment,
  SetEnvironmentScope,
} from "./pythonEnvsApi.types";

const CONFIG_SECTION = "pythonEnvSwitcher";

let output: vscode.OutputChannel;
// Monotonic token so a slower in-flight switch can't clobber a newer one.
let runSeq = 0;

function log(message: string): void {
  const ts = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
  output.appendLine(`${ts} ${message}`);
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

/** A directory is a venv if it holds a python executable (POSIX or Windows). */
function isVenvDir(dir: string): boolean {
  return (
    existsSync(join(dir, "bin", "python")) ||
    existsSync(join(dir, "Scripts", "python.exe"))
  );
}

/**
 * Walk up from the file's directory to the nearest ancestor containing a
 * `<venvName>` directory, stopping at (and including) the workspace-folder root.
 * Returns the venv directory path, or undefined if none is found.
 */
export function findNearestVenv(
  fileFsPath: string,
  workspaceRoot: string | undefined,
  venvName: string,
): string | undefined {
  let dir = dirname(fileFsPath);
  for (;;) {
    const candidate = join(dir, venvName);
    if (isVenvDir(candidate)) {
      return candidate;
    }
    if (workspaceRoot !== undefined && dir === workspaceRoot) {
      return undefined; // checked the workspace root; stop here
    }
    const parent = dirname(dir);
    if (parent === dir || parent === parse(dir).root) {
      // Reached the filesystem root; check it once then stop.
      const atRoot = join(parent, venvName);
      return isVenvDir(atRoot) ? atRoot : undefined;
    }
    dir = parent;
  }
}

async function switchForEditor(
  editor: vscode.TextEditor | undefined,
): Promise<void> {
  if (!editor) {
    log("skip: no active editor");
    return;
  }
  if (editor.document.languageId !== "python") {
    log(`skip: not python (languageId=${editor.document.languageId}) ${editor.document.uri.fsPath}`);
    return;
  }
  const seq = ++runSeq;
  const { venvName, scope: scopeSetting, showNotifications } = readSettings();
  const fileUri = editor.document.uri;
  if (fileUri.scheme !== "file") {
    log(`skip: non-file scheme '${fileUri.scheme}'`);
    return;
  }
  log(`active: ${fileUri.fsPath} (scope=${scopeSetting}, venvName=${venvName})`);

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(fileUri);
  const venvDir = findNearestVenv(
    fileUri.fsPath,
    workspaceFolder?.uri.fsPath,
    venvName,
  );
  if (!venvDir) {
    log(`  no '${venvName}' found walking up to ${workspaceFolder?.uri.fsPath ?? "<fs root>"}; leaving env unchanged`);
    return;
  }
  log(`  nearest venv: ${venvDir}`);

  try {
    const api = await getEnvExtApi();

    // Resolve the venv folder to an environment; fall back to the interpreter.
    let env: PythonEnvironment | undefined = await api.resolveEnvironment(
      vscode.Uri.file(venvDir),
    );
    if (!env) {
      const interpreter = existsSync(join(venvDir, "bin", "python"))
        ? join(venvDir, "bin", "python")
        : join(venvDir, "Scripts", "python.exe");
      log(`  folder did not resolve; trying interpreter ${interpreter}`);
      env = await api.resolveEnvironment(vscode.Uri.file(interpreter));
    }
    if (!env) {
      log(`  could not resolve an environment at ${venvDir}`);
      return;
    }
    log(`  resolved env: ${env.displayName} (${env.envId.id})`);

    // A newer editor change superseded this run while we were awaiting.
    if (seq !== runSeq) {
      log("  superseded by a newer editor change; aborting");
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
    log(`  scope: ${scopeDesc} → ${scopeUri?.fsPath ?? "<global>"}`);

    const current = await api.getEnvironment(scopeUri);
    log(`  current env for scope: ${current ? `${current.displayName} (${current.envId.id})` : "<none>"}`);
    if (current?.envId.id === env.envId.id) {
      log("  already correct → no change");
      return;
    }

    if (seq !== runSeq) {
      log("  superseded before set; aborting");
      return;
    }
    await api.setEnvironment(scope, env);
    log(`  ✓ setEnvironment(${scopeUri?.fsPath ?? "<global>"}) → ${env.displayName} (${env.envId.id})`);
    if (showNotifications) {
      vscode.window.showInformationMessage(
        `Python Env Switcher: Python env → ${env.displayName}`,
      );
    }
  } catch (err) {
    log(`  error: ${String(err)}`);
  }
}

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel("Python Env Switcher");
  context.subscriptions.push(output);
  log("activated");

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      log(`event: onDidChangeActiveTextEditor → ${editor?.document.uri.fsPath ?? "<none>"}`);
      void switchForEditor(editor);
    }),
  );

  log("running initial switch for the current active editor");
  void switchForEditor(vscode.window.activeTextEditor);
}

export function deactivate(): void {
  // OutputChannel disposed via context.subscriptions.
}
