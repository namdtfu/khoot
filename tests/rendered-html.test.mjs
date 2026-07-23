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
  assert.match(html, /Khoot Mini — Học và thi theo cách của bạn/i);
  assert.match(html, /HỌC MỖI NGÀY/i);
  assert.match(html, /href="\/learn"/i);
  assert.match(html, /href="\/admin"/i);
});

test("build includes admin, live-game, history and self-study routes", async () => {
  const files = [
    "../app/admin/page.tsx",
    "../app/host/page.tsx",
    "../app/play/page.tsx",
    "../app/history/page.tsx",
    "../app/learn/page.tsx",
    "../supabase/migrations/202607230006_complete_classroom_workflows.sql",
    "../supabase/migrations/202607230007_create_self_study_portal.sql",
    "../supabase/migrations/202607230008_fix_admin_library_access.sql",
  ].map((path) => new URL(path, import.meta.url));

  await Promise.all(files.map((file) => access(file)));
  const historyPage = await readFile(files[3], "utf8");
  const classroomMigration = await readFile(files[5], "utf8");
  const studyMigration = await readFile(files[6], "utf8");
  const accessFixMigration = await readFile(files[7], "utf8");
  assert.match(historyPage, /list_game_history/);
  assert.match(historyPage, /gameHistoryToCsv/);
  assert.match(classroomMigration, /pause_game/);
  assert.match(classroomMigration, /reclaim_game_player/);
  assert.match(classroomMigration, /duplicate_question_set/);
  assert.match(studyMigration, /create table public\.user_profiles/);
  assert.match(studyMigration, /record_study_review/);
  assert.match(studyMigration, /reset_study_set_progress/);
  assert.match(accessFixMigration, /grant execute on function public\.is_admin\(\) to authenticated/);
});
