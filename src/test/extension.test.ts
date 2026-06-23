import * as assert from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { findNearestVenv } from "../extension";

suite("findNearestVenv", () => {
  let root: string;

  setup(() => {
    root = mkdtempSync(join(tmpdir(), "pes-test-"));
  });

  teardown(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /** Create a POSIX-style venv (bin/python) at `<dir>/<name>`. */
  function makeVenv(dir: string, name = ".venv"): string {
    const venv = join(dir, name);
    mkdirSync(join(venv, "bin"), { recursive: true });
    writeFileSync(join(venv, "bin", "python"), "");
    return venv;
  }

  test("finds a venv in the file's own directory", async () => {
    const venv = makeVenv(root);
    const file = join(root, "main.py");
    assert.strictEqual(await findNearestVenv(file, root, ".venv"), venv);
  });

  test("walks up to an ancestor venv", async () => {
    const venv = makeVenv(root);
    const sub = join(root, "pkg", "deep");
    mkdirSync(sub, { recursive: true });
    const file = join(sub, "main.py");
    assert.strictEqual(await findNearestVenv(file, root, ".venv"), venv);
  });

  test("returns the nearest venv when several ancestors have one", async () => {
    makeVenv(root);
    const sub = join(root, "pkg");
    const nearest = makeVenv(sub);
    const file = join(sub, "main.py");
    assert.strictEqual(await findNearestVenv(file, root, ".venv"), nearest);
  });

  test("stops at the workspace root and returns undefined when none found", async () => {
    const sub = join(root, "pkg");
    mkdirSync(sub, { recursive: true });
    const file = join(sub, "main.py");
    assert.strictEqual(await findNearestVenv(file, root, ".venv"), undefined);
  });

  test("honours a custom venv name", async () => {
    const venv = makeVenv(root, "env");
    const file = join(root, "main.py");
    assert.strictEqual(await findNearestVenv(file, root, "env"), venv);
    assert.strictEqual(await findNearestVenv(file, root, ".venv"), undefined);
  });
});
