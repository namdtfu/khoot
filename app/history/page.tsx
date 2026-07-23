"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { gameHistoryToCsv, downloadTextFile, safeFilename } from "@/lib/export";
import { getErrorMessage, type GameHistorySummary, type GameSnapshot } from "@/lib/game";
import { supabase } from "@/lib/supabase";
import styles from "./history.module.css";

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function HistoryPage() {
  const [ready, setReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [items, setItems] = useState<GameHistorySummary[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadList = useCallback(async () => {
    setLoading(true);
    const { data, error: listError } = await supabase.rpc("list_game_history");
    if (listError) {
      setError(getErrorMessage(listError));
      setLoading(false);
      return;
    }
    const next = (data ?? []) as GameHistorySummary[];
    setItems(next);
    setSelectedId((current) => current || next[0]?.id || "");
    setError("");
    setLoading(false);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setAuthenticated(Boolean(data.session));
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthenticated(Boolean(session));
      setReady(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    const timer = window.setTimeout(() => void loadList(), 0);
    return () => window.clearTimeout(timer);
  }, [authenticated, loadList]);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    const loadDetail = async () => {
      setLoading(true);
      const { data, error: detailError } = await supabase.rpc("get_game_history", { p_room_id: selectedId });
      if (cancelled) return;
      if (detailError) setError(getErrorMessage(detailError));
      else {
        setSnapshot(data as GameSnapshot);
        setError("");
      }
      setLoading(false);
    };
    const timer = window.setTimeout(() => void loadDetail(), 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [selectedId]);

  const selectedSummary = useMemo(
    () => items.find((item) => item.id === selectedId) ?? null,
    [items, selectedId],
  );

  const exportCsv = () => {
    if (!snapshot) return;
    downloadTextFile(
      gameHistoryToCsv(snapshot),
      safeFilename(snapshot.room.title) + "-ket-qua.csv",
      "text/csv;charset=utf-8",
    );
  };

  if (!ready) return <main className={styles.state}><strong>KHOOT!</strong><p>Đang mở lịch sử…</p></main>;
  if (!authenticated) {
    return <main className={styles.state}><h1>Cần đăng nhập</h1><p>Đăng nhập bằng tài khoản quản trị để xem dữ liệu lớp.</p><Link href="/admin">Về trang đăng nhập</Link></main>;
  }

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <Link href="/admin" className={styles.brand}>KHOOT<span>!</span></Link>
        <div><span>BÁO CÁO LỚP HỌC</span><strong>Lịch sử các phiên thi</strong></div>
        <Link href="/admin" className={styles.back}>← Quản lý bộ đề</Link>
      </header>
      <div className={styles.layout}>
        <aside className={styles.sidebar}>
          <div className={styles.sidebarTitle}><strong>{items.length} phiên đã kết thúc</strong><button onClick={() => void loadList()}>Làm mới</button></div>
          {items.map((item) => (
            <button className={item.id === selectedId ? styles.activeItem : styles.item} onClick={() => setSelectedId(item.id)} key={item.id}>
              <strong>{item.title}</strong>
              <span>{formatDate(item.finished_at)}</span>
              <small>{item.player_count} học sinh · {item.question_count} câu · {item.scoring_mode === "speed" ? "đúng & nhanh" : "chỉ cần đúng"}</small>
            </button>
          ))}
          {!items.length && !loading && <p className={styles.empty}>Chưa có phiên thi nào kết thúc.</p>}
        </aside>
        <section className={styles.content}>
          {error && <p className={styles.error}>{error}</p>}
          {loading && !snapshot ? <p className={styles.loading}>Đang tải dữ liệu…</p> : snapshot && selectedSummary ? (
            <>
              <div className={styles.hero}>
                <div><span>KẾT QUẢ PHIÊN THI</span><h1>{snapshot.room.title}</h1><p>Kết thúc lúc {formatDate(snapshot.room.finished_at)}</p></div>
                <button onClick={exportCsv}>Tải bảng CSV</button>
              </div>
              <div className={styles.metrics}>
                <article><span>HỌC SINH</span><strong>{selectedSummary.player_count}</strong></article>
                <article><span>SỐ CÂU</span><strong>{selectedSummary.question_count}</strong></article>
                <article><span>ĐỘ CHÍNH XÁC</span><strong>{selectedSummary.answer_count ? Math.round(selectedSummary.correct_count / selectedSummary.answer_count * 100) : 0}%</strong></article>
                <article><span>ĐIỂM TRUNG BÌNH</span><strong>{selectedSummary.average_score.toLocaleString("vi-VN")}</strong></article>
              </div>
              <section className={styles.ranking}>
                <h2>Bảng xếp hạng</h2>
                {snapshot.stats.map((stat, index) => (
                  <div key={stat.player_id}><b>#{index + 1}</b><strong>{stat.name}</strong><span>{stat.correct_count}/{snapshot.room.question_count} đúng</span><em>{stat.score.toLocaleString("vi-VN")} điểm</em></div>
                ))}
              </section>
              <section className={styles.matrix}>
                <div><h2>Chi tiết từng câu</h2><p>Mỗi ô cho biết câu trả lời và đúng/sai của từng học sinh.</p></div>
                <div className={styles.tableWrap}>
                  <table>
                    <thead><tr><th>Câu hỏi</th>{snapshot.stats.map((stat) => <th key={stat.player_id}>{stat.name}</th>)}</tr></thead>
                    <tbody>
                      {(snapshot.history ?? []).map((question) => (
                        <tr key={question.id}>
                          <th><b>Câu {question.position + 1}</b><strong>{question.prompt}</strong><small>Đúng: {question.options[question.correct_option]}</small></th>
                          {snapshot.stats.map((stat) => {
                            const answer = question.answers.find((item) => item.player_id === stat.player_id);
                            return <td className={!answer ? styles.blank : answer.is_correct ? styles.correct : styles.wrong} key={stat.player_id}>
                              <b>{!answer ? "—" : answer.is_correct ? "✓" : "×"}</b>
                              <span>{answer ? question.options[answer.selected_option] : "Không trả lời"}</span>
                            </td>;
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          ) : !loading && <div className={styles.emptyDetail}><h1>Chưa có dữ liệu</h1><p>Sau khi đóng hoặc hoàn thành một phiên thi, báo cáo sẽ xuất hiện tại đây.</p></div>}
        </section>
      </div>
    </main>
  );
}
