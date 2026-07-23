"use client";

import { useEffect, useState } from "react";
import { buildQuizRounds } from "@/lib/study/engine";
import type { QuizRound, StudySetDetail } from "@/lib/study/types";
import styles from "../learn.module.css";

type Props = {
  studySet: StudySetDetail;
  onBack: () => void;
};

export default function MultipleChoiceMode({ studySet, onBack }: Props) {
  const [rounds, setRounds] = useState<QuizRound[]>(() => buildQuizRounds(studySet.questions));
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const current = rounds[index];
  const finished = index >= rounds.length;

  const choose = (originalIndex: number) => {
    if (!current || selected !== null) return;
    setSelected(originalIndex);
    if (originalIndex === current.question.correct_option) setScore((value) => value + 1);
  };

  const next = () => {
    setIndex((value) => value + 1);
    setSelected(null);
  };

  const restart = () => {
    setRounds(buildQuizRounds(studySet.questions));
    setIndex(0);
    setSelected(null);
    setScore(0);
  };

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (!current) return;
      if (selected === null) {
        const option = Number(event.key) - 1;
        if (option >= 0 && option < current.options.length) choose(current.options[option].originalIndex);
      } else if (event.key === "Enter") {
        next();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  });

  return (
    <section className={styles.studyMode}>
      <div className={styles.modeHeader}>
        <button onClick={onBack}>← Chọn chế độ</button>
        <div><span className={styles.eyebrow}>TRẮC NGHIỆM</span><strong>{studySet.title}</strong></div>
        <span>{Math.min(index + 1, rounds.length)}/{rounds.length}</span>
      </div>
      <div className={styles.modeProgress}><i style={{ width: (rounds.length ? index / rounds.length * 100 : 0) + "%" }} /></div>

      {finished ? (
        <div className={styles.modeComplete}>
          <span>{score === rounds.length ? "★" : "✓"}</span>
          <h2>{score}/{rounds.length} câu chính xác</h2>
          <p>Độ chính xác {rounds.length ? Math.round(score / rounds.length * 100) : 0}% trong lượt luyện này.</p>
          <div><button onClick={onBack}>Chọn chế độ khác</button><button className={styles.primaryAction} onClick={restart}>Làm lại bộ đề</button></div>
        </div>
      ) : current ? (
        <>
          <div className={styles.quizPrompt}>
            <span>CÂU {index + 1}</span>
            <h2>{current.question.prompt}</h2>
          </div>
          <div className={styles.quizOptions}>
            {current.options.map((option, optionIndex) => {
              const isCorrect = option.originalIndex === current.question.correct_option;
              const isSelected = option.originalIndex === selected;
              const stateClass = selected === null
                ? ""
                : isCorrect
                  ? styles.quizCorrect
                  : isSelected
                    ? styles.quizWrong
                    : styles.quizMuted;
              return (
                <button className={stateClass} disabled={selected !== null} onClick={() => choose(option.originalIndex)} key={option.originalIndex}>
                  <span>{optionIndex + 1}</span><strong>{option.text}</strong>
                  {selected !== null && isCorrect && <b>✓</b>}
                  {selected !== null && isSelected && !isCorrect && <b>×</b>}
                </button>
              );
            })}
          </div>
          {selected !== null && (
            <div className={selected === current.question.correct_option ? styles.correctFeedback : styles.wrongFeedback}>
              <div><strong>{selected === current.question.correct_option ? "Chính xác!" : "Chưa chính xác"}</strong><span>Đáp án: {current.question.options[current.question.correct_option]}</span></div>
              <button onClick={next}>Câu tiếp theo ↵</button>
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}
