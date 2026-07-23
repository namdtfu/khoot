"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getErrorMessage } from "@/lib/game";
import {
  getMyProfile,
  getStudySet,
  listStudySets,
  recordStudyReview,
  resetStudySetProgress,
} from "@/lib/study/api";
import type {
  StudyMode,
  StudyReviewResult,
  StudySetDetail,
  StudySetSummary,
  UserProfile,
} from "@/lib/study/types";
import { supabase } from "@/lib/supabase";
import FlashcardMode from "./components/FlashcardMode";
import LearnLogin from "./components/LearnLogin";
import MultipleChoiceMode from "./components/MultipleChoiceMode";
import PasswordPanel from "./components/PasswordPanel";
import SpacedReviewMode from "./components/SpacedReviewMode";
import StudyLibrary from "./components/StudyLibrary";
import StudyOverview from "./components/StudyOverview";
import styles from "./learn.module.css";

export default function LearnPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [sets, setSets] = useState<StudySetSummary[]>([]);
  const [studySet, setStudySet] = useState<StudySetDetail | null>(null);
  const [mode, setMode] = useState<StudyMode>("overview");
  const [loading, setLoading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [error, setError] = useState("");

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

  const loadPortal = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [nextProfile, nextSets] = await Promise.all([getMyProfile(), listStudySets()]);
      setProfile(nextProfile);
      setSets(nextSets);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!session) return;
    const timer = window.setTimeout(() => void loadPortal(), 0);
    return () => window.clearTimeout(timer);
  }, [session, loadPortal]);

  const login = async (email: string, password: string) => {
    setLoading(true);
    setError("");
    const { error: loginError } = await supabase.auth.signInWithPassword({ email, password });
    if (loginError) setError(getErrorMessage(loginError));
    setLoading(false);
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setProfile(null);
    setSets([]);
    setStudySet(null);
    setMode("overview");
  };

  const openSet = async (setId: string) => {
    setLoading(true);
    setError("");
    try {
      setStudySet(await getStudySet(setId));
      setMode("overview");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setLoading(false);
    }
  };

  const backToLibrary = () => {
    setStudySet(null);
    setMode("overview");
    void loadPortal();
  };

  const resetProgress = async () => {
    if (!studySet || !window.confirm("Đặt lại toàn bộ tiến độ ôn cách quãng của bộ đề này?")) return;
    setResetting(true);
    setError("");
    try {
      await resetStudySetProgress(studySet.id);
      setStudySet(await getStudySet(studySet.id));
      setSets(await listStudySets());
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setResetting(false);
    }
  };

  const applyProgress = (result: StudyReviewResult) => {
    setStudySet((current) => current ? {
      ...current,
      questions: current.questions.map((question) => question.id === result.question_id ? {
        ...question,
        review_stage: result.review_stage,
        known_count: result.known_count,
        again_count: result.again_count,
        next_review_at: result.next_review_at,
        last_reviewed_at: result.last_reviewed_at,
        is_due: false,
      } : question),
    } : current);
  };

  if (!authReady) {
    return <main className={styles.state}><strong>KHOOT!</strong><p>Đang mở thư viện học…</p></main>;
  }

  if (!session) {
    return (
      <main className={styles.shell}>
        <header className={styles.header}>
          <Link className={styles.brand} href="/">KHOOT<span>!</span></Link>
          <span className={styles.portalLabel}>KHU TỰ HỌC</span>
          <Link className={styles.homeLink} href="/">Về trang chủ</Link>
        </header>
        <LearnLogin busy={loading} error={error} onSubmit={login} />
      </main>
    );
  }

  const renderContent = () => {
    if (!studySet) return <StudyLibrary sets={sets} loading={loading} onOpen={(setId) => void openSet(setId)} />;
    if (mode === "flashcards") return <FlashcardMode key={studySet.id + mode} studySet={studySet} onBack={() => setMode("overview")} />;
    if (mode === "quiz") return <MultipleChoiceMode key={studySet.id + mode} studySet={studySet} onBack={() => setMode("overview")} />;
    if (mode === "review") {
      return (
        <SpacedReviewMode
          key={studySet.id + mode}
          studySet={studySet}
          onBack={() => setMode("overview")}
          onReview={recordStudyReview}
          onProgressChange={applyProgress}
        />
      );
    }
    return (
      <StudyOverview
        studySet={studySet}
        resetting={resetting}
        onBack={backToLibrary}
        onChooseMode={setMode}
        onReset={() => void resetProgress()}
      />
    );
  };

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/">KHOOT<span>!</span></Link>
        <div className={styles.headerTitle}><span>KHU TỰ HỌC</span><strong>Học theo tốc độ của bạn</strong></div>
        <nav>
          {profile?.role === "admin" && <Link href="/admin">Trang quản trị</Link>}
          <button onClick={() => setPasswordOpen(true)}>Đổi mật khẩu</button>
          <button onClick={() => void signOut()}>Đăng xuất</button>
        </nav>
        <div className={styles.account}><span>TÀI KHOẢN</span><strong>{session.user.email}</strong></div>
      </header>
      <div className={styles.content}>
        {error && <div className={styles.errorBanner}>{error}<button onClick={() => setError("")}>×</button></div>}
        {renderContent()}
      </div>
      {passwordOpen && <PasswordPanel onClose={() => setPasswordOpen(false)} />}
      <footer className={styles.footer}>Khoot · Tiến độ học được lưu theo tài khoản của bạn.</footer>
    </main>
  );
}
