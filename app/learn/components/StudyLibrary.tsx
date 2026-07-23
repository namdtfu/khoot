"use client";

import type { StudySetSummary } from "@/lib/study/types";
import styles from "../learn.module.css";

type Props = {
  sets: StudySetSummary[];
  loading: boolean;
  onOpen: (setId: string) => void;
};

export default function StudyLibrary({ sets, loading, onOpen }: Props) {
  const totalTerms = sets.reduce((total, set) => total + set.question_count, 0);
  const totalLearned = sets.reduce((total, set) => total + set.learned_count, 0);
  const totalDue = sets.reduce((total, set) => total + set.due_count, 0);

  return (
    <>
      <section className={styles.libraryHero}>
        <div>
          <span className={styles.eyebrow}>THƯ VIỆN TỰ HỌC</span>
          <h1>Hôm nay học gì?</h1>
          <p>Chọn một bộ đề đã được quản trị viên xuất bản. Tiến độ ôn cách quãng được lưu theo tài khoản của bạn.</p>
        </div>
        <div className={styles.librarySummary}>
          <article><span>BỘ ĐỀ</span><strong>{sets.length}</strong></article>
          <article><span>THUẬT NGỮ</span><strong>{totalTerms}</strong></article>
          <article><span>ĐÃ HỌC</span><strong>{totalLearned}</strong></article>
          <article className={totalDue ? styles.dueMetric : ""}><span>ĐẾN HẠN</span><strong>{totalDue}</strong></article>
        </div>
      </section>

      <section className={styles.librarySection}>
        <div className={styles.sectionHeading}>
          <div><span className={styles.eyebrow}>TẤT CẢ BỘ ĐỀ</span><h2>Học theo tốc độ của bạn</h2></div>
          <span>{sets.length} bộ đề khả dụng</span>
        </div>
        {loading ? (
          <div className={styles.emptyState}><strong>Đang tải thư viện…</strong></div>
        ) : sets.length ? (
          <div className={styles.setGrid}>
            {sets.map((set, index) => {
              const progress = set.question_count > 0
                ? Math.round(set.learned_count / set.question_count * 100)
                : 0;
              return (
                <article className={styles.setCard} key={set.id}>
                  <div className={styles.setCardTop}>
                    <span className={styles.setIndex}>{String(index + 1).padStart(2, "0")}</span>
                    {set.due_count > 0 && <span className={styles.dueBadge}>{set.due_count} cần ôn</span>}
                  </div>
                  <span className={styles.topic}>{set.topic}</span>
                  <h3>{set.title}</h3>
                  <p>{set.description || "Bộ đề tự học do quản trị viên xuất bản."}</p>
                  <div className={styles.setProgress}>
                    <div><i style={{ width: progress + "%" }} /></div>
                    <span>{set.learned_count}/{set.question_count} đã học</span>
                  </div>
                  <button onClick={() => onOpen(set.id)}>Mở bộ đề <span>→</span></button>
                </article>
              );
            })}
          </div>
        ) : (
          <div className={styles.emptyState}>
            <strong>Chưa có bộ đề được xuất bản</strong>
            <p>Hãy quay lại sau khi quản trị viên đưa bộ đề lên thư viện.</p>
          </div>
        )}
      </section>
    </>
  );
}
