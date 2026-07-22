"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { getBasePath, getErrorMessage, type GameSnapshot } from "@/lib/game";
import { parseQuestionText } from "@/lib/question-import";
import styles from "./admin.module.css";

type QuestionSet = {
  id: string;
  owner_id: string;
  title: string;
  topic: string;
  description: string;
  is_published: boolean;
  time_limit_seconds: number;
  created_at: string;
  updated_at: string;
};

type Question = {
  id: string;
  set_id: string;
  prompt: string;
  options: string[];
  correct_option: number;
  position: number;
};

const EMPTY_QUESTION = {
  prompt: "",
  options: ["", "", "", ""],
  correct_option: 0,
};

const IMPORT_EXAMPLE = `Câu 1: Từ “hello” có nghĩa là gì?
A. Xin chào
B. Tạm biệt
C. Cảm ơn
D. Xin lỗi
Đáp án: A

Câu 2: Từ “goodbye” có nghĩa là gì?
A. Chào buổi sáng
B. Tạm biệt
C. Cảm ơn
D. Làm ơn
Đáp án: B`;

export default function AdminPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [sets, setSets] = useState<QuestionSet[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [packForm, setPackForm] = useState({ title: "", topic: "", description: "", is_published: false, time_limit_seconds: 20 });
  const [roomSize, setRoomSize] = useState(5);
  const [questionForm, setQuestionForm] = useState({ ...EMPTY_QUESTION });
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importForm, setImportForm] = useState({ title: "Bộ đề nhập nhanh", topic: "Tổng hợp", time_limit_seconds: 20 });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const selectedSet = useMemo(() => sets.find((item) => item.id === selectedId) ?? null, [sets, selectedId]);
  const importPreview = useMemo(() => parseQuestionText(importText), [importText]);

  const showError = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    const schemaMissing = message.includes("question_sets") || message.includes("schema cache");
    setNotice({
      type: "error",
      text: schemaMissing
        ? "Cơ sở dữ liệu chưa có cấu trúc Khoot. Hãy chạy tệp migration Supabase một lần."
        : message,
    });
  };

  const loadSets = useCallback(async (userId: string) => {
    const { data, error } = await supabase
      .from("question_sets")
      .select("*")
      .eq("owner_id", userId)
      .order("updated_at", { ascending: false });
    if (error) throw error;
    const nextSets = (data ?? []) as QuestionSet[];
    setSets(nextSets);
    setSelectedId((current) => current && nextSets.some((item) => item.id === current) ? current : nextSets[0]?.id ?? null);
  }, []);

  const loadQuestions = useCallback(async (setId: string) => {
    const { data, error } = await supabase
      .from("questions")
      .select("*")
      .eq("set_id", setId)
      .order("position");
    if (error) throw error;
    setQuestions((data ?? []) as Question[]);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthReady(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const sessionTimer = window.setTimeout(() => {
      if (!session) { setSets([]); setSelectedId(null); return; }
      loadSets(session.user.id).catch(showError);
    }, 0);
    return () => window.clearTimeout(sessionTimer);
  }, [session, loadSets]);

  useEffect(() => {
    const selectionTimer = window.setTimeout(() => {
      if (!selectedSet) { setQuestions([]); return; }
      setPackForm({
        title: selectedSet.title,
        topic: selectedSet.topic,
        description: selectedSet.description,
        is_published: selectedSet.is_published,
        time_limit_seconds: selectedSet.time_limit_seconds,
      });
      setImportOpen(false);
      setEditorOpen(false);
      loadQuestions(selectedSet.id).catch(showError);
    }, 0);
    return () => window.clearTimeout(selectionTimer);
  }, [selectedSet, loadQuestions]);

  const submitAuth = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setNotice(null);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    } catch (error) { showError(error); }
    finally { setBusy(false); }
  };

  const createSet = async () => {
    if (!session) return;
    setBusy(true); setNotice(null);
    try {
      const { data, error } = await supabase
        .from("question_sets")
        .insert({ owner_id: session.user.id, title: "Bộ đề mới", topic: "Tổng hợp" })
        .select()
        .single();
      if (error) throw error;
      setSets((current) => [data as QuestionSet, ...current]);
      setSelectedId(data.id);
      setNotice({ type: "success", text: "Đã tạo bộ đề mới." });
    } catch (error) { showError(error); }
    finally { setBusy(false); }
  };

  const saveSet = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedSet || !packForm.title.trim() || !packForm.topic.trim()) return;
    setBusy(true); setNotice(null);
    try {
      const { data, error } = await supabase
        .from("question_sets")
        .update({ ...packForm, title: packForm.title.trim(), topic: packForm.topic.trim() })
        .eq("id", selectedSet.id)
        .select()
        .single();
      if (error) throw error;
      setSets((current) => current.map((item) => item.id === data.id ? data as QuestionSet : item));
      setNotice({ type: "success", text: "Đã lưu thông tin bộ đề." });
    } catch (error) { showError(error); }
    finally { setBusy(false); }
  };

  const deleteSet = async () => {
    if (!selectedSet || !window.confirm(`Xóa “${selectedSet.title}” và toàn bộ câu hỏi?`)) return;
    setBusy(true); setNotice(null);
    try {
      const { error } = await supabase.from("question_sets").delete().eq("id", selectedSet.id);
      if (error) throw error;
      const remaining = sets.filter((item) => item.id !== selectedSet.id);
      setSets(remaining); setSelectedId(remaining[0]?.id ?? null);
      setNotice({ type: "success", text: "Đã xóa bộ đề." });
    } catch (error) { showError(error); }
    finally { setBusy(false); }
  };

  const createGameRoom = async () => {
    if (!selectedSet) return;
    setBusy(true); setNotice(null);
    try {
      const { data, error } = await supabase.rpc("create_game", {
        p_question_set_id: selectedSet.id,
        p_max_players: roomSize,
      });
      if (error) throw error;
      const snapshot = data as GameSnapshot;
      window.location.assign(`${getBasePath()}/host/?room=${snapshot.room.id}`);
    } catch (error) {
      setNotice({ type: "error", text: getErrorMessage(error) });
      setBusy(false);
    }
  };

  const openNewQuestion = () => {
    setEditingQuestionId(null);
    setQuestionForm({ prompt: "", options: ["", "", "", ""], correct_option: 0 });
    setEditorOpen(true);
  };

  const openImporter = () => {
    setImportForm({ title: `Bộ đề nhập nhanh ${sets.length + 1}`, topic: "Tổng hợp", time_limit_seconds: 20 });
    setImportText("");
    setEditorOpen(false);
    setImportOpen(true);
    setNotice(null);
  };

  const importQuestionSet = async (event: FormEvent) => {
    event.preventDefault();
    if (!session || importPreview.errors.length || !importPreview.questions.length) return;
    if (!importForm.title.trim() || !importForm.topic.trim()) return;

    setBusy(true);
    setNotice(null);
    let createdSetId: string | null = null;

    try {
      const { data, error } = await supabase
        .from("question_sets")
        .insert({
          owner_id: session.user.id,
          title: importForm.title.trim(),
          topic: importForm.topic.trim(),
          description: "Bộ đề được nhập nhanh từ văn bản.",
          is_published: false,
          time_limit_seconds: importForm.time_limit_seconds,
        })
        .select()
        .single();
      if (error) throw error;

      const createdSet = data as QuestionSet;
      createdSetId = createdSet.id;
      const questionRows = importPreview.questions.map((question, position) => ({
        set_id: createdSet.id,
        prompt: question.prompt,
        options: question.options,
        correct_option: question.correct_option,
        position,
      }));

      for (let index = 0; index < questionRows.length; index += 100) {
        const { error: questionError } = await supabase.from("questions").insert(questionRows.slice(index, index + 100));
        if (questionError) throw questionError;
      }

      setSets((current) => [createdSet, ...current]);
      setSelectedId(createdSet.id);
      setImportOpen(false);
      setImportText("");
      setNotice({ type: "success", text: `Đã tạo “${createdSet.title}” với ${questionRows.length} câu hỏi.` });
    } catch (error) {
      if (createdSetId) await supabase.from("question_sets").delete().eq("id", createdSetId);
      showError(error);
    } finally {
      setBusy(false);
    }
  };

  const openQuestion = (question: Question) => {
    setEditingQuestionId(question.id);
    setQuestionForm({
      prompt: question.prompt,
      options: [...question.options],
      correct_option: question.correct_option,
    });
    setEditorOpen(true);
  };

  const saveQuestion = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedSet) return;
    if (!questionForm.prompt.trim() || questionForm.options.some((option) => !option.trim())) {
      setNotice({ type: "error", text: "Hãy nhập nội dung và đủ 4 đáp án." });
      return;
    }
    setBusy(true); setNotice(null);
    const payload = {
      set_id: selectedSet.id,
      prompt: questionForm.prompt.trim(),
      options: questionForm.options.map((option) => option.trim()),
      correct_option: questionForm.correct_option,
      position: editingQuestionId
        ? questions.find((item) => item.id === editingQuestionId)?.position ?? 0
        : questions.length,
    };
    try {
      const query = editingQuestionId
        ? supabase.from("questions").update(payload).eq("id", editingQuestionId)
        : supabase.from("questions").insert(payload);
      const { error } = await query;
      if (error) throw error;
      await loadQuestions(selectedSet.id);
      setEditorOpen(false);
      setNotice({ type: "success", text: editingQuestionId ? "Đã cập nhật câu hỏi." : "Đã thêm câu hỏi." });
    } catch (error) { showError(error); }
    finally { setBusy(false); }
  };

  const deleteQuestion = async (question: Question) => {
    if (!window.confirm("Xóa câu hỏi này?")) return;
    setBusy(true); setNotice(null);
    try {
      const { error } = await supabase.from("questions").delete().eq("id", question.id);
      if (error) throw error;
      setQuestions((current) => current.filter((item) => item.id !== question.id));
      if (editingQuestionId === question.id) setEditorOpen(false);
      setNotice({ type: "success", text: "Đã xóa câu hỏi." });
    } catch (error) { showError(error); }
    finally { setBusy(false); }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setNotice(null);
  };

  if (!authReady) {
    return <main className={styles.loading}><span>KHOOT!</span><p>Đang mở khu vực quản trị…</p></main>;
  }

  if (!session) {
    return (
      <main className={styles.authShell}>
        <Link className={styles.backLink} href="/">← Về trang chơi</Link>
        <section className={styles.authIntro}>
          <span className={styles.kicker}>TRÌNH TẠO BỘ ĐỀ</span>
          <h1>Tạo bộ câu hỏi.<br /><em>Chơi theo cách của bạn.</em></h1>
          <p>Soạn câu hỏi trắc nghiệm cho bất kỳ chủ đề nào, lưu an toàn và quản lý ở một nơi.</p>
          <div className={styles.featureRow}>
            <span><b>01</b> Nhiều lĩnh vực</span>
            <span><b>02</b> 4 đáp án</span>
            <span><b>03</b> Chấm điểm tự động</span>
          </div>
        </section>
        <section className={styles.authCard}>
          <span className={styles.cardEyebrow}>CHÀO MỪNG TRỞ LẠI</span>
          <h2>Vào phòng quản trị</h2>
          <form onSubmit={submitAuth}>
            <label>Địa chỉ email
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="admin@example.com" autoComplete="email" required />
            </label>
            <label>Mật khẩu
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Tối thiểu 6 ký tự" minLength={6} autoComplete="current-password" required />
            </label>
            {notice && <p className={notice.type === "error" ? styles.errorNotice : styles.successNotice}>{notice.text}</p>}
            <button className={styles.submitButton} disabled={busy} type="submit">
              {busy ? "Đang xử lý…" : "Đăng nhập →"}
            </button>
          </form>
          <small>Tài khoản quản trị được tạo trực tiếp trong Supabase.</small>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.dashboard}>
      <header className={styles.header}>
        <Link className={styles.logo} href="/">KHOOT<span>!</span></Link>
        <div className={styles.headerTitle}><span>TRANG QUẢN TRỊ</span><strong>Ngân hàng câu hỏi</strong></div>
        <div className={styles.account}>
          <div><span>ĐANG ĐĂNG NHẬP</span><strong>{session.user.email}</strong></div>
          <button onClick={signOut}>Đăng xuất</button>
        </div>
      </header>
      <div className={styles.workspace}>
        <aside className={styles.sidebar}>
          <div className={styles.sidebarHeading}>
            <div><span>BỘ ĐỀ CỦA BẠN</span><strong>{sets.length} bộ đề</strong></div>
            <button onClick={createSet} disabled={busy} aria-label="Tạo bộ đề mới">+</button>
          </div>
          <button className={styles.importLauncher} onClick={openImporter} disabled={busy}>↓ Nhập từ văn bản</button>
          <div className={styles.setList}>
            {sets.map((item) => (
              <button key={item.id} className={item.id === selectedId ? styles.activeSet : ""} onClick={() => setSelectedId(item.id)}>
                <span className={styles.setIcon}>{item.topic.slice(0, 1).toUpperCase()}</span>
                <span><strong>{item.title}</strong><small>{item.topic}</small></span>
                <i className={item.is_published ? styles.publishedDot : ""} />
              </button>
            ))}
            {!sets.length && <div className={styles.emptySets}><span>✦</span><p>Chưa có bộ đề nào.</p><button onClick={createSet}>Tạo bộ đề đầu tiên</button></div>}
          </div>
          <div className={styles.sidebarHelp}><span>GỢI Ý</span><p>Mỗi câu hỏi luôn có đúng 4 lựa chọn và 1 đáp án chính xác.</p></div>
        </aside>
        <section className={styles.content}>
          {notice && <div className={notice.type === "error" ? styles.errorBanner : styles.successBanner}>{notice.text}<button onClick={() => setNotice(null)}>×</button></div>}
          {importOpen ? (
            <form className={styles.importPanel} onSubmit={importQuestionSet}>
              <div className={styles.sectionTitle}>
                <div><span>NHẬP NHANH</span><strong>Tạo bộ đề từ văn bản</strong></div>
                <button className={styles.closeButton} type="button" onClick={() => setImportOpen(false)}>×</button>
              </div>
              <p className={styles.importIntro}>Dán toàn bộ danh sách vào ô bên dưới. Khoot sẽ tự nhận diện câu hỏi, bốn lựa chọn và đáp án đúng trước khi lưu.</p>
              <div className={styles.importSettings}>
                <label>Tên bộ đề
                  <input value={importForm.title} onChange={(event) => setImportForm({ ...importForm, title: event.target.value })} maxLength={120} required />
                </label>
                <label>Lĩnh vực
                  <input value={importForm.topic} onChange={(event) => setImportForm({ ...importForm, topic: event.target.value })} maxLength={80} required />
                </label>
                <label>Thời gian mỗi câu
                  <input type="number" min={5} max={120} value={importForm.time_limit_seconds} onChange={(event) => setImportForm({ ...importForm, time_limit_seconds: Number(event.target.value) })} required />
                </label>
              </div>
              <div className={styles.importGuide}>
                <strong>Định dạng:</strong> Câu 1: … A. … B. … C. … D. … Đáp án: B
                <span>Có thể viết liền trên một dòng hoặc xuống dòng. Bạn cũng có thể đặt dấu * trước lựa chọn đúng.</span>
              </div>
              <label className={styles.importTextLabel}>Danh sách câu hỏi
                <textarea
                  value={importText}
                  onChange={(event) => setImportText(event.target.value)}
                  rows={14}
                  placeholder={IMPORT_EXAMPLE}
                  spellCheck={false}
                  autoFocus
                  required
                />
              </label>
              <div className={styles.importResult} aria-live="polite">
                {!importText.trim() ? (
                  <p>Dán nội dung để bắt đầu nhận diện.</p>
                ) : (
                  <>
                    <div className={styles.importSummary}>
                      <span className={styles.validCount}>✓ {importPreview.questions.length} câu hợp lệ</span>
                      <span className={importPreview.errors.length ? styles.invalidCount : styles.noErrorCount}>
                        {importPreview.errors.length ? `! ${importPreview.errors.length} câu cần sửa` : "Không có lỗi"}
                      </span>
                    </div>
                    {importPreview.errors.length > 0 && (
                      <ul className={styles.importErrors}>
                        {importPreview.errors.slice(0, 6).map((error, index) => <li key={`${error.sourceLabel}-${index}`}><b>Câu {error.sourceLabel}:</b> {error.message}</li>)}
                        {importPreview.errors.length > 6 && <li>Và {importPreview.errors.length - 6} lỗi khác…</li>}
                      </ul>
                    )}
                    {importPreview.questions.length > 0 && (
                      <div className={styles.importPreviewList}>
                        {importPreview.questions.slice(0, 3).map((question, index) => (
                          <article key={`${question.sourceLabel}-${index}`}>
                            <b>{index + 1}. {question.prompt}</b>
                            <span>Đáp án đúng: {String.fromCharCode(65 + question.correct_option)}. {question.options[question.correct_option]}</span>
                          </article>
                        ))}
                        {importPreview.questions.length > 3 && <small>Và {importPreview.questions.length - 3} câu hợp lệ khác…</small>}
                      </div>
                    )}
                  </>
                )}
              </div>
              <div className={styles.importFooter}>
                <span>Bộ đề mới sẽ được lưu ở trạng thái bản nháp.</span>
                <div>
                  <button type="button" onClick={() => setImportOpen(false)}>Hủy</button>
                  <button className={styles.saveButton} type="submit" disabled={busy || importPreview.errors.length > 0 || importPreview.questions.length === 0}>
                    {busy ? "Đang nhập…" : `Tạo bộ đề (${importPreview.questions.length} câu)`}
                  </button>
                </div>
              </div>
            </form>
          ) : !selectedSet ? (
            <div className={styles.noSelection}><span>＋</span><h2>Tạo bộ đề đầu tiên</h2><p>Bắt đầu từ một chủ đề bất kỳ rồi thêm các câu hỏi trắc nghiệm.</p><button onClick={createSet}>Tạo bộ đề mới</button></div>
          ) : (
            <>
              <div className={styles.contentTop}>
                <div>
                  <span className={styles.breadcrumb}>BỘ ĐỀ / {selectedSet.topic.toUpperCase()}</span>
                  <h1>{selectedSet.title}</h1>
                  <p>{questions.length} câu hỏi · {selectedSet.is_published ? "Đang xuất bản" : "Bản nháp"}</p>
                </div>
                <div className={styles.topActions}>
                  <label className={styles.roomSizeControl}>
                    <span>Số học sinh</span>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={roomSize}
                      onChange={(event) => setRoomSize(Number(event.target.value))}
                      aria-label="Số học sinh trong phòng"
                    />
                  </label>
                  <button
                    className={styles.openRoomButton}
                    onClick={createGameRoom}
                    disabled={busy || !selectedSet.is_published || questions.length === 0 || !Number.isInteger(roomSize) || roomSize < 1}
                    title={!selectedSet.is_published ? "Hãy xuất bản bộ đề trước" : questions.length === 0 ? "Hãy thêm câu hỏi trước" : ""}
                  >
                    ▶ Mở phòng
                  </button>
                  <button className={styles.addQuestionButton} onClick={openNewQuestion}>＋ Thêm câu hỏi</button>
                </div>
              </div>

              <form className={styles.packSettings} onSubmit={saveSet}>
                <div className={styles.sectionTitle}>
                  <div><span>THÔNG TIN CHUNG</span><strong>Cấu hình bộ đề</strong></div>
                  <div className={styles.formActions}>
                    <button className={styles.deleteButton} type="button" onClick={deleteSet} disabled={busy}>Xóa</button>
                    <button className={styles.saveButton} type="submit" disabled={busy}>Lưu thay đổi</button>
                  </div>
                </div>
                <div className={styles.packGrid}>
                  <label>Tên bộ đề
                    <input value={packForm.title} onChange={(event) => setPackForm({ ...packForm, title: event.target.value })} maxLength={120} required />
                  </label>
                  <label>Lĩnh vực
                    <input value={packForm.topic} onChange={(event) => setPackForm({ ...packForm, topic: event.target.value })} maxLength={80} placeholder="Tiếng Anh, Lịch sử, Khoa học…" required />
                  </label>
                  <label>Thời gian mỗi câu
                    <input
                      type="number"
                      min={5}
                      max={120}
                      value={packForm.time_limit_seconds}
                      onChange={(event) => setPackForm({ ...packForm, time_limit_seconds: Number(event.target.value) })}
                      required
                    />
                    <small>Từ 5 đến 120 giây.</small>
                  </label>
                  <label className={styles.fullField}>Mô tả
                    <textarea value={packForm.description} onChange={(event) => setPackForm({ ...packForm, description: event.target.value })} rows={2} placeholder="Mô tả ngắn để dễ nhận biết bộ đề" />
                  </label>
                </div>
                <label className={styles.switchRow}>
                  <input type="checkbox" checked={packForm.is_published} onChange={(event) => setPackForm({ ...packForm, is_published: event.target.checked })} />
                  <span><i /><b>{packForm.is_published ? "Đã sẵn sàng sử dụng" : "Đang ở chế độ bản nháp"}</b><small>Bạn có thể thay đổi trạng thái bất cứ lúc nào.</small></span>
                </label>
              </form>

              {editorOpen && (
                <form className={styles.questionEditor} onSubmit={saveQuestion}>
                  <div className={styles.sectionTitle}>
                    <div><span>{editingQuestionId ? "CHỈNH SỬA" : "CÂU HỎI MỚI"}</span><strong>{editingQuestionId ? "Cập nhật nội dung" : `Câu số ${questions.length + 1}`}</strong></div>
                    <button className={styles.closeButton} type="button" onClick={() => setEditorOpen(false)}>×</button>
                  </div>
                  <label>Nội dung / định nghĩa
                    <textarea value={questionForm.prompt} onChange={(event) => setQuestionForm({ ...questionForm, prompt: event.target.value })} rows={3} placeholder="Ví dụ: Từ “curious” có nghĩa là gì?" autoFocus required />
                  </label>
                  <div className={styles.optionsGrid}>
                    {questionForm.options.map((option, index) => (
                      <label key={index} className={questionForm.correct_option === index ? styles.correctOption : ""}>
                        <span><input type="radio" name="correct" checked={questionForm.correct_option === index} onChange={() => setQuestionForm({ ...questionForm, correct_option: index })} /> Đáp án {String.fromCharCode(65 + index)}</span>
                        <input value={option} onChange={(event) => {
                          const options = [...questionForm.options];
                          options[index] = event.target.value;
                          setQuestionForm({ ...questionForm, options });
                        }} placeholder={`Nhập lựa chọn ${index + 1}`} required />
                      </label>
                    ))}
                  </div>
                  <div className={styles.editorFooter}>
                    <span>Chọn nút tròn bên cạnh đáp án đúng.</span>
                    <div><button type="button" onClick={() => setEditorOpen(false)}>Hủy</button><button className={styles.saveButton} disabled={busy} type="submit">{editingQuestionId ? "Cập nhật câu hỏi" : "Lưu câu hỏi"}</button></div>
                  </div>
                </form>
              )}

              <div className={styles.questionSection}>
                <div className={styles.sectionTitle}>
                  <div><span>DANH SÁCH CÂU HỎI</span><strong>{questions.length} câu hỏi</strong></div>
                  <button className={styles.textButton} onClick={openNewQuestion}>＋ Thêm câu</button>
                </div>
                <div className={styles.questionList}>
                  {questions.map((question, index) => (
                    <article key={question.id} className={styles.questionCard}>
                      <span className={styles.number}>{String(index + 1).padStart(2, "0")}</span>
                      <div className={styles.questionBody}>
                        <h3>{question.prompt}</h3>
                        <div className={styles.answerPills}>
                          {question.options.map((option, optionIndex) => <span key={optionIndex} className={optionIndex === question.correct_option ? styles.correctPill : ""}>{String.fromCharCode(65 + optionIndex)}. {option}{optionIndex === question.correct_option && " ✓"}</span>)}
                        </div>
                      </div>
                      <div className={styles.cardActions}><button onClick={() => openQuestion(question)}>Sửa</button><button onClick={() => deleteQuestion(question)}>Xóa</button></div>
                    </article>
                  ))}
                  {!questions.length && <div className={styles.emptyQuestions}><span>＋</span><h3>Bộ đề chưa có câu hỏi</h3><p>Thêm câu hỏi đầu tiên với 4 lựa chọn.</p><button onClick={openNewQuestion}>＋ Thêm câu hỏi</button></div>}
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
