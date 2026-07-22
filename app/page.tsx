"use client";

import { useEffect, useMemo, useState } from "react";

type Player = { id: number; name: string; color: string; score: number };
type Question = { word: string; sound: string; prompt: string; options: string[]; correct: number; example: string };

const PLAYERS: Player[] = [
  { id: 1, name: "Linh", color: "#ff7867", score: 0 },
  { id: 2, name: "Minh", color: "#ffc857", score: 0 },
  { id: 3, name: "An", color: "#39c6a3", score: 0 },
  { id: 4, name: "Vy", color: "#6d8cff", score: 0 },
  { id: 5, name: "Nam", color: "#b477e8", score: 0 },
];

const QUIZ: Question[] = [
  { word: "curious", sound: "/?kj??.ri.?s/", prompt: "T? n?y c? ngh?a l? g??", options: ["T? m?", "Lo l?ng", "Ch?m ch?", "B?nh t?nh"], correct: 0, example: "She is curious about the world." },
  { word: "generous", sound: "/?d?en.?r.?s/", prompt: "Ch?n ngh?a ??ng c?a t? n?y.", options: ["Nghi?m kh?c", "H?o ph?ng", "Nh?t nh?t", "Th?ng minh"], correct: 1, example: "He is generous with his time." },
  { word: "journey", sound: "/?d???.ni/", prompt: "T? n?y g?n ngh?a nh?t v?i?", options: ["B?a ti?c", "K? ni?m", "H?nh tr?nh", "L?a ch?n"], correct: 2, example: "The journey took three days." },
  { word: "improve", sound: "/?m?pru?v/", prompt: "??u l? ngh?a ch?nh x?c?", options: ["C?i thi?n", "T? ch?i", "Kh?m ph?", "Ghi nh?"], correct: 0, example: "Practice will improve your English." },
  { word: "ancient", sound: "/?e?n.??nt/", prompt: "Ch?n b?n d?ch ??ng.", options: ["Hi?n ??i", "??ng ??c", "Xa x?i", "C? x?a"], correct: 3, example: "They visited an ancient temple." },
  { word: "opportunity", sound: "/??p.??t?u?.n?.ti/", prompt: "Ch?n ngh?a ??ng ?? v? ??ch!", options: ["Th? th?ch", "Tr?ch nhi?m", "C? h?i", "Kinh nghi?m"], correct: 2, example: "This is a great opportunity to learn." },
];

const SHAPES = ["?", "?", "?", "?"];

