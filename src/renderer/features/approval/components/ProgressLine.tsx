/** 자동화 진행 표시 — 스피너 + 현재 단계 + 보조 안내 */
export function ProgressLine({ step, note }: { step: string; note?: string }) {
  return (
    <p className="approval-progress">
      <span className="spinner" aria-hidden />
      {step || '진행 중…'}
      {note && <span className="approval-progress__note">{note}</span>}
    </p>
  );
}
