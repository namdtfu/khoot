"use client";

import { useMemo, useState } from "react";
import {
  formatReviewDate,
  getNextReviewLabel,
  getStudyDefinition,
  getStudyTerm,
  shuffleItems,
} from "@/lib/study/engine";
import type {
  StudyQuestion,
  StudyReviewRating,
  StudyReviewResult,
  StudySetDetail,
} from "@/lib/study/types";
import styles from "../learn.module.css";

type Props = {
  studySet: StudySetDetail;
  onBack: () => void;
  onReview: (questionId: string, rating: StudyReviewRating) => Promise<StudyReviewResult>;
  onProgressChange: (result: StudyReviewResult) => void;
};

export default function SpacedReviewMode({ studySet, onBack, onReview, onProgressChange }: Props) {
  const [questions, setQuestions] = useState<StudyQuestion[]>(studySet.questions);
  const [queue, setQueue] = useState<string[]>(() => shuffleItems(
    studySet.questions.filter((question) => question.is_due).map((question) => question.id),
  ));
  const [flipped, setFlipped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reviewed, setReviewed] = useState(0);
  const current = questions.find((question) => question.id === queue[0]);
  const dueAtStart = studySet.questions.filter((question) => question.is_due).length;

  const nextReview = useMemo(() => {
    const future = questions
      .map((question) => question.next_review_at)
      .filter((value): value is string => Boolean(value))
      .sort((left, right) => new Date(left).getTime() - new Date(right).getTime());
    return future[0] ?? null;
  }, [questions]);

  const review = async (rating: StudyReviewRating) => {
    if (!current || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await onReview(current.id, rating);
      setQuestions((items) => items.map((question) => question.id === current.id ? {
        ...question,
        review_stage: result.review_stage,
        known_count: result.known_count,
        again_count: result.again_count,
        next_review_at: result.next_review_at,
        last_reviewed_at: result.last_reviewed_at,
        is_due: false,
      } : question));
      setQueue((items) => items.slice(1));
      setFlipped(false);
      setReviewed((value) => value + 1);
      onProgressChange(result);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusy(false);
    }
  };

  const reviewAll = () => {
    setQueue(shuffleItems(questions.map((question) => question.id)));
    setReviewed(0);
    setFlipped(false);
  };

  return (
    <section className={styles.studyMode}>
      <div className={styles.modeHeader}>
        <button onClick={onBack}>← Chọn chế độ</button>
        <div><span className={styles.eyebrow}>ÔN CÁCH QUÃNG</span><strong>{studySet.title}</strong></div>
        <span>{queue.length} thẻ còn lại</span>
      </div>
      <div className={styles.modeProgress}><i style={{ width: (dueAtStart ? reviewed / dueAtStart * 100 : 100) + "%" }} /></div>

      {current ? (
        <>
          <div className={styles.reviewSchedule}>
            <span>HỘP {current.review_stage + 1}/6</span>
            <strong>{current.review_stage > 0 ? "Lần ôn trước: " + formatReviewDate(current.last_reviewed_at) : "Thuật ngữ mới"}</strong>
          </div>
          <button className={styles.reviewCard} onClick={() => setFlipped((value) => !value)}>
            <span>{flipped ? "ĐỊNH NGHĨA / CÂU HỎI" : "THUẬT NGỮ / ĐÁP ÁN"}</span>
            <strong>{flipped ? getStudyDefinition(current) : getStudyTerm(current)}</strong>
            {!flipped && <small>Nhấn vào thẻ để xem định nghĩa</small>}
          </button>
          {error && <p className={styles.error}>{error}</p>}
          {flipped ? (
            <div className={styles.reviewActions}>
              <button className={styles.againButton} disabled={busy} onClick={() => void review("again")}>
                <span>Chưa thuộc</span><small>ôn lại sau 10 phút</small>
              </button>
              <button className={styles.knownButton} disabled={busy} onClick={() => void review("known")}>
                <span>Đã thuộc</span><small>ôn lại {getNextReviewLabel(current.review_stage)}</small>
              </button>
            </div>
          ) : (
            <p className={styles.keyboardHelp}>Tự nhớ câu trả lời trước, sau đó lật thẻ và đánh giá mức độ ghi nhớ.</p>
          )}
        </>
      ) : (
        <div className={styles.modeComplete}>
          <span>↻</span>
          <h2>{reviewed > 0 ? "Đã ôn xong hôm nay" : "Hôm nay chưa có thẻ đến hạn"}</h2>
          <p>{nextReview ? "Lần ôn gần nhất: " + formatReviewDate(nextReview) : "Bắt đầu học để Khoot tạo lịch ôn cho bạn."}</p>
          <div>
            <button onClick={onBack}>Về bộ đề</button>
            <button className={styles.primaryAction} onClick={reviewAll}>Ôn tự do toàn bộ</button>
          </div>
        </div>
      )}
    </section>
  );
}
