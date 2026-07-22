"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import styles from "./admin.module.css";

type QuestionSet = {
  id: string;
  owner_id: string;
  title: string;
  topic: string;
  description: string;
  is_published: boolean;
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

export default function AdminPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [sets, setSets] = useState<QuestionSet[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [packForm, setPackForm] = useState({ title: "", topic: "", description: "", is_published: false });
  const [questionForm, setQuestionForm] = useState({ ...EMPTY_QUESTION });
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const selectedSet = useMemo(() => sets.find((item) => item.id === selectedId) ?? null, [sets, selectedId]);

  const showError = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    const schemaMissing = message.includes("question_sets") || message.includes("schema cache");
    setNotice({
      type: "error",
      text: schemaMissing
        ? "Database ch?a c? schema Khoot. H?y ch?y file migration Supabase m?t l?n."
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
    if (!session) { setSets([]); setSelectedId(null); return; }
    loadSets(session.user.id).catch(showError);
  }, [session, loadSets]);

  useEffect(() => {
    if (!selectedSet) { setQuestions([]); return; }
    setPackForm({
      title: selectedSet.title,
      topic: selectedSet.topic,
      description: selectedSet.description,
      is_published: selectedSet.is_published,
    });
    setEditorOpen(false);
    loadQuestions(selectedSet.id).catch(showError);
  }, [selectedSet, loadQuestions]);

  const submitAuth = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setNotice(null);
    try {
      if (authMode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (!data.session) setNotice({ type: "success", text: "?? t?o t?i kho?n. H?y ki?m tra email ?? x?c nh?n." });
      }
    } catch (error) { showError(error); }
    finally { setBusy(false); }
  };

  const createSet = async () => {
    if (!session) return;
    setBusy(true); setNotice(null);
    try {
      const { data, error } = await supabase
        .from("question_sets")
        .insert({ owner_id: session.user.id, title: "B? ?? m?i", topic: "T?ng h?p" })
        .select()
        .single();
      if (error) throw error;
      setSets((current) => [data as QuestionSet, ...current]);
      setSelectedId(data.id);
      setNotice({ type: "success", text: "?? t?o b? ?? m?i." });
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
      setNotice({ type: "success", text: "?? l?u th?ng tin b? ??." });
    } catch (error) { showError(error); }
    finally { setBusy(false); }
  };

  const deleteSet = async () => {
    if (!selectedSet || !window.confirm(`X?a ?${selectedSet.title}? v? to?n b? c?u h?i?`)) return;
    setBusy(true); setNotice(null);
    try {
      const { error } = await supabase.from("question_sets").delete().eq("id", selectedSet.id);
      if (error) throw error;
      const remaining = sets.filter((item) => item.id !== selectedSet.id);
      setSets(remaining); setSelectedId(remaining[0]?.id ?? null);
      setNotice({ type: "success", text: "?? x?a b? ??." });
    } catch (error) { showError(error); }
    finally { setBusy(false); }
  };

  const openNewQuestion = () => {
    setEditingQuestionId(null);
    setQuestionForm({ prompt: "", options: ["", "", "", ""], correct_option: 0 });
    setEditorOpen(true);
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
      setNotice({ type: "error", text: "H?y nh?p n?i dung v? ?? 4 ??p ?n." });
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
      setNotice({ type: "success", text: editingQuestionId ? "?? c?p nh?t c?u h?i." : "?? th?m c?u h?i." });
    } catch (error) { showError(error); }
    finally { setBusy(false); }
  };

  const deleteQuestion = async (question: Question) => {
    if (!window.confirm("X?a c?u h?i n?y?")) return;
    setBusy(true); setNotice(null);
    try {
      const { error } = await supabase.from("questions").delete().eq("id", question.id);
      if (error) throw error;
      setQuestions((current) => current.filter((item) => item.id !== question.id));
      if (editingQuestionId === question.id) setEditorOpen(false);
      setNotice({ type: "success", text: "?? x?a c?u h?i." });
    } catch (error) { showError(error); }
    finally { setBusy(false); }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setNotice(null);
  };

  if (!authReady) {
    return <main className={styles.loading}><span>KHOOT!</span><p>?ang m? khu v?c qu?n tr??</p></main>;
  }

  if (!session) {
    return (
      <main className={styles.authShell}>
        <Link className={styles.backLink} href="/">? V? trang ch?i</Link>
        <section className={styles.authIntro}>
          <span className={styles.kicker}>KHOOT CREATOR</span>
          <h1>T?o b? c?u h?i.<br /><em>Ch?i theo c?ch c?a b?n.</em></h1>
          <p>So?n c?u h?i tr?c nghi?m cho b?t k? ch? ?? n?o, l?u an to?n v? qu?n l? ? m?t n?i.</p>
          <div className={styles.featureRow}>
            <span><b>01</b> Nhi?u l?nh v?c</span>
            <span><b>02</b> 4 ??p ?n</span>
            <span><b>03</b> Ch?m ?i?m t? ??ng</span>
          </div>
        </section>
        <section className={styles.authCard}>
          <div className={styles.authTabs}>
            <button className={authMode === "login" ? styles.activeTab : ""} onClick={() => setAuthMode("login")}>??ng nh?p</button>
            <button className={authMode === "signup" ? styles.activeTab : ""} onClick={() => setAuthMode("signup")}>T?o t?i kho?n</button>
          </div>
          <span className={styles.cardEyebrow}>{authMode === "login" ? "CH?O M?NG TR? L?I" : "B?T ??U MI?N PH?"}</span>
          <h2>{authMode === "login" ? "V?o ph?ng qu?n tr?" : "T?o t?i kho?n admin"}</h2>
          <form onSubmit={submitAuth}>
            <label>Email
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="admin@example.com" autoComplete="email" required />
            </label>
            <label>M?t kh?u
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="T?i thi?u 6 k? t?" minLength={6} autoComplete={authMode === "login" ? "current-password" : "new-password"} required />
            </label>
            {notice && <p className={notice.type === "error" ? styles.errorNotice : styles.successNotice}>{notice.text}</p>}
            <button className={styles.submitButton} disabled={busy} type="submit">
              {busy ? "?ang x? l??" : authMode === "login" ? "??ng nh?p ?" : "T?o t?i kho?n ?"}
            </button>
          </form>
          <small>D? li?u c?a m?i t?i kho?n ???c t?ch ri?ng b?ng Row Level Security.</small>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.dashboard}>
      <header className={styles.header}>
        <Link className={styles.logo} href="/">KHOOT<span>!</span></Link>
        <div className={styles.headerTitle}><span>TRANG QU?N TR?</span><strong>Ng?n h?ng c?u h?i</strong></div>
        <div className={styles.account}>
          <div><span>?ANG ??NG NH?P</span><strong>{session.user.email}</strong></div>
          <button onClick={signOut}>??ng xu?t</button>
        </div>
      </header>
      <div className={styles.workspace}>
        <aside className={styles.sidebar}>
          <div className={styles.sidebarHeading}>
            <div><span>B? ?? C?A B?N</span><strong>{sets.length} b? ??</strong></div>
            <button onClick={createSet} disabled={busy} aria-label="T?o b? ?? m?i">+</button>
          </div>
          <div className={styles.setList}>
            {sets.map((item) => (
              <button key={item.id} className={item.id === selectedId ? styles.activeSet : ""} onClick={() => setSelectedId(item.id)}>
                <span className={styles.setIcon}>{item.topic.slice(0, 1).toUpperCase()}</span>
                <span><strong>{item.title}</strong><small>{item.topic}</small></span>
                <i className={item.is_published ? styles.publishedDot : ""} />
              </button>
            ))}
            {!sets.length && <div className={styles.emptySets}><span>?</span><p>Ch?a c? b? ?? n?o.</p><button onClick={createSet}>T?o b? ?? ??u ti?n</button></div>}
          </div>
          <div className={styles.sidebarHelp}><span>G?I ?</span><p>M?i c?u h?i lu?n c? ??ng 4 l?a ch?n v? 1 ??p ?n ch?nh x?c.</p></div>
        </aside>
        <section className={styles.content}>
          {notice && <div className={notice.type === "error" ? styles.errorBanner : styles.successBanner}>{notice.text}<button onClick={() => setNotice(null)}>?</button></div>}
          {!selectedSet ? (
            <div className={styles.noSelection}><span>?</span><h2>T?o b? ?? ??u ti?n</h2><p>B?t ??u t? m?t ch? ?? b?t k? r?i th?m c?c c?u h?i tr?c nghi?m.</p><button onClick={createSet}>T?o b? ?? m?i</button></div>
          ) : (
            <>
              <div className={styles.contentTop}>
                <div>
                  <span className={styles.breadcrumb}>B? ?? / {selectedSet.topic.toUpperCase()}</span>
                  <h1>{selectedSet.title}</h1>
                  <p>{questions.length} c?u h?i ? {selectedSet.is_published ? "?ang xu?t b?n" : "B?n nh?p"}</p>
                </div>
                <button className={styles.addQuestionButton} onClick={openNewQuestion}>? Th?m c?u h?i</button>
              </div>

              <form className={styles.packSettings} onSubmit={saveSet}>
                <div className={styles.sectionTitle}>
                  <div><span>TH?NG TIN CHUNG</span><strong>C?u h?nh b? ??</strong></div>
                  <div className={styles.formActions}>
                    <button className={styles.deleteButton} type="button" onClick={deleteSet} disabled={busy}>X?a</button>
                    <button className={styles.saveButton} type="submit" disabled={busy}>L?u thay ??i</button>
                  </div>
                </div>
                <div className={styles.packGrid}>
                  <label>T?n b? ??
                    <input value={packForm.title} onChange={(event) => setPackForm({ ...packForm, title: event.target.value })} maxLength={120} required />
                  </label>
                  <label>L?nh v?c
                    <input value={packForm.topic} onChange={(event) => setPackForm({ ...packForm, topic: event.target.value })} maxLength={80} placeholder="Ti?ng Anh, L?ch s?, Khoa h?c?" required />
                  </label>
                  <label className={styles.fullField}>M? t?
                    <textarea value={packForm.description} onChange={(event) => setPackForm({ ...packForm, description: event.target.value })} rows={2} placeholder="M? t? ng?n ?? d? nh?n bi?t b? ??" />
                  </label>
                </div>
                <label className={styles.switchRow}>
                  <input type="checkbox" checked={packForm.is_published} onChange={(event) => setPackForm({ ...packForm, is_published: event.target.checked })} />
                  <span><i /><b>{packForm.is_published ? "?? s?n s?ng s? d?ng" : "?ang ? ch? ?? b?n nh?p"}</b><small>B?n c? th? thay ??i tr?ng th?i b?t c? l?c n?o.</small></span>
                </label>
              </form>

              {editorOpen && (
                <form className={styles.questionEditor} onSubmit={saveQuestion}>
                  <div className={styles.sectionTitle}>
                    <div><span>{editingQuestionId ? "CH?NH S?A" : "C?U H?I M?I"}</span><strong>{editingQuestionId ? "C?p nh?t n?i dung" : `C?u s? ${questions.length + 1}`}</strong></div>
                    <button className={styles.closeButton} type="button" onClick={() => setEditorOpen(false)}>?</button>
                  </div>
                  <label>N?i dung / ??nh ngh?a
                    <textarea value={questionForm.prompt} onChange={(event) => setQuestionForm({ ...questionForm, prompt: event.target.value })} rows={3} placeholder="V? d?: T? ?curious? c? ngh?a l? g??" autoFocus required />
                  </label>
                  <div className={styles.optionsGrid}>
                    {questionForm.options.map((option, index) => (
                      <label key={index} className={questionForm.correct_option === index ? styles.correctOption : ""}>
                        <span><input type="radio" name="correct" checked={questionForm.correct_option === index} onChange={() => setQuestionForm({ ...questionForm, correct_option: index })} /> ??p ?n {String.fromCharCode(65 + index)}</span>
                        <input value={option} onChange={(event) => {
                          const options = [...questionForm.options];
                          options[index] = event.target.value;
                          setQuestionForm({ ...questionForm, options });
                        }} placeholder={`Nh?p l?a ch?n ${index + 1}`} required />
                      </label>
                    ))}
                  </div>
                  <div className={styles.editorFooter}>
                    <span>Ch?n n?t tr?n b?n c?nh ??p ?n ??ng.</span>
                    <div><button type="button" onClick={() => setEditorOpen(false)}>H?y</button><button className={styles.saveButton} disabled={busy} type="submit">{editingQuestionId ? "C?p nh?t c?u h?i" : "L?u c?u h?i"}</button></div>
                  </div>
                </form>
              )}

              <div className={styles.questionSection}>
                <div className={styles.sectionTitle}>
                  <div><span>DANH S?CH C?U H?I</span><strong>{questions.length} c?u h?i</strong></div>
                  <button className={styles.textButton} onClick={openNewQuestion}>? Th?m c?u</button>
                </div>
                <div className={styles.questionList}>
                  {questions.map((question, index) => (
                    <article key={question.id} className={styles.questionCard}>
                      <span className={styles.number}>{String(index + 1).padStart(2, "0")}</span>
                      <div className={styles.questionBody}>
                        <h3>{question.prompt}</h3>
                        <div className={styles.answerPills}>
                          {question.options.map((option, optionIndex) => <span key={optionIndex} className={optionIndex === question.correct_option ? styles.correctPill : ""}>{String.fromCharCode(65 + optionIndex)}. {option}{optionIndex === question.correct_option && " ?"}</span>)}
                        </div>
                      </div>
                      <div className={styles.cardActions}><button onClick={() => openQuestion(question)}>S?a</button><button onClick={() => deleteQuestion(question)}>X?a</button></div>
                    </article>
                  ))}
                  {!questions.length && <div className={styles.emptyQuestions}><span>?</span><h3>B? ?? ch?a c? c?u h?i</h3><p>Th?m c?u h?i ??u ti?n v?i 4 l?a ch?n.</p><button onClick={openNewQuestion}>? Th?m c?u h?i</button></div>}
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
