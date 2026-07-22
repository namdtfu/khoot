"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { buildLobbyLink, getBasePath, getErrorMessage, type GameLobby, type GameSnapshot } from "@/lib/game";
import { parseQuestionText } from "@/lib/question-import";
import QuestionTree, { type TreeFolder, type TreeQuestionSet } from "./QuestionTree";
import styles from "./admin.module.css";

type QuestionSet = {
  id: string;
  owner_id: string;
  title: string;
  topic: string;
  description: string;
  is_published: boolean;
  time_limit_seconds: number;
  folder_id: string | null;
  position: number;
  created_at: string;
  updated_at: string;
};

type QuestionFolder = TreeFolder & {
  owner_id: string;
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

function folderPath(folderId: string | null, folders: QuestionFolder[]) {
  if (!folderId) return "Gốc";
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const parts: string[] = [];
  const visited = new Set<string>();
  let current = byId.get(folderId);
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    parts.unshift(current.name);
    current = current.parent_id ? byId.get(current.parent_id) : undefined;
  }
  return parts.join(" / ") || "Gốc";
}

function isFolderInside(folderId: string, ancestorId: string, folders: QuestionFolder[]) {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const visited = new Set<string>();
  let current = byId.get(folderId);
  while (current && !visited.has(current.id)) {
    if (current.id === ancestorId) return true;
    visited.add(current.id);
    current = current.parent_id ? byId.get(current.parent_id) : undefined;
  }
  return false;
}

