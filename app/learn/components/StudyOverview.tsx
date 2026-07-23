"use client";

import { formatReviewDate, getStudyDefinition, getStudyTerm } from "@/lib/study/engine";
import type { StudyMode, StudySetDetail } from "@/lib/study/types";
import styles from "../learn.module.css";

type Props = {
  studySet: StudySetDetail;
  resetting: boolean;
  onBack: () => void;
  onChooseMode: (mode: Exclude<StudyMode, "overview">) => void;
  onReset: () => void;
};

export default function StudyOverview({ studySet, resetting, onBack, onChooseMode, onReset }: Props) {
  const dueCount = studySet.questions.filter((question) => question.is_due).length;
  const learnedCount = studySet.questions.filter((question) => question.review_stage > 0).length;

  return (
    <>
      <button className={styles.backButton} onClick={onBack}>← Thư viện</button>
      <section className={styles.setHero}>
        <div>
          <span className={styles.eyebrow}>{studySet.topic}</span>
          <h1>{studySet.title}</h1>
          <p>{studySet.description || "Chọn một chế độ để bắt đầu học."}</p>
        </div>
        <div className={styles.setHeroStats}>
          <span><b>{studySet.questions.length}</b> thuật ngữ</span>
          <span><b>{learnedCount}</b> đã học</span>
          <span className={dueCount ? styles.dueText : ""}><b>{dueCount}</b> đến hạn</span>
        </div>
      </section>

      <section className={styles.modeGrid}>
        <button className={styles.modeCard} onClick={() => onChooseMode("flashcards")}>
          <span className={styles.modeNumber}>01</span>
          <i className={styles.flashIcon}>Aa</i>
          <div><strong>Flashcard</strong><p>Lật thẻ, đánh dấu đã thuộc hoặc đưa thẻ chưa nhớ về cuối hàng.</p></div>
          <b>Bắt đầu →</b>
        </button>
        <button className={styles.modeCard} onClick={() => onChooseMode("quiz")}>
          <span className={styles.modeNumber}>02</span>
          <i className={styles.quizIcon}>4</i>
          <div><strong>Trắc nghiệm</strong><p>Luyện toàn bộ bộ đề với bốn lựa chọn và xem kết quả ngay.</p></div>
          <b>Bắt đầu →</b>
        </button>
        <button className={styles.modeCard} onClick={() => onChooseMode("review")}>
          <span className={styles.modeNumber}>03</span>
          <i className={styles.reviewIcon}>↻</i>
          <div><strong>Ôn cách quãng</strong><p>Chọn thuộc hoặc chưa thuộc để Khoot tính ngày cần ôn lại.</p></div>
          <b>{dueCount ? "Ôn " + dueCount + " thẻ →" : "Xem lịch ôn →"}</b>
        </button>
      </section>

      <section className={styles.termSection}>
        <div className={styles.sectionHeading}>
          <div><span className={styles.eyebrow}>THUẬT NGỮ — ĐỊNH NGHĨA</span><h2>Nội dung bộ đề</h2></div>
          {learnedCount > 0 && <button className={styles.resetButton} disabled={resetting} onClick={onReset}>{resetting ? "Đang đặt lại…" : "Đặt lại tiến độ"}</button>}
        </div>
        <div className={styles.termTable}>
          {studySet.questions.map((question, index) => (
            <article key={question.id}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{getStudyTerm(question)}</strong>
              <p>{getStudyDefinition(question)}</p>
              <small>{question.review_stage > 0 ? formatReviewDate(question.next_review_at) : "Chưa học"}</small>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
