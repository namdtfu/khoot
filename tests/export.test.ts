import assert from "node:assert/strict";
import test from "node:test";
import { gameHistoryToCsv, safeFilename } from "../lib/export.ts";
import type { GameSnapshot } from "../lib/game.ts";

test("exports the answer matrix as UTF-8 CSV", () => {
  const snapshot = {
    room: { title: "Bộ từ vựng" },
    players: [
      { id: "p1", name: "An", score: 1200 },
      { id: "p2", name: "Bình", score: 900 },
    ],
    history: [{
      id: "q1",
      position: 0,
      prompt: "Hello nghĩa là gì?",
      options: ["Xin chào", "Tạm biệt", "Cảm ơn", "Xin lỗi"],
      correct_option: 0,
      answers: [
        { player_id: "p1", selected_option: 0, is_correct: true },
        { player_id: "p2", selected_option: 1, is_correct: false },
      ],
    }],
  } as GameSnapshot;

  const csv = gameHistoryToCsv(snapshot);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.match(csv, /"Đúng: Xin chào"/);
  assert.match(csv, /"Sai: Tạm biệt"/);
  assert.match(csv, /"Tổng điểm"/);
});

test("creates a safe Vietnamese backup filename", () => {
  assert.equal(safeFilename("Bộ đề Tiếng Anh #1"), "bo-de-tieng-anh-1");
});
