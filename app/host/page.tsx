"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  ANSWER_SHAPES,
  buildLobbyLink,
  buildPlayerLink,
  countdownValue,
  formatResponseTime,
  getBasePath,
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
  const [closing, setClosing] = useState(false);
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
    const fallback = window.setInterval(() => void loadRoom(), 2000);
    return () => {
      window.clearInterval(fallback);
      void supabase.removeChannel(channel);
    };
  }, [snapshot?.room.public_token, loadRoom]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  const remaining = snapshot
    ? snapshot.room.status === "paused" && snapshot.room.paused_remaining_seconds != null
      ? snapshot.room.paused_remaining_seconds
      : secondsRemaining(
        snapshot.room.question_started_at,
        snapshot.room.current_time_limit_seconds ?? snapshot.room.time_limit_seconds,
        now,
      )
    : 0;

  const canStart = Boolean(
    snapshot
    && snapshot.players.length === snapshot.room.max_players
    && snapshot.players.every((player) => player.is_ready)
  );
  const canStartCurrent = Boolean(
    snapshot
    && snapshot.players.length > 0
    && snapshot.players.length < snapshot.room.max_players
    && snapshot.players.every((player) => player.is_ready)
  );

  const startGame = async (useCurrentPlayers = false) => {
    if (!roomId || (!canStart && !useCurrentPlayers)) return;
    transitioning.current = true;
    const { data, error: startError } = await supabase.rpc(useCurrentPlayers ? "start_game_now" : "start_game", {
      p_room_id: roomId,
    });
    if (startError) setError(getErrorMessage(startError));
    else setSnapshot(data as GameSnapshot);
    transitioning.current = false;
  };

  const runHostAction = async (
    name: "pause_game" | "resume_game" | "add_game_time" | "skip_game_question",
    args: Record<string, unknown> = {},
  ) => {
    if (!roomId || transitioning.current) return;
    if (name === "skip_game_question" && !window.confirm("Bỏ qua câu hiện tại và chuyển sang câu tiếp theo?")) return;
    transitioning.current = true;
    const { data, error: actionError } = await supabase.rpc(name, { p_room_id: roomId, ...args });
    if (actionError) setError(getErrorMessage(actionError));
    else {
      setSnapshot(data as GameSnapshot);
      setError("");
    }
    transitioning.current = false;
  };

  const removePlayer = async (playerId: string, playerName: string) => {
    if (!roomId || transitioning.current || !window.confirm("Mời " + playerName + " ra khỏi phòng?")) return;
    transitioning.current = true;
    const { data, error: removeError } = await supabase.rpc("remove_game_player", {
      p_room_id: roomId,
      p_player_id: playerId,
    });
    if (removeError) setError(getErrorMessage(removeError));
    else setSnapshot(data as GameSnapshot);
    transitioning.current = false;
  };

  const playerLink = useMemo(
    () => snapshot
      ? snapshot.room.lobby_token
        ? buildLobbyLink(snapshot.room.lobby_token)
        : buildPlayerLink(snapshot.room.public_token)
      : "",
    [snapshot],
  );

  const hostMetrics = useMemo(() => {
    const stats = snapshot?.stats ?? [];
    const players = snapshot?.players ?? [];
    const questionCount = snapshot?.room.question_count ?? 0;
    const answered = stats.reduce((total, stat) => total + stat.answered_count, 0);
    const correct = stats.reduce((total, stat) => total + stat.correct_count, 0);
    const possibleAnswers = players.length * questionCount;
    const ready = players.filter((player) => player.is_ready).length;
    const waitingCurrent = players.filter((player) => !player.answered).length;
    const needsSupport = stats.filter((stat) => (
      stat.answered_count >= 2 && stat.correct_count / stat.answered_count < 0.5
    )).length;

    return {
      answered,
      correct,
      wrong: answered - correct,
      ready,
      waitingCurrent,
      needsSupport,
      progress: possibleAnswers > 0 ? Math.round((answered / possibleAnswers) * 100) : 0,
      accuracy: answered > 0 ? Math.round((correct / answered) * 100) : 0,
    };
  }, [snapshot]);

  const copyLink = async () => {
    await navigator.clipboard.writeText(playerLink);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const closeRoom = async () => {
    if (!roomId || !snapshot || closing || transitioning.current) return;
    const confirmed = window.confirm(
      snapshot.room.status === "finished"
        ? "Đóng phòng này? Link cố định sẽ trở về trạng thái chờ phiên mới. Kết quả vẫn được lưu."
        : "Đóng phòng ngay? Phiên thi sẽ kết thúc và học sinh không thể gửi thêm đáp án. Kết quả đã có vẫn được lưu.",
    );
    if (!confirmed) return;

    setClosing(true);
    transitioning.current = true;
    const { data, error: closeError } = await supabase.rpc("close_game_session", {
      p_room_id: roomId,
    });

    if (closeError) {
      setError(getErrorMessage(closeError));
      setClosing(false);
      transitioning.current = false;
      return;
    }

    const result = data as { lobby_token?: string | null };
    const lobbyToken = result.lobby_token ?? snapshot.room.lobby_token;
    window.location.assign(
      lobbyToken
        ? `${getBasePath()}/room/?room=${lobbyToken}`
        : `${getBasePath()}/admin/`,
    );
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
          <button className={styles.startButton} disabled={!canStart} onClick={() => void startGame(false)}>
            {canStart ? "Bắt đầu — 3, 2, 1!" : "Chưa thể bắt đầu"}
          </button>
          {canStartCurrent && (
            <button className={styles.startCurrentButton} onClick={() => void startGame(true)}>
              Bắt đầu với {snapshot.players.length} học sinh hiện tại
            </button>
          )}
          <p className={styles.helper}>Có thể chờ đủ số lượng đã đặt, hoặc bắt đầu sớm khi tất cả học sinh hiện tại đã sẵn sàng.</p>
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
    const paused = room.status === "paused";

    return (
      <>
        <div className={styles.quizTop}>
          <div>
            <span className={styles.questionNumber}>CÂU {room.current_question + 1} / {room.question_count}</span>
            <div className={styles.progress}><i style={{ width: `${((room.current_question + 1) / room.question_count) * 100}%` }} /></div>
          </div>
          <div className={`${styles.timer} ${remaining <= 5 && !revealed && !paused ? styles.urgent : ""}`}>
            {revealed ? "✓" : paused ? "Ⅱ" : Math.ceil(remaining)}
          </div>
        </div>
        {paused && <div className={styles.pauseBanner}><strong>Đã tạm dừng</strong><span>Còn {Math.ceil(remaining)} giây khi tiếp tục.</span></div>}
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
          <span>{paused ? "Đang tạm dừng nhận câu trả lời" : revealed ? "Đang hiển thị đáp án" : "Đang nhận câu trả lời realtime"}</span>
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
          <div className={styles.roomControls}>
            <div className={styles.timeChip}>
              <b>{room.status === "playing" || room.status === "paused" || room.status === "reveal" ? room.current_time_limit_seconds : room.time_limit_seconds}</b>
              {room.status === "playing" || room.status === "paused" || room.status === "reveal" ? "giây · câu hiện tại" : "giây · mặc định"}
            </div>
            <button className={styles.closeRoomButton} type="button" onClick={closeRoom} disabled={closing}>
              {closing ? "Đang đóng…" : "Đóng phòng"}
            </button>
          </div>
        </div>
        {error && <p className={styles.errorMessage}>{error}</p>}
        {["playing", "paused", "reveal"].includes(room.status) && (
          <section className={styles.gameControlBar} aria-label="Điều khiển phiên thi">
            {room.status === "paused" ? (
              <button onClick={() => void runHostAction("resume_game")}>▶ Tiếp tục</button>
            ) : room.status === "playing" ? (
              <button onClick={() => void runHostAction("pause_game")}>Ⅱ Tạm dừng</button>
            ) : null}
            {(room.status === "playing" || room.status === "paused") && (
              <button onClick={() => void runHostAction("add_game_time", { p_seconds: 10 })}>+10 giây</button>
            )}
            <button className={styles.skipButton} onClick={() => void runHostAction("skip_game_question")}>Bỏ qua câu →</button>
          </section>
        )}
        <section className={styles.classOverview} aria-label="Tổng quan lớp học">
          {room.status === "waiting" ? (
            <>
              <div className={styles.overviewCard}>
                <span>ĐÃ VÀO PHÒNG</span>
                <strong>{snapshot.players.length}/{room.max_players}</strong>
                <small>Số học sinh hiện có</small>
              </div>
              <div className={styles.overviewCard}>
                <span>ĐÃ SẴN SÀNG</span>
                <strong>{hostMetrics.ready}/{room.max_players}</strong>
                <small>Có thể bắt đầu khi đủ</small>
              </div>
              <div className={styles.overviewCard}>
                <span>CÒN THIẾU</span>
                <strong>{Math.max(room.max_players - snapshot.players.length, 0)}</strong>
                <small>Vị trí đang chờ</small>
              </div>
              <div className={styles.overviewCard}>
                <span>THỜI GIAN</span>
                <strong>{room.time_limit_seconds}s</strong>
                <small>Mỗi câu hỏi</small>
              </div>
            </>
          ) : (
            <>
              <div className={styles.overviewCard}>
                <span>TIẾN ĐỘ LỚP</span>
                <strong>{hostMetrics.progress}%</strong>
                <small>{hostMetrics.answered}/{snapshot.players.length * room.question_count} lượt đã làm</small>
              </div>
              <div className={styles.overviewCard}>
                <span>ĐỘ CHÍNH XÁC</span>
                <strong>{hostMetrics.answered > 0 ? `${hostMetrics.accuracy}%` : "—"}</strong>
                <small>{hostMetrics.correct} đúng · {hostMetrics.wrong} sai</small>
              </div>
              <div className={styles.overviewCard}>
                <span>TRẠNG THÁI CÂU NÀY</span>
                <strong>
                  {room.status === "countdown"
                    ? "3, 2, 1"
                    : room.status === "finished"
                      ? "Xong"
                      : hostMetrics.waitingCurrent}
                </strong>
                <small>
                  {room.status === "countdown"
                    ? "Đang chuẩn bị"
                    : room.status === "finished"
                      ? "Tất cả đã hoàn thành"
                      : "Học sinh chưa trả lời"}
                </small>
              </div>
              <div className={[styles.overviewCard, hostMetrics.needsSupport > 0 ? styles.overviewAlert : ""].filter(Boolean).join(" ")}>
                <span>CẦN THEO DÕI</span>
                <strong>{hostMetrics.needsSupport}</strong>
                <small>Độ chính xác dưới 50% sau ≥ 2 câu</small>
              </div>
            </>
          )}
        </section>
        <div className={styles.hostGrid}>
          <section className={styles.stage}>{renderStage()}</section>
          <aside className={styles.sidePanel}>
            {room.status === "waiting" && (
              <div className={styles.linkCard}>
                <span>LINK PHÒNG CỐ ĐỊNH · QUẢN TRỊ VÀ {room.max_players} HỌC SINH</span>
                <div className={styles.linkRow}><input readOnly value={playerLink} /><button onClick={copyLink}>{copied ? "Đã chép" : "Sao chép"}</button></div>
              </div>
            )}
            <span className={styles.eyebrow}>THEO DÕI HỌC SINH</span>
            <h2>{snapshot.players.length}/{room.max_players} học sinh</h2>
            <div className={styles.playerList}>
              {Array.from({ length: room.max_players }, (_, index) => {
                const player = snapshot.players[index];
                if (!player) {
                  return (
                    <div className={`${styles.playerCard} ${styles.emptyPlayer}`} key={index}><i>?</i><strong>Đang chờ…</strong><span>·</span></div>
                  );
                }

                if (room.status === "waiting" || room.status === "countdown") {
                  return (
                    <div className={`${styles.playerCard} ${player.is_ready ? styles.ready : ""}`} key={player.id}>
                      <i>{player.name[0].toUpperCase()}</i>
                      <div>
                        <strong>{player.name}</strong><br />
                        <small>{room.status === "countdown" ? "Đang chuẩn bị" : player.is_ready ? "Sẵn sàng" : "Chưa sẵn sàng"} · {player.is_online ? "Đang online" : "Mất kết nối"}</small>
                      </div>
                      {room.status === "waiting" ? (
                        <button className={styles.removePlayerButton} onClick={() => void removePlayer(player.id, player.name)} title="Mời khỏi phòng">×</button>
                      ) : <span>{room.status === "countdown" ? "3" : player.is_ready ? "✓" : "·"}</span>}
                    </div>
                  );
                }

                const stat = snapshot.stats.find((item) => item.player_id === player.id);
                const answeredCount = stat?.answered_count ?? 0;
                const correctCount = stat?.correct_count ?? 0;
                const wrongCount = answeredCount - correctCount;
                const remainingCount = Math.max(room.question_count - answeredCount, 0);
                const accuracy = answeredCount > 0 ? Math.round((correctCount / answeredCount) * 100) : 0;
                const needsSupport = answeredCount >= 2 && accuracy < 50;
                const statusLabel = room.status === "finished"
                  ? "Hoàn thành"
                  : !player.is_online
                    ? "Mất kết nối"
                    : room.status === "paused"
                      ? "Tạm dừng"
                  : room.status === "reveal"
                    ? player.answered ? "Đã trả lời" : "Bỏ trống"
                    : player.answered ? "Đã trả lời" : "Đang làm";

                return (
                  <article
                    className={[
                      styles.playerMonitorCard,
                      player.answered || room.status === "finished" ? styles.currentAnswered : "",
                      needsSupport ? styles.needsSupport : "",
                    ].filter(Boolean).join(" ")}
                    key={player.id}
                  >
                    <div className={styles.monitorHeader}>
                      <i className={styles.monitorAvatar}>{player.name[0].toUpperCase()}</i>
                      <div className={styles.monitorIdentity}>
                        <strong>#{index + 1} · {player.name}</strong>
                        <small>{(stat?.score ?? player.score).toLocaleString("vi-VN")} điểm</small>
                      </div>
                      <span className={styles.monitorStatus}>{statusLabel}</span>
                    </div>
                    <div className={styles.monitorProgress} aria-label={`${answeredCount} trên ${room.question_count} câu đã làm`}>
                      <i style={{ width: String((answeredCount / room.question_count) * 100) + "%" }} />
                    </div>
                    <div className={styles.monitorStats}>
                      <div><span>ĐÚNG</span><strong>{correctCount}</strong></div>
                      <div><span>SAI</span><strong>{wrongCount}</strong></div>
                      <div><span>CÒN</span><strong>{remainingCount}</strong></div>
                    </div>
                    <div className={styles.monitorFooter}>
                      <span>Chính xác <b>{answeredCount > 0 ? `${accuracy}%` : "—"}</b></span>
                      <span>Tốc độ TB <b>{answeredCount > 0 && stat ? formatResponseTime(stat.average_response_ms) : "—"}</b></span>
                    </div>
                    {needsSupport && <small className={styles.supportWarning}>Cần theo dõi · độ chính xác dưới 50%</small>}
                  </article>
                );
              })}
            </div>
          </aside>
        </div>
        {room.status === "finished" && Boolean(snapshot.history?.length) && (
          <section className={styles.historyPanel} aria-labelledby="answer-history-title">
            <div className={styles.historyHeading}>
              <div>
                <span className={styles.eyebrow}>CHI TIẾT TỪNG CÂU</span>
                <h2 id="answer-history-title">Lịch sử trả lời của học sinh</h2>
                <p>Mỗi hàng là một câu hỏi. Cuộn ngang để xem toàn bộ học sinh.</p>
              </div>
              <div className={styles.historyLegend} aria-label="Chú thích kết quả">
                <span className={styles.legendCorrect}>✓ Đúng</span>
                <span className={styles.legendWrong}>✕ Sai</span>
                <span className={styles.legendEmpty}>— Bỏ trống</span>
              </div>
            </div>
            <div className={styles.historyTableWrap}>
              <table className={styles.historyTable}>
                <thead>
                  <tr>
                    <th className={styles.historyQuestionColumn} scope="col">CÂU HỎI</th>
                    {snapshot.stats.map((stat, index) => (
                      <th className={styles.historyPlayerColumn} scope="col" key={stat.player_id}>
                        <small>HẠNG {index + 1}</small>
                        <strong>{stat.name}</strong>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {snapshot.history?.map((historyQuestion) => {
                    const answersByPlayer = new Map(
                      historyQuestion.answers.map((answer) => [answer.player_id, answer]),
                    );
                    const correctLetter = String.fromCharCode(65 + historyQuestion.correct_option);

                    return (
                      <tr key={historyQuestion.id}>
                        <th className={styles.historyQuestionCell} scope="row">
                          <span>CÂU {historyQuestion.position + 1}</span>
                          <strong>{historyQuestion.prompt}</strong>
                          <small>
                            Đáp án đúng: {correctLetter}. {historyQuestion.options[historyQuestion.correct_option]}
                          </small>
                        </th>
                        {snapshot.stats.map((stat) => {
                          const answer = answersByPlayer.get(stat.player_id);
                          if (!answer) {
                            return (
                              <td className={styles.historyEmpty} key={stat.player_id}>
                                <b>—</b>
                                <strong>Bỏ trống</strong>
                                <small>Không có câu trả lời</small>
                              </td>
                            );
                          }

                          const selectedLetter = String.fromCharCode(65 + answer.selected_option);
                          return (
                            <td
                              className={answer.is_correct ? styles.historyCorrect : styles.historyWrong}
                              key={stat.player_id}
                            >
                              <b>{answer.is_correct ? "✓" : "✕"}</b>
                              <strong>{selectedLetter}. {historyQuestion.options[answer.selected_option]}</strong>
                              <small>
                                {answer.is_correct ? "Trả lời đúng" : "Trả lời sai"} · {formatResponseTime(answer.response_ms)}
                              </small>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
