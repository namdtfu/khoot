export type UserRole = "admin" | "student";

export type UserProfile = {
  id: string;
  role: UserRole;
};

export type StudyMode = "overview" | "flashcards" | "quiz" | "review";

export type StudySetSummary = {
  id: string;
  title: string;
  topic: string;
  description: string;
  question_count: number;
  learned_count: number;
  due_count: number;
  updated_at: string;
};

export type StudyQuestion = {
  id: string;
  position: number;
  prompt: string;
  options: string[];
  correct_option: number;
  review_stage: number;
  known_count: number;
  again_count: number;
  next_review_at: string | null;
  last_reviewed_at: string | null;
  is_due: boolean;
};

export type StudySetDetail = {
  id: string;
  title: string;
  topic: string;
  description: string;
  questions: StudyQuestion[];
};

export type StudyReviewRating = "again" | "known";

export type StudyReviewResult = {
  question_id: string;
  review_stage: number;
  known_count: number;
  again_count: number;
  next_review_at: string;
  last_reviewed_at: string;
};

export type QuizOption = {
  originalIndex: number;
  text: string;
};

export type QuizRound = {
  question: StudyQuestion;
  options: QuizOption[];
};
