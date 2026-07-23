import assert from "node:assert/strict";
import test from "node:test";
import { parseQuestionText } from "../lib/question-import.ts";

test("parses a multiline Vietnamese question", () => {
  const result = parseQuestionText(`
    Câu 1: Từ “hello” có nghĩa là gì?
    A. Xin chào
    B. Tạm biệt
    C. Cảm ơn
    D. Xin lỗi
    Đáp án: A
  `);

  assert.equal(result.errors.length, 0);
  assert.equal(result.questions.length, 1);
  assert.equal(result.questions[0].prompt, "Từ “hello” có nghĩa là gì?");
  assert.deepEqual(result.questions[0].options, ["Xin chào", "Tạm biệt", "Cảm ơn", "Xin lỗi"]);
  assert.equal(result.questions[0].correct_option, 0);
});

test("parses compact questions and lowercase option markers", () => {
  const result = parseQuestionText(
    "Câu 1: abccdedd. a.alo b.hello c.bye. d.good. Đáp án: b Câu 2: 2 + 2? a.3 b.4 c.5 d.6 ĐA: B",
  );

  assert.equal(result.errors.length, 0);
  assert.equal(result.questions.length, 2);
  assert.deepEqual(result.questions[0].options, ["alo", "hello", "bye.", "good."]);
  assert.equal(result.questions[0].correct_option, 1);
  assert.equal(result.questions[1].correct_option, 1);
});

test("accepts a star before the correct option", () => {
  const result = parseQuestionText("Câu 1: Chọn màu lá cây A. Đỏ *B. Xanh C. Tím D. Đen");

  assert.equal(result.errors.length, 0);
  assert.equal(result.questions[0].correct_option, 1);
});

test("rejects questions without a declared correct answer", () => {
  const result = parseQuestionText("Câu 1: Chọn đáp án A. Một B. Hai C. Ba D. Bốn");

  assert.equal(result.questions.length, 0);
  assert.match(result.errors[0].message, /Chưa có đáp án đúng/);
});

test("parses a per-question time directive", () => {
  const result = parseQuestionText(
    "Câu 1: Từ hello nghĩa là gì? A. Xin chào B. Tạm biệt C. Cảm ơn D. Xin lỗi Đáp án: A Thời gian: 35 giây",
  );

  assert.equal(result.errors.length, 0);
  assert.equal(result.questions[0].time_limit_seconds, 35);
  assert.equal(result.questions[0].options[3], "Xin lỗi");
});

test("rejects an invalid per-question time", () => {
  const result = parseQuestionText("Câu 1: Chọn A A. Một B. Hai C. Ba D. Bốn Đáp án: A Thời gian: 3");

  assert.equal(result.questions.length, 0);
  assert.match(result.errors[0].message, /5 đến 120 giây/);
});
