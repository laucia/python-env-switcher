# Python Env Switcher

A small VS Code extension that **switches the selected Python environment to the
`.venv` that owns the active file**, so Pylance / debug / run track the right
per-project virtual environment as you move between files in the monorepo.

## Why this and not `teticio/python-envy`

python-envy switches via the **legacy** `ms-python.python` API
(`environments.updateActiveEnvironmentPath`). With the **Python Environments**
extension (`ms-python.vscode-python-envs`) enabled, that extension becomes the
source of truth Pylance reads — so the legacy write updates the status bar but
doesn't reliably move Pylance. This extension switches through
`PythonEnvironmentApi.setEnvironment(...)`, the path Pylance actually follows.

## How it works

On the active editor changing (and on startup), for a Python file it:

1. Walks **up** from the file's directory to the nearest `<venvName>` (default
   `.venv`), stopping at the workspace-folder root.
2. Resolves that venv to a `PythonEnvironment` via `resolveEnvironment`.
3. Sets it via `setEnvironment(scope, env)` — `scope` defaults to the whole
   workspace folder, or the containing Python project / the file itself
   (`pythonEnvSwitcher.scope`).

A dedupe check (`getEnvironment` → compare `envId.id`) avoids redundant switches.
Decisions are logged to the **"Python Env Switcher"** output channel.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `pythonEnvSwitcher.venvName` | `.venv` | venv directory name to search for |
| `pythonEnvSwitcher.scope` | `workspaceFolder` | `setEnvironment` scope: `workspaceFolder`, `project`, or `file` |
| `pythonEnvSwitcher.showNotifications` | `false` | notify on each switch |

## Known limitation

Pylance runs one analysis service per workspace folder, so switching the env
flips that folder's whole analysis at once (with a reindex) — correct for "use
the active file's venv," but it can't analyse two subtrees against two venvs
simultaneously. That remains a multi-root-workspace feature.

## Develop / run

```sh
npm install
npm run check-types
npm run compile          # esbuild bundle -> dist/extension.js
# Iterate: launch an Extension Development Host
code --extensionDevelopmentPath="$(pwd)" .
# Package a vsix for install:
npm run package          # -> python-env-switcher.vsix
```

Requires the `ms-python.vscode-python-envs` extension (declared as an
`extensionDependency`, so VS Code installs it automatically).