export default function Home() {
  const [screen, setScreen] = useState<"welcome" | "game" | "finish">("welcome");
  const [questionIndex, setQuestionIndex] = useState(0);
  const [players, setPlayers] = useState(PLAYERS);
  const [activePlayer, setActivePlayer] = useState(0);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [stage, setStage] = useState<"answering" | "reveal">("answering");
  const [locked, setLocked] = useState(false);
  const [recentAnswer, setRecentAnswer] = useState<number | null>(null);
  const question = QUIZ[questionIndex];
  const ranking = useMemo(() => [...players].sort((a, b) => b.score - a.score || a.id - b.id), [players]);

  const choose = (answer: number) => {
    if (screen !== "game" || stage !== "answering" || locked) return;
    const nextAnswers = { ...answers, [players[activePlayer].id]: answer };
    setAnswers(nextAnswers); setRecentAnswer(answer); setLocked(true);
    window.setTimeout(() => {
      setRecentAnswer(null);
      if (activePlayer < 4) { setActivePlayer((n) => n + 1); setLocked(false); return; }
      setPlayers((list) => list.map((p) => ({ ...p, score: p.score + (nextAnswers[p.id] === question.correct ? 1000 : 0) })));
      setStage("reveal"); setLocked(false);
    }, 420);
  };

  const start = () => {
    setPlayers(PLAYERS.map((p) => ({ ...p, score: 0 })));
    setQuestionIndex(0); setAnswers({}); setActivePlayer(0);
    setStage("answering"); setScreen("game");
  };

  const nextQuestion = () => {
    if (questionIndex === QUIZ.length - 1) { setScreen("finish"); return; }
    setQuestionIndex((n) => n + 1); setAnswers({}); setActivePlayer(0); setStage("answering");
  };

  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if ((screen === "welcome" || screen === "finish") && event.key === "Enter") start();
      if (screen === "game" && stage === "answering" && /^[1-4]$/.test(event.key)) choose(Number(event.key) - 1);
      if (screen === "game" && stage === "reveal" && event.key === "Enter") nextQuestion();
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  });

  if (screen === "welcome") {
    return (
      <main className="welcome-shell">
        <header className="topbar">
          <a className="brand" href="#" aria-label="Khoot Mini - trang ch?">KHOOT<span>!</span></a>
          <span className="round-label">VOCAB SPRINT</span>
        </header>
        <section className="welcome-grid">
          <div className="hero-copy">
            <span className="eyebrow">B? ?? ? TI?NG ANH C? B?N</span>
            <h1>5 ng??i.<br />6 t? m?i.<br /><em>Ai nh? nhanh nh?t?</em></h1>
            <p>Chuy?n m?y cho t?ng ng??i, ch?n ngh?a ??ng v? c?ng xem ai d?n ??u. Kh?ng c?n ??ng nh?p.</p>
            <button className="primary-button" type="button" onClick={start}>Ch?i ngay <span aria-hidden="true">?</span></button>
            <small>Nh?n Enter ?? b?t ??u</small>
          </div>
          <div className="lobby-card" aria-label="Danh s?ch ng??i ch?i">
            <div className="lobby-topline">
              <div><span>PH?NG H?C</span><strong>#5842</strong></div>
              <span className="live-pill"><i /> S?N S?NG</span>
            </div>
            <div className="word-preview" aria-hidden="true">
              <span>word of the day</span><strong>curious</strong><i>/?kj??.ri.?s/</i>
            </div>
            <div className="player-list">
              {players.map((player, index) => (
                <div className="player-row" key={player.id}>
                  <span className="avatar" style={{ background: player.color }}>{player.name[0]}</span>
                  <strong>{player.name}</strong><span className="seat">P{index + 1}</span><span className="ready-dot">?</span>
                </div>
              ))}
            </div>
            <div className="lobby-footer">
              <span>5 / 5 ng??i ch?i</span>
              <div className="tiny-avatars" aria-hidden="true">
                {players.map((player) => <i key={player.id} style={{ background: player.color }} />)}
              </div>
            </div>
          </div>
        </section>
      </main>
    );
  }

  if (screen === "finish") {
    const winner = ranking[0];
    return (
      <main className="finish-shell">
        <div className="confetti confetti-one" /><div className="confetti confetti-two" />
        <a className="brand finish-brand" href="#" onClick={(event) => { event.preventDefault(); start(); }}>KHOOT<span>!</span></a>
        <section className="finish-card">
          <span className="eyebrow">HO?N TH?NH 6 / 6 C?U</span>
          <h1>Qu?n qu?n<br />t? v?ng!</h1>
          <div className="winner-avatar" style={{ background: winner.color }}>{winner.name[0]}<span>?</span></div>
          <h2>{winner.name}</h2>
          <strong className="winner-score">{winner.score.toLocaleString("vi-VN")} ?i?m</strong>
          <div className="final-ranking">
            {ranking.map((player, index) => (
              <div key={player.id} className={index === 0 ? "champion-row" : ""}>
                <span>{index + 1}</span><i style={{ background: player.color }}>{player.name[0]}</i>
                <strong>{player.name}</strong><b>{player.score.toLocaleString("vi-VN")}</b>
              </div>
            ))}
          </div>
          <button className="primary-button" type="button" onClick={start}>Ch?i l?i <span aria-hidden="true">?</span></button>
        </section>
      </main>
    );
  }

  const active = players[activePlayer];
  const responseCount = (answer: number) => Object.values(answers).filter((item) => item === answer).length;

  return (
    <main className="game-shell">
      <header className="game-header">
        <a className="brand" href="#" onClick={(event) => { event.preventDefault(); setScreen("welcome"); }}>KHOOT<span>!</span></a>
        <div className="question-counter"><span>C?U H?I</span><strong>{questionIndex + 1} / {QUIZ.length}</strong></div>
        <div className="header-score">
          <span>{stage === "answering" ? active.name : "C? nh?m"}</span>
          <strong>{stage === "answering" ? active.score : players.reduce((sum, player) => sum + player.score, 0).toLocaleString("vi-VN")}</strong>
        </div>
      </header>
      <div className="progress-track" aria-label={`Ti?n ?? ${questionIndex + 1} tr?n ${QUIZ.length}`}>
        <i style={{ width: `${((questionIndex + 1) / QUIZ.length) * 100}%` }} />
      </div>
      <section className="quiz-content">
        <div className="question-card">
          <span className="eyebrow">DAILY ENGLISH ? T? V?NG</span>
          <p>{question.prompt}</p><h1>{question.word}</h1><span className="pronunciation">{question.sound}</span>
        </div>
        <div className="answer-grid" aria-label="C?c ??p ?n">
          {question.options.map((option, index) => {
            const state = stage === "reveal" ? (index === question.correct ? "correct" : "muted") : (recentAnswer === index ? "selected" : "");
            return (
              <button
                key={option}
                className={`answer-card answer-${index} ${state}`}
                type="button"
                onClick={() => choose(index)}
                disabled={stage === "reveal" || locked}
                aria-label={`??p ?n ${index + 1}: ${option}`}
              >
                <span className="answer-shape" aria-hidden="true">{SHAPES[index]}</span>
                <strong>{option}</strong>
                {stage === "answering" ? <kbd>{index + 1}</kbd> : <span className="response-count">{responseCount(index)} ch?n</span>}
              </button>
            );
          })}
        </div>
        {stage === "answering" ? (
          <div className="turn-panel">
            <div className="turn-copy">
              <span className="avatar active-avatar" style={{ background: active.color }}>{active.name[0]}</span>
              <div><span>L??T C?A</span><strong>{active.name}, ch?n m?t ??p ?n!</strong></div>
            </div>
            <div className="round-status" aria-label="Ti?n ?? tr? l?i c?a ng??i ch?i">
              {players.map((player, index) => (
                <span
                  key={player.id}
                  className={`${answers[player.id] !== undefined ? "done" : ""} ${index === activePlayer ? "current" : ""}`}
                  style={{ "--player-color": player.color } as React.CSSProperties}
                  title={player.name}
                >
                  {answers[player.id] !== undefined ? "?" : player.name[0]}
                </span>
              ))}
              <small>{Object.keys(answers).length}/5 ?? ch?n</small>
            </div>
          </div>
        ) : (
          <div className="reveal-panel">
            <div className="correct-copy">
              <span className="result-check">?</span>
              <div><span>??P ?N ??NG</span><strong>?{question.options[question.correct]}?</strong><p>{question.example}</p></div>
            </div>
            <ol className="mini-ranking" aria-label="B?ng x?p h?ng hi?n t?i">
              {ranking.map((player, index) => (
                <li key={player.id}><span>{index + 1}</span><i style={{ background: player.color }}>{player.name[0]}</i><strong>{player.name}</strong><b>{player.score.toLocaleString("vi-VN")}</b></li>
              ))}
            </ol>
            <button className="next-button" type="button" onClick={nextQuestion}>
              {questionIndex === QUIZ.length - 1 ? "Xem k?t qu?" : "C?u ti?p theo"} <span>?</span>
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
