"use client";

import { FormEvent, useState } from "react";
import { updateMyPassword } from "@/lib/study/api";
import styles from "../learn.module.css";

type Props = {
  onClose: () => void;
};

export default function PasswordPanel({ onClose }: Props) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (password.length < 6) {
      setMessage({ type: "error", text: "Mật khẩu cần có ít nhất 6 ký tự." });
      return;
    }
    if (password !== confirmPassword) {
      setMessage({ type: "error", text: "Hai mật khẩu chưa khớp nhau." });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await updateMyPassword(password);
      setPassword("");
      setConfirmPassword("");
      setMessage({ type: "success", text: "Đã đổi mật khẩu thành công." });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <form className={styles.passwordPanel} onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="password-title">
        <div className={styles.modalTitle}>
          <div><span className={styles.eyebrow}>TÀI KHOẢN</span><h2 id="password-title">Đổi mật khẩu</h2></div>
          <button type="button" onClick={onClose} aria-label="Đóng">×</button>
        </div>
        <p>Bạn chỉ có thể thay đổi mật khẩu của chính mình. Tài khoản mới do quản trị viên tạo.</p>
        <label>Mật khẩu mới
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={6} autoComplete="new-password" required autoFocus />
        </label>
        <label>Nhập lại mật khẩu
          <input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} minLength={6} autoComplete="new-password" required />
        </label>
        {message && <p className={message.type === "error" ? styles.error : styles.success}>{message.text}</p>}
        <div className={styles.modalActions}>
          <button type="button" onClick={onClose}>Đóng</button>
          <button className={styles.primaryAction} disabled={busy} type="submit">{busy ? "Đang lưu…" : "Lưu mật khẩu"}</button>
        </div>
      </form>
    </div>
  );
}
