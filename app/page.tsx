import Link from "next/link";

const STEPS = [
  { label: "Nhập tên", detail: "Mở liên kết phòng", color: "#ff8b73", mark: "1" },
  { label: "Sẵn sàng", detail: "Chờ đủ 5 học sinh", color: "#ffcd56", mark: "2" },
  { label: "Bắt đầu", detail: "Đếm ngược 3 · 2 · 1", color: "#45c9a5", mark: "3" },
  { label: "Trả lời", detail: "Đúng và nhanh để ghi điểm", color: "#8198ed", mark: "4" },
  { label: "Xếp hạng", detail: "Thống kê sau câu cuối", color: "#c88ceb", mark: "5" },
];

export default function Home() {
  return (
    <main className="welcome-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="Khoot Mini - trang chủ">KHOOT<span>!</span></a>
        <Link className="round-label" href="/admin">TRANG QUẢN TRỊ →</Link>
      </header>
      <section className="welcome-grid">
        <div className="hero-copy">
          <span className="eyebrow">TRẮC NGHIỆM REALTIME · 5 HỌC SINH</span>
          <h1>5 máy.<br />1 phòng.<br /><em>Ai nhanh nhất?</em></h1>
          <p>Người quản trị mở phòng và gửi liên kết. Cả 5 học sinh cùng trả lời trong thời gian thực, ghi điểm bằng độ chính xác và tốc độ.</p>
          <Link className="primary-button" href="/admin">Mở trang quản trị <span aria-hidden="true">→</span></Link>
          <small>Học sinh tham gia bằng liên kết riêng của từng phòng</small>
        </div>
        <div className="lobby-card" aria-label="Luồng một trận đấu Khoot">
          <div className="lobby-topline">
            <div><span>PHÒNG THI</span><strong>5 + 1 MÁY</strong></div>
            <span className="live-pill"><i /> REALTIME</span>
          </div>
          <div className="word-preview" aria-hidden="true">
            <span>Thời gian do quản trị đặt</span><strong>20 giây</strong><i>cho mỗi câu hỏi</i>
          </div>
          <div className="player-list">
            {STEPS.map((step) => (
              <div className="player-row" key={step.label}>
                <span className="avatar" style={{ background: step.color }}>{step.mark}</span>
                <strong>{step.label}</strong><span className="seat">{step.detail}</span><span className="ready-dot">✓</span>
              </div>
            ))}
          </div>
          <div className="lobby-footer">
            <span>Đủ 5 người mới bắt đầu</span>
            <div className="tiny-avatars" aria-hidden="true">
              {STEPS.map((step) => <i key={step.label} style={{ background: step.color }} />)}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
