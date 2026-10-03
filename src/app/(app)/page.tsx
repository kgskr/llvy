import Link from "next/link";

export default function HomePage() {
  return (
    <section className="hero">
      <p className="eyebrow">LLVY Replay Ingestion</p>
      <h1>리그 내전 전적을 리플레이로 모읍니다.</h1>
      <p className="summary">
        .rofl 리플레이 파일을 업로드하면 게임 정보와 참가자 전적을 추출해
        보관합니다.
      </p>
      <div className="cta-row">
        <Link href="/upload" className="button">
          리플레이 업로드
        </Link>
        <Link href="/games" className="button button-secondary">
          게임 보기
        </Link>
      </div>
    </section>
  );
}