export default function AdminPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [lobby, setLobby] = useState<GameLobby | null>(null);
  const [lobbyCopied, setLobbyCopied] = useState(false);
  const [folders, setFolders] = useState<QuestionFolder[]>([]);
  const [sets, setSets] = useState<QuestionSet[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [packForm, setPackForm] = useState({ title: "", topic: "", description: "", is_published: false, time_limit_seconds: 20 });
  const [roomSize, setRoomSize] = useState(5);
  const [questionForm, setQuestionForm] = useState({ ...EMPTY_QUESTION });
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importForm, setImportForm] = useState({ title: "Bộ đề nhập nhanh", topic: "Tổng hợp", time_limit_seconds: 20, folder_id: null as string | null });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const selectedSet = useMemo(() => sets.find((item) => item.id === selectedId) ?? null, [sets, selectedId]);
  const selectedFolder = useMemo(() => folders.find((item) => item.id === selectedFolderId) ?? null, [folders, selectedFolderId]);
  const importPreview = useMemo(() => parseQuestionText(importText), [importText]);
  const activeFolderId = selectedFolder?.id ?? selectedSet?.folder_id ?? null;
  const folderChoices = useMemo(() => [
    { id: null as string | null, label: "Gốc" },
    ...folders
      .map((folder) => ({ id: folder.id, label: folderPath(folder.id, folders) }))
      .sort((left, right) => left.label.localeCompare(right.label, "vi")),
  ], [folders]);
  const parentFolderChoices = useMemo(
    () => selectedFolder
      ? folderChoices.filter((choice) => !choice.id || !isFolderInside(choice.id, selectedFolder.id, folders))
      : folderChoices,
    [folderChoices, folders, selectedFolder],
  );
  const lobbyLink = useMemo(() => lobby ? buildLobbyLink(lobby.public_token) : "", [lobby]);

  const showError = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    const schemaMissing = message.includes("question_sets") || message.includes("question_folders") || message.includes("schema cache");
    setNotice({
      type: "error",
      text: schemaMissing
        ? "Cơ sở dữ liệu chưa có cấu trúc Khoot. Hãy chạy tệp migration Supabase một lần."
        : message,
    });
  };

  const loadLibrary = useCallback(async (userId: string) => {
    const [setResult, folderResult] = await Promise.all([
      supabase
        .from("question_sets")
        .select("*")
        .eq("owner_id", userId)
        .order("position")
        .order("updated_at", { ascending: false }),
      supabase
        .from("question_folders")
        .select("*")
        .eq("owner_id", userId)
        .order("position")
        .order("name"),
    ]);
    if (setResult.error) throw setResult.error;
    if (folderResult.error) throw folderResult.error;
    const nextSets = (setResult.data ?? []) as QuestionSet[];
    const nextFolders = (folderResult.data ?? []) as QuestionFolder[];
    setSets(nextSets);
    setFolders(nextFolders);
    setSelectedId((current) => current && nextSets.some((item) => item.id === current) ? current : null);
    setSelectedFolderId((current) => current && nextFolders.some((item) => item.id === current) ? current : null);
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

  const loadLobby = useCallback(async () => {
    const { data, error } = await supabase.rpc("get_or_create_game_lobby");
    if (error) throw error;
    const nextLobby = data as GameLobby;
    setLobby(nextLobby);

    const requestedLobby = new URLSearchParams(window.location.search).get("lobby");
    if (requestedLobby && requestedLobby === nextLobby.public_token) {
      window.location.replace(`${getBasePath()}/room/?room=${nextLobby.public_token}`);
    }
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
      if (!session) { setFolders([]); setSets([]); setSelectedId(null); setSelectedFolderId(null); return; }
      loadLibrary(session.user.id).catch(showError);
    }, 0);
    return () => window.clearTimeout(sessionTimer);
  }, [session, loadLibrary]);

  useEffect(() => {
    if (!session) return;
    const lobbyTimer = window.setTimeout(() => void loadLobby().catch(showError), 0);
    return () => window.clearTimeout(lobbyTimer);
  }, [session, loadLobby]);

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
    const destinationFolderId = activeFolderId;
    const position = Math.max(
      -1,
      ...sets.filter((item) => item.folder_id === destinationFolderId).map((item) => item.position),
    ) + 1;
    setBusy(true); setNotice(null);
    try {
      const { data, error } = await supabase
        .from("question_sets")
        .insert({
          owner_id: session.user.id,
          title: "Bộ đề mới",
          topic: "Tổng hợp",
          folder_id: destinationFolderId,
          position,
        })
        .select()
        .single();
      if (error) throw error;
      setSets((current) => [...current, data as QuestionSet]);
      setSelectedId(data.id);
      setSelectedFolderId(null);
      setNotice({ type: "success", text: "Đã tạo bộ đề mới." });
    } catch (error) { showError(error); }
    finally { setBusy(false); }
  };

  const createFolder = async (parentId: string | null = activeFolderId) => {
    if (!session) return;
    const name = window.prompt("Tên thư mục mới:");
    if (!name?.trim()) return;
    const position = Math.max(
      -1,
      ...folders.filter((item) => item.parent_id === parentId).map((item) => item.position),
    ) + 1;
    setBusy(true); setNotice(null);
    try {
      const { data, error } = await supabase
        .from("question_folders")
        .insert({ owner_id: session.user.id, parent_id: parentId, name: name.trim(), position })
        .select()
        .single();
      if (error) throw error;
      const folder = data as QuestionFolder;
      setFolders((current) => [...current, folder]);
      setSelectedFolderId(folder.id);
      setSelectedId(null);
      setImportOpen(false);
      setNotice({ type: "success", text: `Đã tạo thư mục “${folder.name}”.` });
    } catch (error) { showError(error); }
    finally { setBusy(false); }
  };

  const renameFolder = async () => {
    if (!selectedFolder) return;
    const name = window.prompt("Tên mới của thư mục:", selectedFolder.name);
    if (!name?.trim() || name.trim() === selectedFolder.name) return;
    setBusy(true); setNotice(null);
    try {
      const { data, error } = await supabase
        .from("question_folders")
        .update({ name: name.trim() })
        .eq("id", selectedFolder.id)
        .select()
        .single();
      if (error) throw error;
      setFolders((current) => current.map((item) => item.id === selectedFolder.id ? data as QuestionFolder : item));
      setNotice({ type: "success", text: "Đã đổi tên thư mục." });
    } catch (error) { showError(error); }
    finally { setBusy(false); }
  };

  const deleteFolder = async () => {
    if (!selectedFolder) return;
    const childCount = folders.filter((item) => item.parent_id === selectedFolder.id).length;
    const setCount = sets.filter((item) => item.folder_id === selectedFolder.id).length;
    if (childCount || setCount) {
      setNotice({ type: "error", text: "Chỉ có thể xóa thư mục trống. Hãy chuyển các thư mục con và bộ đề ra nơi khác trước." });
      return;
    }
    if (!window.confirm(`Xóa thư mục trống “${selectedFolder.name}”?`)) return;
    setBusy(true); setNotice(null);
    try {
      const { error } = await supabase.from("question_folders").delete().eq("id", selectedFolder.id);
      if (error) throw error;
      setFolders((current) => current.filter((item) => item.id !== selectedFolder.id));
      setSelectedFolderId(selectedFolder.parent_id);
      setNotice({ type: "success", text: "Đã xóa thư mục." });
    } catch (error) { showError(error); }
    finally { setBusy(false); }
  };

  const moveQuestionSet = async (setId: string, folderId: string | null, position: number) => {
    if (!session) return;
    setBusy(true); setNotice(null);
    try {
      const { error } = await supabase.rpc("move_question_set", {
        p_set_id: setId,
        p_folder_id: folderId,
        p_position: position,
      });
      if (error) throw error;
      await loadLibrary(session.user.id);
    } catch (error) { showError(error); }
    finally { setBusy(false); }
  };

  const moveQuestionFolder = async (folderId: string, parentId: string | null, position: number) => {
    if (!session) return;
    setBusy(true); setNotice(null);
    try {
      const { error } = await supabase.rpc("move_question_folder", {
        p_folder_id: folderId,
        p_parent_id: parentId,
        p_position: position,
      });
      if (error) throw error;
      await loadLibrary(session.user.id);
    } catch (error) { showError(error); }
    finally { setBusy(false); }
  };

  const selectFolder = (folderId: string) => {
    setSelectedFolderId(folderId);
    setSelectedId(null);
    setImportOpen(false);
    setEditorOpen(false);
  };

  const selectSet = (setId: string) => {
    setSelectedId(setId);
    setSelectedFolderId(null);
    setImportOpen(false);
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
      const { data, error } = await supabase.rpc("create_game_session", {
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

  const copyLobbyLink = async () => {
    if (!lobbyLink) return;
    await navigator.clipboard.writeText(lobbyLink);
    setLobbyCopied(true);
    window.setTimeout(() => setLobbyCopied(false), 1800);
  };

  const openNewQuestion = () => {
    setEditingQuestionId(null);
    setQuestionForm({ prompt: "", options: ["", "", "", ""], correct_option: 0 });
    setEditorOpen(true);
  };

  const openImporter = () => {
    setImportForm({
      title: `Bộ đề nhập nhanh ${sets.length + 1}`,
      topic: "Tổng hợp",
      time_limit_seconds: 20,
      folder_id: activeFolderId,
    });
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
    const setPosition = Math.max(
      -1,
      ...sets.filter((item) => item.folder_id === importForm.folder_id).map((item) => item.position),
    ) + 1;

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
          folder_id: importForm.folder_id,
          position: setPosition,
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
      setSelectedFolderId(null);
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
            <div><span>THƯ VIỆN CỦA BẠN</span><strong>{folders.length} thư mục · {sets.length} bộ đề</strong></div>
            <div className={styles.sidebarActions}>
              <button onClick={() => createFolder()} disabled={busy} aria-label="Tạo thư mục mới" title="Tạo thư mục">▱＋</button>
              <button onClick={createSet} disabled={busy} aria-label="Tạo bộ đề mới" title="Tạo bộ đề">＋</button>
            </div>
          </div>
          <button className={styles.importLauncher} onClick={openImporter} disabled={busy}>↓ Nhập từ văn bản</button>
          {lobby && (
            <div className={styles.permanentRoomCard}>
              <div><span>LINK PHÒNG CỐ ĐỊNH</span><i>LIVE</i></div>
              <input value={lobbyLink} readOnly aria-label="Link phòng cố định" />
              <div>
                <button type="button" onClick={copyLobbyLink}>{lobbyCopied ? "Đã chép" : "Sao chép"}</button>
                <Link href={`/room/?room=${lobby.public_token}`}>Mở link</Link>
              </div>
            </div>
          )}
          <QuestionTree
            folders={folders}
            sets={sets as TreeQuestionSet[]}
            selectedFolderId={selectedFolderId}
            selectedSetId={selectedId}
            busy={busy}
            onSelectFolder={selectFolder}
            onSelectSet={selectSet}
            onMoveFolder={moveQuestionFolder}
            onMoveSet={moveQuestionSet}
          />
          <div className={styles.sidebarHelp}><span>GỢI Ý</span><p>Kéo bộ đề hoặc thư mục để chuyển vị trí. Hai nút ↑ ↓ dùng để sắp xếp trong cùng một thư mục.</p></div>
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
                <label>Thư mục lưu
                  <select value={importForm.folder_id ?? ""} onChange={(event) => setImportForm({ ...importForm, folder_id: event.target.value || null })}>
                    {folderChoices.map((choice) => <option key={choice.id ?? "root"} value={choice.id ?? ""}>{choice.label}</option>)}
                  </select>
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
          ) : selectedFolder ? (
            <div className={styles.folderPanel}>
              <span className={styles.breadcrumb}>THƯ MỤC / {folderPath(selectedFolder.parent_id, folders).toUpperCase()}</span>
              <div className={styles.folderPanelTitle}>
                <div><span className={styles.largeFolderIcon}>▱</span><div><h1>{selectedFolder.name}</h1><p>{folders.filter((item) => item.parent_id === selectedFolder.id).length} thư mục con · {sets.filter((item) => item.folder_id === selectedFolder.id).length} bộ đề</p></div></div>
                <div className={styles.folderActions}>
                  <button type="button" onClick={() => createFolder(selectedFolder.id)} disabled={busy}>＋ Thư mục con</button>
                  <button className={styles.saveButton} type="button" onClick={createSet} disabled={busy}>＋ Bộ đề</button>
                </div>
              </div>
              <div className={styles.folderSettings}>
                <label>Thư mục cha
                  <select
                    value={selectedFolder.parent_id ?? ""}
                    disabled={busy}
                    onChange={(event) => {
                      const parentId = event.target.value || null;
                      const position = folders.filter((item) => item.parent_id === parentId && item.id !== selectedFolder.id).length;
                      void moveQuestionFolder(selectedFolder.id, parentId, position);
                    }}
                  >
                    {parentFolderChoices.map((choice) => <option key={choice.id ?? "root"} value={choice.id ?? ""}>{choice.label}</option>)}
                  </select>
                  <small>Chọn một thư mục khác để di chuyển toàn bộ nhánh này.</small>
                </label>
                <div className={styles.folderManageButtons}>
                  <button type="button" onClick={renameFolder} disabled={busy}>Đổi tên</button>
                  <button className={styles.deleteButton} type="button" onClick={deleteFolder} disabled={busy}>Xóa thư mục</button>
                </div>
              </div>
              <div className={styles.folderDropHint}><b>Kéo và thả</b><span>Thả bộ đề hoặc thư mục vào tên thư mục bên trái để chuyển chúng vào đây.</span></div>
            </div>
          ) : !selectedSet ? (
            <div className={styles.noSelection}>
              <span>▱</span>
              <h2>Sắp xếp thư viện bộ đề</h2>
              <p>Tạo thư mục, thư mục con hoặc chọn một bộ đề trong cây bên trái.</p>
              <div className={styles.noSelectionActions}>
                <button onClick={() => createFolder(null)}>＋ Tạo thư mục</button>
                <button onClick={createSet}>＋ Tạo bộ đề</button>
              </div>
            </div>
          ) : (
            <>
              <div className={styles.contentTop}>
                <div>
                  <span className={styles.breadcrumb}>BỘ ĐỀ / {folderPath(selectedSet.folder_id, folders).toUpperCase()}</span>
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
                  <label>Thư mục
                    <select
                      value={selectedSet.folder_id ?? ""}
                      disabled={busy}
                      onChange={(event) => {
                        const folderId = event.target.value || null;
                        const position = sets.filter((item) => item.folder_id === folderId && item.id !== selectedSet.id).length;
                        void moveQuestionSet(selectedSet.id, folderId, position);
                      }}
                    >
                      {folderChoices.map((choice) => <option key={choice.id ?? "root"} value={choice.id ?? ""}>{choice.label}</option>)}
                    </select>
                    <small>Đổi thư mục đích của bộ đề.</small>
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
