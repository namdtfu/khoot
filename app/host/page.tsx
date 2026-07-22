"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  ANSWER_SHAPES,
  buildPlayerLink,
  countdownValue,
  formatResponseTime,
  getErrorMessage,
  getRoomToken,
  secondsRemaining,
  type GameSnapshot,
} from "@/lib/game";
import styles from "../live.module.css";

export default function HostPage() {
  const [roomId, setRoomId] = useState("");
  const [authReady, setAuthReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState(0);
  const [copied, setCopied] = useState(false);
  const transitioning = useRef(false);

  useEffect(() => {
    const setupTimer = window.setTimeout(() => setRoomId(getRoomToken()), 0);
    supabase.auth.getSession().then(({ data }) => {
      setAuthenticated(Boolean(data.session));
      setAuthReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthenticated(Boolean(session));
      setAuthReady(true);
    });
    return () => {
      window.clearTimeout(setupTimer);
      data.subscription.unsubscribe();
    };
  }, []);

  const loadRoom = useCallback(async () => {
    if (!roomId) return;
    const { data, error: roomError } = await supabase.rpc("get_host_game", {
      p_room_id: roomId,
    });
    if (roomError) {
      setError(getErrorMessage(roomError));
      return;
    }
    setSnapshot(data as GameSnapshot);
    setError("");
  }, [roomId]);

  useEffect(() => {
    if (!authReady || !authenticated || !roomId) return;
    const loadTimer = window.setTimeout(() => void loadRoom(), 0);
    return () => window.clearTimeout(loadTimer);
  }, [authReady, authenticated, roomId, loadRoom]);

  useEffect(() => {
    const token = snapshot?.room.public_token;
    if (!token) return;
    const channel = supabase
      .channel(`game:${token}`, { config: { private: false } })
      .on("broadcast", { event: "state" }, () => void loadRoom())
      .subscribe();
    const fallback = window.setInterval(() => void loadRoom(), 5000);
    return () => {
      window.clearInterval(fallback);
      void supabase.removeChannel(channel);
    };
  }, [snapshot?.room.public_token, loadRoom]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  const runTransition = useCallback(async (name: "activate_game" | "reveal_game" | "advance_game") => {
    if (!roomId || transitioning.current) return;
    transitioning.current = true;
    const { data, error: transitionError } = await supabase.rpc(name, { p_room_id: roomId });
    if (transitionError) setError(getErrorMessage(transitionError));
    else {
      setSnapshot(data as GameSnapshot);
      setError("");
    }
    transitioning.current = false;
  }, [roomId]);

  const remaining = snapshot
    ? secondsRemaining(snapshot.room.question_started_at, snapshot.room.time_limit_seconds, now)
    : 0;
  const allAnswered = Boolean(
    snapshot
    && snapshot.players.length === snapshot.room.max_players
    && snapshot.players.every((player) => player.answered)
  );

  useEffect(() => {
    if (!snapshot || transitioning.current) return;
    const room = snapshot.room;
    let transition: "activate_game" | "reveal_game" | "advance_game" | null = null;
    if (room.status === "countdown" && room.question_started_at
      && now >= new Date(room.question_started_at).getTime()) {
      transition = "activate_game";
    } else if (room.status === "playing" && (allAnswered || remaining <= 0)) {
      transition = "reveal_game";
    } else if (room.status === "reveal" && room.reveal_started_at
      && now >= new Date(room.reveal_started_at).getTime() + 3000) {
      transition = "advance_game";
    }
    if (!transition) return;
    const transitionTimer = window.setTimeout(() => void runTransition(transition), 0);
    return () => window.clearTimeout(transitionTimer);
  }, [snapshot, now, allAnswered, remaining, runTransition]);

  const canStart = Boolean(
    snapshot
    && snapshot.players.length === snapshot.room.max_players
    && snapshot.players.every((player) => player.is_ready)
  );

  const startGame = async () => {
    if (!roomId || !canStart) return;
    transitioning.current = true;
    const { data, error: startError } = await supabase.rpc("start_game", {
      p_room_id: roomId,
    });
    if (startError) setError(getErrorMessage(startError));
    else setSnapshot(data as GameSnapshot);
    transitioning.current = false;
  };

  const playerLink = useMemo(
    () => snapshot ? buildPlayerLink(snapshot.room.public_token) : "",
    [snapshot],
  );

  const copyLink = async () => {
    await navigator.clipboard.writeText(playerLink);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  if (!authReady) {
    return <main className={styles.shell}><div className={styles.loading}><strong>KHOOT!</strong><p>Đang mở phòng điều khiển…</p></div></main>;
  }

  if (!authenticated) {
    return <main className={styles.shell}><div className={styles.errorState}><h1>Cần đăng nhập</h1><p>Phiên quản trị đã hết hạn.</p><Link href="/admin">Về trang đăng nhập</Link></div></main>;
  }

  if (!roomId || error && !snapshot) {
    return <main className={styles.shell}><div className={styles.errorState}><h1>Không mở được phòng</h1><p>{error || "Liên kết phòng không hợp lệ."}</p><Link href="/admin">Về ngân hàng câu hỏi</Link></div></main>;
  }

  if (!snapshot) {
    return <main className={styles.shell}><div className={styles.loading}><strong>KHOOT!</strong><p>Đang tải trạng thái phòng…</p></div></main>;
  }

  const room = snapshot.room;
  const question = snapshot.question;

  const renderStage = () => {
    if (room.status === "waiting") {
      return (
        <div className={styles.centerStage}>
          <span className={styles.countdownLabel}>PHÒNG ĐANG MỞ</span>
          <h2>Chờ đủ {room.max_players} học sinh sẵn sàng</h2>
          <p>{snapshot.players.length}/{room.max_players} em đã vào phòng · {snapshot.players.filter((player) => player.is_ready).length}/{room.max_players} đã sẵn sàng</p>
          <button className={styles.startButton} disabled={!canStart} onClick={startGame}>
            {canStart ? "Bắt đầu — 3, 2, 1!" : "Chưa thể bắt đầu"}
          </button>
          <p className={styles.helper}>Nút bắt đầu sẽ mở khi đủ {room.max_players} em và tất cả đã bấm sẵn sàng.</p>
        </div>
      );
    }

    if (room.status === "countdown") {
      return (
        <div className={styles.centerStage}>
          <span className={styles.countdownLabel}>TRẬN ĐẤU BẮT ĐẦU SAU</span>
          <div className={styles.countdown}>{countdownValue(room.question_started_at, now)}</div>
          <h2>Chuẩn bị!</h2>
        </div>
      );
    }

    if (room.status === "finished") {
      return (
        <>
          <div className={styles.finishHero}>
            <span>🏆</span>
            <h1>Hoàn thành!</h1>
            <p>Thống kê kết quả của cả {room.max_players} học sinh.</p>
          </div>
          <div className={styles.statsTable}>
            <div className={styles.statsHeader}><span>HẠNG</span><span>HỌC SINH</span><span>ĐÚNG</span><span>TB</span><span>ĐIỂM</span></div>
            {snapshot.stats.map((stat, index) => (
              <div className={styles.statsRow} key={stat.player_id}>
                <span>{index + 1}</span>
                <strong>{stat.name}</strong>
                <span>{stat.correct_count}/{room.question_count}</span>
                <span>{formatResponseTime(stat.average_response_ms)}</span>
                <b>{stat.score.toLocaleString("vi-VN")}</b>
              </div>
            ))}
          </div>
          <div className={styles.finishActions}><Link href="/admin">Về ngân hàng câu hỏi</Link></div>
        </>
      );
    }

    if (!question) return <div className={styles.loading}><p>Đang đồng bộ câu hỏi…</p></div>;
    const revealed = room.status === "reveal";

    return (
      <>
        <div className={styles.quizTop}>
          <div>
            <span className={styles.questionNumber}>CÂU {room.current_question + 1} / {room.question_count}</span>
            <div className={styles.progress}><i style={{ width: `${((room.current_question + 1) / room.question_count) * 100}%` }} /></div>
          </div>
          <div className={`${styles.timer} ${remaining <= 5 && !revealed ? styles.urgent : ""}`}>
            {revealed ? "✓" : Math.ceil(remaining)}
          </div>
        </div>
        {revealed && (
          <div className={styles.revealBanner}>
            <span>✓</span>
            <div><strong>Đáp án đúng: {question.options[question.correct_option ?? 0]}</strong><small>Tự động chuyển câu sau 3 giây.</small></div>
          </div>
        )}
        <div className={styles.question}><h2>{question.prompt}</h2></div>
        <div className={styles.answers}>
          {question.options.map((option, index) => (
            <div
              className={`${styles.answer} ${revealed ? index === question.correct_option ? styles.correct : styles.wrong : ""}`}
              key={index}
            >
              <span className={styles.answerShape}>{ANSWER_SHAPES[index]}</span>
              <strong>{option}</strong>
            </div>
          ))}
        </div>
        <div className={styles.answerProgress}>
          <span>{revealed ? "Đang hiển thị đáp án" : "Đang nhận câu trả lời realtime"}</span>
          <strong>{snapshot.players.filter((player) => player.answered).length}/{room.max_players} đã trả lời</strong>
        </div>
      </>
    );
  };

  return (
    <main className={styles.shell}>
      <header className={styles.topbar}>
        <Link className={styles.brand} href="/admin">KHOOT<span>!</span></Link>
        <span className={styles.role}>MÁY QUẢN TRỊ</span>
      </header>
      <div className={styles.main}>
        <div className={styles.roomHeading}>
          <div><span className={styles.eyebrow}>PHÒNG THI REALTIME</span><h1>{room.title}</h1><p>{room.status === "waiting" ? "Chia sẻ liên kết để học sinh tham gia." : "Máy quản trị đang tự động điều phối trận đấu."}</p></div>
          <div className={styles.timeChip}><b>{room.time_limit_seconds}</b> giây / câu</div>
        </div>
        {error && <p className={styles.errorMessage}>{error}</p>}
        <div className={styles.hostGrid}>
          <section className={styles.stage}>{renderStage()}</section>
          <aside className={styles.sidePanel}>
            {room.status === "waiting" && (
              <div className={styles.linkCard}>
                <span>LIÊN KẾT DÀNH CHO {room.max_players} HỌC SINH</span>
                <div className={styles.linkRow}><input readOnly value={playerLink} /><button onClick={copyLink}>{copied ? "Đã chép" : "Sao chép"}</button></div>
              </div>
            )}
            <span className={styles.eyebrow}>NGƯỜI CHƠI</span>
            <h2>{snapshot.players.length}/{room.max_players} học sinh</h2>
            <div className={styles.playerList}>
              {Array.from({ length: room.max_players }, (_, index) => {
                const player = snapshot.players[index];
                return player ? (
                  <div className={`${styles.playerCard} ${player.is_ready ? styles.ready : ""} ${player.answered ? styles.answered : ""}`} key={player.id}>
                    <i>{player.name[0].toUpperCase()}</i>
                    <div><strong>{player.name}</strong><br /><small>{room.status === "waiting" ? player.is_ready ? "Sẵn sàng" : "Chưa sẵn sàng" : `${player.score.toLocaleString("vi-VN")} điểm`}</small></div>
                    <span>{room.status === "waiting" ? player.is_ready ? "✓" : "·" : player.answered ? "✓" : "·"}</span>
                  </div>
                ) : (
                  <div className={`${styles.playerCard} ${styles.emptyPlayer}`} key={index}><i>?</i><strong>Đang chờ…</strong><span>·</span></div>
                );
              })}
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
