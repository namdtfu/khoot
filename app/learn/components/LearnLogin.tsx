"use client";

import { FormEvent, useState } from "react";
import styles from "../learn.module.css";

type Props = {
  busy: boolean;
  error: string;
  onSubmit: (email: string, password: string) => Promise<void>;
};

export default function LearnLogin({ busy, error, onSubmit }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void onSubmit(email.trim(), password);
  };

  return (
    <div className={styles.loginLayout}>
      <section className={styles.loginIntro}>
        <span className={styles.eyebrow}>KHO TỰ HỌC KHOOT</span>
        <h1>Học đến khi<br /><em>thật sự nhớ.</em></h1>
        <p>Ôn các bộ đề đã được quản trị viên xuất bản bằng flashcard, trắc nghiệm hoặc lịch ôn cách quãng.</p>
        <div className={styles.loginFeatures}>
          <span><b>01</b> Flashcard lật thẻ</span>
          <span><b>02</b> Trắc nghiệm tự luyện</span>
          <span><b>03</b> Nhắc lịch ôn tập</span>
        </div>
      </section>
      <form className={styles.loginCard} onSubmit={submit}>
        <span className={styles.eyebrow}>DÀNH CHO HỌC VIÊN</span>
        <h2>Đăng nhập để học</h2>
        <p>Dùng tài khoản và mật khẩu do quản trị viên cung cấp.</p>
        <label>Email tài khoản
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required />
        </label>
        <label>Mật khẩu
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={6} autoComplete="current-password" required />
        </label>
        {error && <p className={styles.error}>{error}</p>}
        <button disabled={busy} type="submit">{busy ? "Đang đăng nhập…" : "Bắt đầu học →"}</button>
        <small>Không có chức năng đăng ký tài khoản mới.</small>
      </form>
    </div>
  );
}
