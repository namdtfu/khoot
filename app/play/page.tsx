"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  ANSWER_SHAPES,
  countdownValue,
  formatResponseTime,
  getBasePath,
  getErrorMessage,
  getRoomToken,
  secondsRemaining,
  type GameSnapshot,
} from "@/lib/game";
import styles from "../live.module.css";

export default function PlayPage() {
  const [roomToken, setRoomToken] = useState("");
  const [lobbyToken, setLobbyToken] = useState("");
  const [playerToken, setPlayerToken] = useState("");
  const [initialized, setInitialized] = useState(false);
  const [joined, setJoined] = useState(false);
  const [name, setName] = useState("");
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [canReconnect, setCanReconnect] = useState(false);
  const [now, setNow] = useState(0);

  useEffect(() => {
    const setupTimer = window.setTimeout(() => {
      const token = getRoomToken();
      setRoomToken(token);
      setLobbyToken(new URLSearchParams(window.location.search).get("lobby") ?? "");
      if (token) {
        const storageKey = `khoot-player-${token}`;
        let personalToken = window.localStorage.getItem(storageKey);
        if (!personalToken) {
          personalToken = crypto.randomUUID();
          window.localStorage.setItem(storageKey, personalToken);
        }
        setPlayerToken(personalToken);
      }
      setInitialized(true);
    }, 0);
    return () => window.clearTimeout(setupTimer);
  }, []);

  const loadGame = useCallback(async () => {
    if (!roomToken || !playerToken) return;
    const { data, error: loadError } = await supabase.rpc("get_player_game", {
      p_room_token: roomToken,
      p_player_token: playerToken,
    });
    if (loadError) {
      if (!joined) return;
      const message = getErrorMessage(loadError);
      if (message.includes("Không tìm thấy người chơi")) {
        setJoined(false);
        setSnapshot(null);
        setCanReconnect(true);
      }
      setError(message);
      return;
    }
    const next = data as GameSnapshot;
    setSnapshot(next);
    setJoined(true);
    setName(next.self?.name ?? "");
    setError("");
  }, [roomToken, playerToken, joined]);

  useEffect(() => {
    if (!roomToken || !playerToken) return;
    const loadTimer = window.setTimeout(() => void loadGame(), 0);
    return () => window.clearTimeout(loadTimer);
  }, [roomToken, playerToken, loadGame]);

  useEffect(() => {
    if (!joined || !roomToken) return;
    const channel = supabase
      .channel(`game:${roomToken}`, { config: { private: false } })
      .on("broadcast", { event: "state" }, () => void loadGame())
      .subscribe();
    const fallback = window.setInterval(() => void loadGame(), 2000);
    return () => {
      window.clearInterval(fallback);
      void supabase.removeChannel(channel);
    };
  }, [joined, roomToken, loadGame]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  const joinRoom = async (event: FormEvent) => {
    event.preventDefault();
    if (!roomToken || !playerToken || !name.trim()) return;
    setBusy(true); setError("");
    const { data, error: joinError } = await supabase.rpc("join_game", {
      p_room_token: roomToken,
      p_player_token: playerToken,
      p_name: name.trim(),
    });
    if (joinError) {
      const message = getErrorMessage(joinError);
      setError(message);
      setCanReconnect(Boolean(name.trim()));
    }
    else {
      setSnapshot(data as GameSnapshot);
      setJoined(true);
      setCanReconnect(false);
    }
    setBusy(false);
  };

  const reconnectRoom = async () => {
    if (!roomToken || !playerToken || !name.trim()) return;
    setBusy(true);
    setError("");
    const { data, error: reconnectError } = await supabase.rpc("reclaim_game_player", {
      p_room_token: roomToken,
      p_player_token: playerToken,
      p_name: name.trim(),
    });
    if (reconnectError) setError(getErrorMessage(reconnectError));
    else {
      setSnapshot(data as GameSnapshot);
      setJoined(true);
      setCanReconnect(false);
    }
    setBusy(false);
  };

  const toggleReady = async () => {
    if (!snapshot?.self) return;
    setBusy(true); setError("");
    const { data, error: readyError } = await supabase.rpc("set_player_ready", {
      p_room_token: roomToken,
      p_player_token: playerToken,
      p_is_ready: !snapshot.self.is_ready,
    });
    if (readyError) setError(getErrorMessage(readyError));
    else setSnapshot(data as GameSnapshot);
    setBusy(false);
  };

  const answer = useCallback(async (option: number) => {
    if (!snapshot || snapshot.room.status !== "playing"
      || snapshot.self?.selected_option != null || busy) return;
    setBusy(true); setError("");
    const { data, error: answerError } = await supabase.rpc("submit_game_answer", {
      p_room_token: roomToken,
      p_player_token: playerToken,
      p_selected_option: option,
    });
    if (answerError) setError(getErrorMessage(answerError));
    else setSnapshot(data as GameSnapshot);
    setBusy(false);
  }, [snapshot, busy, roomToken, playerToken]);

  useEffect(() => {
    if (!snapshot || snapshot.room.status !== "playing" || snapshot.self?.selected_option != null) return;
    const handleKey = (event: KeyboardEvent) => {
      const option = Number(event.key) - 1;
      if (option >= 0 && option <= 3) void answer(option);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [snapshot, answer]);

  if (!initialized) {
    return <main className={styles.shell}><div className={styles.loading}><strong>KHOOT!</strong><p>Đang mở liên kết phòng…</p></div></main>;
  }

  if (!roomToken) {
    return <main className={styles.shell}><div className={styles.errorState}><h1>Thiếu liên kết phòng</h1><p>Hãy mở đúng liên kết do người quản trị gửi.</p></div></main>;
  }

  if (!joined || !snapshot) {
    return (
      <main className={styles.shell}>
        <header className={styles.topbar}><span className={styles.brand}>KHOOT<span>!</span></span><span className={styles.role}>HỌC SINH</span></header>
        <div className={styles.joinLayout}>
          <form className={styles.joinCard} onSubmit={joinRoom}>
            <span className={styles.eyebrow}>THAM GIA PHÒNG</span>
            <h1>Tên của em là gì?</h1>
            <p>Nhập một tên dễ nhận biết. Sau khi vào phòng, hãy bấm sẵn sàng và chờ người quản trị bắt đầu.</p>
            <label>Tên hiển thị
              <input value={name} onChange={(event) => setName(event.target.value)} maxLength={30} placeholder="Ví dụ: Minh Anh" autoFocus required />
            </label>
            {error && <p className={styles.errorMessage}>{error}</p>}
            <button className={styles.joinButton} disabled={busy || !name.trim()} type="submit">{busy ? "Đang vào phòng…" : "Vào phòng →"}</button>
            {canReconnect && (
              <button className={styles.reconnectButton} disabled={busy || !name.trim()} type="button" onClick={() => void reconnectRoom()}>
                Kết nối lại với tên này
              </button>
            )}
          </form>
        </div>
      </main>
    );
  }

  const room = snapshot.room;
  const question = snapshot.question;
  const self = snapshot.self;
  const remaining = room.status === "paused" && room.paused_remaining_seconds != null
    ? room.paused_remaining_seconds
    : secondsRemaining(
      room.question_started_at,
      room.current_time_limit_seconds ?? room.time_limit_seconds,
      now,
    );
  const answered = self?.selected_option != null;

  const renderContent = () => {
    if (room.status === "waiting") {
      return (
        <div className={styles.waitingHero}>
          <div className={styles.avatar}>{self?.name[0].toUpperCase()}</div>
          <span className={styles.eyebrow}>ĐÃ VÀO PHÒNG · {snapshot.players.length}/{room.max_players} NGƯỜI</span>
          <h1>Chào {self?.name}!</h1>
          <p>{self?.is_ready ? "Em đã sẵn sàng. Hãy chờ các bạn nhé." : "Bấm nút bên dưới khi em đã sẵn sàng."}</p>
          <button className={`${styles.readyButton} ${self?.is_ready ? styles.active : ""}`} disabled={busy} onClick={toggleReady}>
            {self?.is_ready ? "✓ Đã sẵn sàng" : "Tôi đã sẵn sàng"}
          </button>
          <div className={styles.waitingPlayers}>
            {Array.from({ length: room.max_players }, (_, index) => {
              const player = snapshot.players[index];
              return <i className={player?.is_ready ? styles.ready : ""} key={player?.id ?? index}>{player ? player.name[0].toUpperCase() : "?"}</i>;
            })}
          </div>
        </div>
      );
    }

    if (room.status === "countdown") {
      return (
        <div className={styles.centerStage}>
          <span className={styles.countdownLabel}>SẴN SÀNG</span>
          <div className={styles.countdown}>{countdownValue(room.question_started_at, now)}</div>
          <h2>Bắt đầu!</h2>
        </div>
      );
    }

    if (room.status === "finished") {
      const rank = snapshot.stats.findIndex((stat) => stat.player_id === self?.id) + 1;
      return (
        <>
          <div className={styles.finishHero}>
            <span>{rank === 1 ? "🏆" : "🎉"}</span>
            <h1>Em xếp hạng {rank}</h1>
            <p>{self?.score.toLocaleString("vi-VN")} điểm · Hoàn thành {room.question_count} câu hỏi</p>
          </div>
          <div className={styles.statsTable}>
            <div className={styles.statsHeader}><span>HẠNG</span><span>HỌC SINH</span><span>ĐÚNG</span><span>TB</span><span>ĐIỂM</span></div>
            {snapshot.stats.map((stat, index) => (
              <div className={styles.statsRow} key={stat.player_id}>
                <span>{index + 1}</span><strong>{stat.name}{stat.player_id === self?.id ? " (em)" : ""}</strong>
                <span>{stat.correct_count}/{room.question_count}</span><span>{formatResponseTime(stat.average_response_ms)}</span><b>{stat.score.toLocaleString("vi-VN")}</b>
              </div>
            ))}
          </div>
          {lobbyToken && (
            <button
              className={styles.returnLobbyButton}
              type="button"
              onClick={() => window.location.assign(`${getBasePath()}/room/?room=${lobbyToken}`)}
            >
              Về link phòng cố định
            </button>
          )}
        </>
      );
    }

    if (!question) return <div className={styles.loading}><p>Đang nhận câu hỏi…</p></div>;
    const revealed = room.status === "reveal";
    const paused = room.status === "paused";

    return (
      <>
        <div className={styles.quizTop}>
          <div>
            <span className={styles.questionNumber}>CÂU {room.current_question + 1} / {room.question_count}</span>
            <div className={styles.progress}><i style={{ width: `${((room.current_question + 1) / room.question_count) * 100}%` }} /></div>
          </div>
          <div className={`${styles.timer} ${remaining <= 5 && !revealed && !paused ? styles.urgent : ""}`}>{revealed ? "✓" : paused ? "Ⅱ" : Math.ceil(remaining)}</div>
        </div>
        {paused && <div className={styles.pauseBanner}><strong>Quản trị đã tạm dừng</strong><span>Còn {Math.ceil(remaining)} giây khi tiếp tục.</span></div>}
        <div className={styles.question}><h2>{question.prompt}</h2></div>
        <div className={styles.answers}>
          {question.options.map((option, index) => {
            const selected = self?.selected_option === index;
            const resultClass = revealed
              ? index === question.correct_option ? styles.correct : styles.wrong
              : selected ? styles.selected : "";
            return (
              <button className={`${styles.answer} ${resultClass}`} disabled={answered || busy || room.status !== "playing"} onClick={() => answer(index)} key={index}>
                <span className={styles.answerShape}>{ANSWER_SHAPES[index]}</span>
                <strong>{option}</strong>
                <small>{revealed && index === question.correct_option ? "Đúng" : !revealed ? `Phím ${index + 1}` : ""}</small>
              </button>
            );
          })}
        </div>
        {answered && !revealed && !paused && <div className={`${styles.answerFeedback} ${styles.waiting}`}><strong>Đã ghi nhận đáp án!</strong><small>Hãy chờ các bạn còn lại hoặc chờ hết giờ.</small></div>}
        {revealed && (
          <div className={`${styles.answerFeedback} ${self?.is_correct ? styles.good : styles.bad}`}>
            <strong>{self?.is_correct ? `Chính xác! +${self.points} điểm` : "Chưa chính xác"}</strong>
            <small>Đáp án đúng: {question.options[question.correct_option ?? 0]}</small>
          </div>
        )}
      </>
    );
  };

  return (
    <main className={styles.shell}>
      <header className={styles.topbar}><span className={styles.brand}>KHOOT<span>!</span></span><span className={styles.role}>HỌC SINH · {self?.name}</span></header>
      <div className={styles.studentMain}>
        <div className={styles.studentStatus}><span>{room.title}</span><strong>{self?.score.toLocaleString("vi-VN")} điểm</strong></div>
        {error && <p className={styles.errorMessage}>{error}</p>}
        <section className={styles.studentStage}>{renderContent()}</section>
      </div>
    </main>
  );
}
