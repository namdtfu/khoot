import { supabase } from "@/lib/supabase";
import { getErrorMessage } from "@/lib/game";
import type {
  StudyReviewRating,
  StudyReviewResult,
  StudySetDetail,
  StudySetSummary,
  UserProfile,
} from "./types";

function unwrap<T>(data: T | null, error: unknown) {
  if (error) throw new Error(getErrorMessage(error));
  return data as T;
}

export async function getMyProfile() {
  const { data, error } = await supabase.rpc("get_my_profile");
  return unwrap<UserProfile>(data as UserProfile | null, error);
}

export async function listStudySets() {
  const { data, error } = await supabase.rpc("list_study_sets");
  return unwrap<StudySetSummary[]>((data ?? []) as StudySetSummary[], error);
}

export async function getStudySet(setId: string) {
  const { data, error } = await supabase.rpc("get_study_set", { p_set_id: setId });
  return unwrap<StudySetDetail>(data as StudySetDetail | null, error);
}

export async function recordStudyReview(questionId: string, rating: StudyReviewRating) {
  const { data, error } = await supabase.rpc("record_study_review", {
    p_question_id: questionId,
    p_rating: rating,
  });
  return unwrap<StudyReviewResult>(data as StudyReviewResult | null, error);
}

export async function resetStudySetProgress(setId: string) {
  const { error } = await supabase.rpc("reset_study_set_progress", { p_set_id: setId });
  if (error) throw new Error(getErrorMessage(error));
}

export async function updateMyPassword(password: string) {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw new Error(getErrorMessage(error));
}
