import assert from "node:assert/strict";
import test from "node:test";
import {
  buildQuizRounds,
  getNextReviewDays,
  getStudyDefinition,
  getStudyTerm,
  shuffleItems,
} from "../lib/study/engine.ts";
import type { StudyQuestion } from "../lib/study/types.ts";

const question: StudyQuestion = {
  id: "question-1",
  position: 0,
  prompt: "Từ “hello” có nghĩa là gì?",
  options: ["Tạm biệt", "Xin chào", "Cảm ơn", "Xin lỗi"],
  correct_option: 1,
  review_stage: 0,
  known_count: 0,
  again_count: 0,
  next_review_at: null,
  last_reviewed_at: null,
  is_due: true,
};

test("maps a multiple-choice question to a term-definition card", () => {
  assert.equal(getStudyTerm(question), "Xin chào");
  assert.equal(getStudyDefinition(question), "Từ “hello” có nghĩa là gì?");
});

test("shuffle is deterministic with an injected random source and does not mutate input", () => {
  const source = [1, 2, 3, 4];
  const shuffled = shuffleItems(source, () => 0);
  assert.deepEqual(source, [1, 2, 3, 4]);
  assert.deepEqual(shuffled, [2, 3, 4, 1]);
});

test("quiz rounds retain original option indexes after shuffling", () => {
  const [round] = buildQuizRounds([question], () => 0);
  const correct = round.options.find((option) => option.originalIndex === round.question.correct_option);
  assert.equal(correct?.text, "Xin chào");
  assert.deepEqual(round.options.map((option) => option.originalIndex), [1, 2, 3, 0]);
});

test("spaced repetition advances through the configured intervals", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(getNextReviewDays), [1, 3, 7, 14, 30, 30]);
});
