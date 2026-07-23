import Link from "next/link";

const STEPS = [
  { label: "Flashcard", detail: "Lật thẻ và ghi nhớ", color: "#ff8b73", mark: "1" },
  { label: "Trắc nghiệm", detail: "Luyện chọn đáp án", color: "#ffcd56", mark: "2" },
  { label: "Ôn cách quãng", detail: "Học đúng lúc cần ôn", color: "#45c9a5", mark: "3" },
  { label: "Thi trực tiếp", detail: "Cả lớp cùng tham gia", color: "#8198ed", mark: "4" },
  { label: "Theo dõi tiến độ", detail: "Lưu riêng từng tài khoản", color: "#c88ceb", mark: "5" },
];

export default function Home() {
  return (
    <main className="welcome-shell">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="Khoot Mini - trang chủ">KHOOT<span>!</span></Link>
        <nav className="home-nav" aria-label="Điều hướng chính">
          <Link className="round-label" href="/learn">KHU TỰ HỌC</Link>
          <Link className="round-label" href="/admin">TRANG QUẢN TRỊ</Link>
        </nav>
      </header>
      <section className="welcome-grid">
        <div className="hero-copy">
          <span className="eyebrow">HỌC MỖI NGÀY · THI CÙNG CẢ LỚP</span>
          <h1>Một bộ đề.<br />Nhiều cách.<br /><em>Học thật nhớ.</em></h1>
          <p>Khoot kết hợp phòng thi trực tiếp với flashcard, trắc nghiệm tự luyện và ôn cách quãng. Mỗi học sinh học theo tốc độ riêng, còn tiến độ luôn được lưu theo tài khoản.</p>
          <div className="hero-actions">
            <Link className="primary-button" href="/learn">Vào khu tự học <span aria-hidden="true">→</span></Link>
            <Link className="secondary-button" href="/admin">Quản trị bộ đề</Link>
          </div>
          <small>Tài khoản học sinh do quản trị viên cấp.</small>
        </div>
        <div className="lobby-card" aria-label="Các chế độ học và thi trên Khoot">
          <div className="lobby-topline">
            <div><span>KHOOT MINI</span><strong>HỌC + THI</strong></div>
            <span className="live-pill"><i /> ĐỒNG BỘ</span>
          </div>
          <div className="word-preview" aria-hidden="true">
            <span>Học theo tốc độ của bạn</span><strong>3 chế độ</strong><i>Flashcard · Trắc nghiệm · Ôn cách quãng</i>
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
            <span>MỘT TÀI KHOẢN · LƯU MỌI TIẾN ĐỘ</span>
            <div className="tiny-avatars" aria-hidden="true">
              {STEPS.map((step) => <i key={step.label} style={{ background: step.color }} />)}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
