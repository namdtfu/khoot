"use client";

import { useEffect, useState } from "react";
import { getStudyDefinition, getStudyTerm, shuffleItems } from "@/lib/study/engine";
import type { StudyQuestion, StudySetDetail } from "@/lib/study/types";
import styles from "../learn.module.css";

type Props = {
  studySet: StudySetDetail;
  onBack: () => void;
};

export default function FlashcardMode({ studySet, onBack }: Props) {
  const [queue, setQueue] = useState<StudyQuestion[]>(() => shuffleItems(studySet.questions));
  const [flipped, setFlipped] = useState(false);
  const current = queue[0];
  const mastered = studySet.questions.length - queue.length;

  const markAgain = () => {
    if (!current) return;
    setQueue((items) => items.length > 1 ? [...items.slice(1), items[0]] : items);
    setFlipped(false);
  };

  const markKnown = () => {
    setQueue((items) => items.slice(1));
    setFlipped(false);
  };

  const restart = () => {
    setQueue(shuffleItems(studySet.questions));
    setFlipped(false);
  };

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        event.preventDefault();
        setFlipped((value) => !value);
      } else if (event.key === "1" && current) {
        markAgain();
      } else if (event.key === "2" && current) {
        markKnown();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  });

  return (
    <section className={styles.studyMode}>
      <div className={styles.modeHeader}>
        <button onClick={onBack}>← Chọn chế độ</button>
        <div><span className={styles.eyebrow}>FLASHCARD</span><strong>{studySet.title}</strong></div>
        <span>{mastered}/{studySet.questions.length} đã thuộc</span>
      </div>
      <div className={styles.modeProgress}><i style={{ width: (studySet.questions.length ? mastered / studySet.questions.length * 100 : 0) + "%" }} /></div>

      {current ? (
        <>
          <button className={`${styles.flashcard} ${flipped ? styles.flipped : ""}`} onClick={() => setFlipped((value) => !value)}>
            <span>{flipped ? "ĐỊNH NGHĨA / CÂU HỎI" : "THUẬT NGỮ / ĐÁP ÁN"}</span>
            <strong>{flipped ? getStudyDefinition(current) : getStudyTerm(current)}</strong>
            <small>Nhấn vào thẻ hoặc phím Space để lật</small>
          </button>
          <div className={styles.flashActions}>
            <button className={styles.againButton} onClick={markAgain}><span>1</span> Chưa thuộc</button>
            <button className={styles.knownButton} onClick={markKnown}><span>2</span> Đã thuộc</button>
          </div>
          <p className={styles.keyboardHelp}>Thẻ chưa thuộc sẽ quay lại cuối hàng. Bạn có thể học đến khi không còn thẻ nào.</p>
        </>
      ) : (
        <div className={styles.modeComplete}>
          <span>✓</span>
          <h2>Đã thuộc hết lượt này!</h2>
          <p>Bạn đã đánh dấu thuộc cả {studySet.questions.length} thẻ.</p>
          <div><button onClick={onBack}>Chọn chế độ khác</button><button className={styles.primaryAction} onClick={restart}>Học lại từ đầu</button></div>
        </div>
      )}
    </section>
  );
}
