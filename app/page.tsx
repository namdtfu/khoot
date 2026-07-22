"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

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
  { word: "curious", sound: "/ˈkjʊə.ri.əs/", prompt: "Từ này có nghĩa là gì?", options: ["Tò mò", "Lo lắng", "Chăm chỉ", "Bình tĩnh"], correct: 0, example: "Cô ấy tò mò về thế giới." },
  { word: "generous", sound: "/ˈdʒen.ər.əs/", prompt: "Chọn nghĩa đúng của từ này.", options: ["Nghiêm khắc", "Hào phóng", "Nhút nhát", "Thông minh"], correct: 1, example: "Anh ấy rất hào phóng với thời gian của mình." },
  { word: "journey", sound: "/ˈdʒɜː.ni/", prompt: "Từ này gần nghĩa nhất với…", options: ["Bữa tiệc", "Kỷ niệm", "Hành trình", "Lựa chọn"], correct: 2, example: "Hành trình kéo dài ba ngày." },
  { word: "improve", sound: "/ɪmˈpruːv/", prompt: "Đâu là nghĩa chính xác?", options: ["Cải thiện", "Từ chối", "Khám phá", "Ghi nhớ"], correct: 0, example: "Luyện tập sẽ giúp bạn cải thiện tiếng Anh." },
  { word: "ancient", sound: "/ˈeɪn.ʃənt/", prompt: "Chọn bản dịch đúng.", options: ["Hiện đại", "Đông đúc", "Xa xôi", "Cổ xưa"], correct: 3, example: "Họ đã ghé thăm một ngôi đền cổ xưa." },
  { word: "opportunity", sound: "/ˌɒp.əˈtʃuː.nə.ti/", prompt: "Chọn nghĩa đúng để về đích!", options: ["Thử thách", "Trách nhiệm", "Cơ hội", "Kinh nghiệm"], correct: 2, example: "Đây là một cơ hội tuyệt vời để học hỏi." },
];

