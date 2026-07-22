"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  getBasePath,
  getErrorMessage,
  getRoomToken,
  type GameLobbyResolution,
  type GameStatus,
} from "@/lib/game";
import styles from "./room.module.css";

const STATUS_LABELS: Record<GameStatus, string> = {
  waiting: "Đang chờ học sinh",
  countdown: "Đang đếm ngược",
  playing: "Đang chơi",
  reveal: "Đang xem đáp án",
  finished: "Phiên đã kết thúc",
};

export default function RoomPage() {
  const [roomToken, setRoomToken] = useState("");
  const [authReady, setAuthReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [resolution, setResolution] = useState<GameLobbyResolution | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const setupTimer = window.setTimeout(() => {
      setRoomToken(getRoomToken());
      setInitialized(true);
    }, 0);
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

  const loadLobby = useCallback(async () => {
    if (!roomToken) return;
    const { data, error: lobbyError } = await supabase.rpc("resolve_game_lobby", {
      p_lobby_token: roomToken,
    });
    if (lobbyError) {
      setError(getErrorMessage(lobbyError));
      return;
    }
    setResolution(data as GameLobbyResolution);
    setError("");
  }, [roomToken]);

  useEffect(() => {
    if (!authReady || !roomToken) return;
    const loadTimer = window.setTimeout(() => void loadLobby(), 0);
    return () => window.clearTimeout(loadTimer);
  }, [authReady, authenticated, roomToken, loadLobby]);

  useEffect(() => {
    if (!resolution?.lobby.public_token) return;
    const channel = supabase
      .channel(`lobby:${resolution.lobby.public_token}`, { config: { private: false } })
      .on("broadcast", { event: "state" }, () => void loadLobby())
      .subscribe();
    const fallback = window.setInterval(() => void loadLobby(), 3000);
    return () => {
      window.clearInterval(fallback);
      void supabase.removeChannel(channel);
    };
  }, [resolution?.lobby.public_token, loadLobby]);

  const activeGame = resolution?.active_game ?? null;
  const studentButton = useMemo(() => {
    if (!activeGame) return { label: "Đang chờ phiên mới", disabled: true };
    if (activeGame.status === "finished") return { label: "Chờ quản trị mở phiên mới", disabled: true };
    if (activeGame.status === "waiting") return { label: "Vào phòng học sinh →", disabled: false };
    return { label: "Mở phiên đang diễn ra →", disabled: false };
  }, [activeGame]);

  const openStudent = () => {
    if (!activeGame || studentButton.disabled) return;
    window.location.assign(
      `${getBasePath()}/play/?room=${activeGame.public_token}&lobby=${roomToken}`,
    );
  };

  const openAdmin = () => {
    if (resolution?.is_host) {
      if (activeGame?.id && activeGame.status !== "finished") {
        window.location.assign(`${getBasePath()}/host/?room=${activeGame.id}`);
      } else {
        window.location.assign(`${getBasePath()}/admin/`);
      }
      return;
    }
    if (!authenticated) {
      window.location.assign(`${getBasePath()}/admin/?lobby=${roomToken}`);
    }
  };

  if (!initialized || !authReady) {
    return <main className={styles.shell}><div className={styles.loading}><strong>KHOOT!</strong><p>Đang mở phòng cố định…</p></div></main>;
  }

  if (!roomToken || error && !resolution) {
    return (
      <main className={styles.shell}>
        <div className={styles.errorState}>
          <span>!</span>
          <h1>Không mở được phòng</h1>
          <p>{error || "Liên kết phòng đang thiếu mã nhận diện."}</p>
          <Link href="/">Về trang chủ</Link>
        </div>
      </main>
    );
  }

  if (!resolution) {
    return <main className={styles.shell}><div className={styles.loading}><strong>KHOOT!</strong><p>Đang kiểm tra phiên chơi…</p></div></main>;
  }

  const adminDisabled = authenticated && !resolution.is_host;
  const adminLabel = resolution.is_host
    ? activeGame?.id && activeGame.status !== "finished" ? "Điều khiển phiên hiện tại →" : "Chọn bộ đề và mở phiên →"
    : authenticated ? "Không phải chủ phòng" : "Đăng nhập quản trị →";

  return (
    <main className={styles.shell}>
      <header className={styles.topbar}>
        <Link className={styles.brand} href="/">KHOOT<span>!</span></Link>
        <span className={styles.permanentBadge}>LINK PHÒNG CỐ ĐỊNH</span>
      </header>
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <span className={styles.eyebrow}>PHÒNG HỌC TRỰC TUYẾN</span>
          <h1>{resolution.lobby.name}</h1>
          <p>Đây là liên kết dùng chung và sẽ không thay đổi. Hãy chọn đúng vai trò để tiếp tục.</p>
          <div className={`${styles.status} ${activeGame && activeGame.status !== "finished" ? styles.live : ""}`}>
            <i />
            <span>{activeGame ? STATUS_LABELS[activeGame.status] : "Chưa có phiên chơi"}</span>
            {activeGame && <strong>{activeGame.title}</strong>}
          </div>
        </div>
        <div className={styles.roleGrid}>
          <article className={styles.adminCard}>
            <div className={styles.cardTop}><span>01</span><i>◆</i></div>
            <span className={styles.cardEyebrow}>VAI TRÒ QUẢN TRỊ</span>
            <h2>Tôi là quản trị viên</h2>
            <p>Đăng nhập để chọn bộ đề, đặt số học sinh và điều khiển phiên chơi.</p>
            <button type="button" onClick={openAdmin} disabled={adminDisabled}>{adminLabel}</button>
            {adminDisabled && <small>Tài khoản đang đăng nhập không sở hữu phòng này.</small>}
          </article>
          <article className={styles.studentCard}>
            <div className={styles.cardTop}><span>02</span><i>●</i></div>
            <span className={styles.cardEyebrow}>VAI TRÒ HỌC SINH</span>
            <h2>Tôi là học sinh</h2>
            <p>Không cần tài khoản. Nhập tên, bấm sẵn sàng và chờ quản trị bắt đầu.</p>
            <button type="button" onClick={openStudent} disabled={studentButton.disabled}>{studentButton.label}</button>
            {activeGame && activeGame.status !== "finished" && <small>Tối đa {activeGame.max_players} học sinh trong phiên này.</small>}
          </article>
        </div>
      </section>
      <footer className={styles.footer}>
        <span>GIỮ LINK NÀY CHO NHỮNG LẦN CHƠI SAU</span>
        <span>Phòng cố định · Phiên chơi tách biệt · Kết quả không bị trộn</span>
      </footer>
    </main>
  );
}
