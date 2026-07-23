import type { QuizRound, StudyQuestion } from "./types";

export function getStudyTerm(question: StudyQuestion) {
  return question.options[question.correct_option] ?? "";
}

export function getStudyDefinition(question: StudyQuestion) {
  return question.prompt;
}

export function shuffleItems<T>(items: readonly T[], random: () => number = Math.random) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

export function buildQuizRounds(
  questions: readonly StudyQuestion[],
  random: () => number = Math.random,
): QuizRound[] {
  return shuffleItems(questions, random).map((question) => ({
    question,
    options: shuffleItems(
      question.options.map((text, originalIndex) => ({ originalIndex, text })),
      random,
    ),
  }));
}

export function getNextReviewDays(currentStage: number) {
  const nextStage = Math.min(Math.max(currentStage, 0) + 1, 5);
  return [0, 1, 3, 7, 14, 30][nextStage];
}

export function getNextReviewLabel(currentStage: number) {
  const days = getNextReviewDays(currentStage);
  return days === 1 ? "ngày mai" : "sau " + days + " ngày";
}

export function formatReviewDate(value: string | null) {
  if (!value) return "Sẵn sàng ôn";
  const date = new Date(value);
  if (date.getTime() <= Date.now()) return "Đến hạn hôm nay";
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}
