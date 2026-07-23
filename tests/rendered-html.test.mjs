import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost" + pathname, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the Vietnamese Khoot landing page", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html lang="vi">/i);
  assert.match(html, /Khoot Mini — Đấu trường kiến thức/i);
  assert.match(html, /TRẮC NGHIỆM REALTIME/i);
  assert.match(html, /href="\/admin"/i);
});

test("build includes the admin, live-game and history routes", async () => {
  const files = [
    "../app/admin/page.tsx",
    "../app/host/page.tsx",
    "../app/play/page.tsx",
    "../app/history/page.tsx",
    "../supabase/migrations/202607230006_complete_classroom_workflows.sql",
  ].map((path) => new URL(path, import.meta.url));

  await Promise.all(files.map((file) => access(file)));
  const historyPage = await readFile(files[3], "utf8");
  const migration = await readFile(files[4], "utf8");
  assert.match(historyPage, /list_game_history/);
  assert.match(historyPage, /gameHistoryToCsv/);
  assert.match(migration, /pause_game/);
  assert.match(migration, /reclaim_game_player/);
  assert.match(migration, /duplicate_question_set/);
});
