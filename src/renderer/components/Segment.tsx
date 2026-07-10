/**
 * 세그먼트 토글 — 배경 승격 방식(트랙 위 활성 항목이 표면으로 떠오름).
 * 일정 등록의 오늘/어제/직접 입력 등 소수 옵션 전환에 사용.
 */
export function Segment<T extends string>({
  options,
  value,
  onChange,
  disabled = false,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="seg-group" role="group">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={'seg' + (o.value === value ? ' seg--on' : '')}
          aria-pressed={o.value === value}
          disabled={disabled}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