const SHAPES = ["▲", "◆", "●", "■"];

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
          <a className="brand" href="#" aria-label="Khoot Mini - trang chủ">KHOOT<span>!</span></a>
          <Link className="round-label" href="/admin">QUẢN LÝ BỘ ĐỀ →</Link>
        </header>
        <section className="welcome-grid">
          <div className="hero-copy">
            <span className="eyebrow">BỘ ĐỀ · TIẾNG ANH CƠ BẢN</span>
            <h1>5 người.<br />6 từ mới.<br /><em>Ai nhớ nhanh nhất?</em></h1>
            <p>Chuyền máy cho từng người, chọn nghĩa đúng và cùng xem ai dẫn đầu. Không cần đăng nhập.</p>
            <button className="primary-button" type="button" onClick={start}>Chơi ngay <span aria-hidden="true">→</span></button>
            <small>Nhấn Enter để bắt đầu</small>
          </div>
          <div className="lobby-card" aria-label="Danh sách người chơi">
            <div className="lobby-topline">
              <div><span>PHÒNG HỌC</span><strong>#5842</strong></div>
              <span className="live-pill"><i /> SẴN SÀNG</span>
            </div>
            <div className="word-preview" aria-hidden="true">
              <span>Từ mới hôm nay</span><strong>curious</strong><i>/ˈkjʊə.ri.əs/</i>
            </div>
            <div className="player-list">
              {players.map((player, index) => (
                <div className="player-row" key={player.id}>
                  <span className="avatar" style={{ background: player.color }}>{player.name[0]}</span>
                  <strong>{player.name}</strong><span className="seat">N{index + 1}</span><span className="ready-dot">✓</span>
                </div>
              ))}
            </div>
            <div className="lobby-footer">
              <span>5 / 5 người chơi</span>
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
          <span className="eyebrow">HOÀN THÀNH 6 / 6 CÂU</span>
          <h1>Quán quân<br />từ vựng!</h1>
          <div className="winner-avatar" style={{ background: winner.color }}>{winner.name[0]}<span>★</span></div>
          <h2>{winner.name}</h2>
          <strong className="winner-score">{winner.score.toLocaleString("vi-VN")} điểm</strong>
          <div className="final-ranking">
            {ranking.map((player, index) => (
              <div key={player.id} className={index === 0 ? "champion-row" : ""}>
                <span>{index + 1}</span><i style={{ background: player.color }}>{player.name[0]}</i>
                <strong>{player.name}</strong><b>{player.score.toLocaleString("vi-VN")}</b>
              </div>
            ))}
          </div>
          <button className="primary-button" type="button" onClick={start}>Chơi lại <span aria-hidden="true">↻</span></button>
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
        <div className="question-counter"><span>CÂU HỎI</span><strong>{questionIndex + 1} / {QUIZ.length}</strong></div>
        <div className="header-score">
          <span>{stage === "answering" ? active.name : "Cả nhóm"}</span>
          <strong>{stage === "answering" ? active.score : players.reduce((sum, player) => sum + player.score, 0).toLocaleString("vi-VN")}</strong>
        </div>
      </header>
      <div className="progress-track" aria-label={`Tiến độ ${questionIndex + 1} trên ${QUIZ.length}`}>
        <i style={{ width: `${((questionIndex + 1) / QUIZ.length) * 100}%` }} />
      </div>
      <section className="quiz-content">
        <div className="question-card">
          <span className="eyebrow">TRẮC NGHIỆM · TỪ VỰNG</span>
          <p>{question.prompt}</p><h1>{question.word}</h1><span className="pronunciation">{question.sound}</span>
        </div>
        <div className="answer-grid" aria-label="Các đáp án">
          {question.options.map((option, index) => {
            const state = stage === "reveal" ? (index === question.correct ? "correct" : "muted") : (recentAnswer === index ? "selected" : "");
            return (
              <button
                key={option}
                className={`answer-card answer-${index} ${state}`}
                type="button"
                onClick={() => choose(index)}
                disabled={stage === "reveal" || locked}
                aria-label={`Đáp án ${index + 1}: ${option}`}
              >
                <span className="answer-shape" aria-hidden="true">{SHAPES[index]}</span>
                <strong>{option}</strong>
                {stage === "answering" ? <kbd>{index + 1}</kbd> : <span className="response-count">{responseCount(index)} chọn</span>}
              </button>
            );
          })}
        </div>
        {stage === "answering" ? (
          <div className="turn-panel">
            <div className="turn-copy">
              <span className="avatar active-avatar" style={{ background: active.color }}>{active.name[0]}</span>
              <div><span>LƯỢT CỦA</span><strong>{active.name}, chọn một đáp án!</strong></div>
            </div>
            <div className="round-status" aria-label="Tiến độ trả lời của người chơi">
              {players.map((player, index) => (
                <span
                  key={player.id}
                  className={`${answers[player.id] !== undefined ? "done" : ""} ${index === activePlayer ? "current" : ""}`}
                  style={{ "--player-color": player.color } as React.CSSProperties}
                  title={player.name}
                >
                  {answers[player.id] !== undefined ? "✓" : player.name[0]}
                </span>
              ))}
              <small>{Object.keys(answers).length}/5 đã chọn</small>
            </div>
          </div>
        ) : (
          <div className="reveal-panel">
            <div className="correct-copy">
              <span className="result-check">✓</span>
              <div><span>ĐÁP ÁN ĐÚNG</span><strong>“{question.options[question.correct]}”</strong><p>{question.example}</p></div>
            </div>
            <ol className="mini-ranking" aria-label="Bảng xếp hạng hiện tại">
              {ranking.map((player, index) => (
                <li key={player.id}><span>{index + 1}</span><i style={{ background: player.color }}>{player.name[0]}</i><strong>{player.name}</strong><b>{player.score.toLocaleString("vi-VN")}</b></li>
              ))}
            </ol>
            <button className="next-button" type="button" onClick={nextQuestion}>
              {questionIndex === QUIZ.length - 1 ? "Xem kết quả" : "Câu tiếp theo"} <span>→</span>
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
