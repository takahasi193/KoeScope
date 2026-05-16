import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createApp, resolveFrontendPage } from "../src/server.js";

test("resolveFrontendPage supports exported flat and folder html output", async (t) => {
  const outRoot = await fs.mkdtemp(path.join(os.tmpdir(), "koescope-next-out-"));
  t.after(() => fs.rm(outRoot, { recursive: true, force: true }));
  await fs.mkdir(path.join(outRoot, "person"), { recursive: true });
  await fs.writeFile(path.join(outRoot, "dashboard.html"), "dashboard");
  await fs.writeFile(path.join(outRoot, "person", "index.html"), "person");

  assert.equal(resolveFrontendPage(outRoot, "dashboard"), path.join(outRoot, "dashboard.html"));
  assert.equal(resolveFrontendPage(outRoot, "person.html"), path.join(outRoot, "person", "index.html"));
  assert.equal(resolveFrontendPage(outRoot, "missing"), "");
});

test("server serves Next static pages before legacy public html when output exists", async (t) => {
  const outRoot = await fs.mkdtemp(path.join(os.tmpdir(), "koescope-next-route-"));
  t.after(() => fs.rm(outRoot, { recursive: true, force: true }));
  await fs.mkdir(path.join(outRoot, "dashboard", "__next.dashboard"), { recursive: true });
  await fs.writeFile(path.join(outRoot, "dashboard.html"), "<!doctype html><p>Next dashboard</p>");
  await fs.writeFile(path.join(outRoot, "dashboard", "__next.dashboard", "__PAGE__.txt"), "dashboard payload");

  const previous = process.env.KOESCOPE_NEXT_OUT;
  process.env.KOESCOPE_NEXT_OUT = outRoot;
  t.after(() => {
    if (previous === undefined) delete process.env.KOESCOPE_NEXT_OUT;
    else process.env.KOESCOPE_NEXT_OUT = previous;
  });

  const app = createApp({ monitor: {}, searchHistory: {}, searchJobStore: {} });
  const server = app.listen(0);
  t.after(() => server.close());
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();

  const response = await fetch(`http://127.0.0.1:${port}/dashboard.html`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Next dashboard/);

  const payload = await fetch(`http://127.0.0.1:${port}/dashboard/__next.dashboard.__PAGE__.txt`);
  assert.equal(payload.status, 200);
  assert.equal(await payload.text(), "dashboard payload");
});
