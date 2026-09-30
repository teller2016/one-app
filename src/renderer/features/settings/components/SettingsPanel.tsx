import type { ReactNode, Ref } from 'react';
import { Icon } from '../../../components/Icon';

/**
 * 환경설정 그룹 패널 — 목업(Settings.dc.html)의 `.panel` 한 장.
 * 머리(펼침 화살표 + h2 15/600)를 누르면 접히고, 열림 여부는 부모가 들고 있다
 * (왼쪽 그룹 목록에서 고르면 접힌 그룹을 펼쳐 스크롤해야 해서).
 *
 * 공용 `Collapsible`(카드 룩·18px 여백)을 쓰지 않는 이유 — 목업 패널은 머리와 본문이 한 면에
 * 붙은 14 20 패딩·간격 10 의 조밀한 구조라 카드 룩과 모양이 다르다.
 */
export function SettingsPanel({
  id,
  title,
  open,
  selected,
  onToggle,
  onSelect,
  panelRef,
  children,
}: {
  id: string;
  title: string;
  open: boolean;
  /** 왼쪽 그룹 목록에서 고른 패널 — 윤곽이 한 단 진해진다 */
  selected: boolean;
  onToggle: (open: boolean) => void;
  onSelect: () => void;
  panelRef: Ref<HTMLDetailsElement>;
  children: ReactNode;
}) {
  return (
    <details
      id={`settings-${id}`}
      ref={panelRef}
      className={'settings__panel' + (selected ? ' settings__panel--on' : '')}
      open={open}
      // 프로그램으로 open 을 바꿔도 toggle 이 한 번 더 오므로 값이 다를 때만 올린다
      onToggle={(e) => {
        if (e.currentTarget.open !== open) onToggle(e.currentTarget.open);
      }}
      // 패널 안을 만지면(입력 포커스·머리 클릭) 그 그룹이 선택된 것으로 본다
      onFocus={onSelect}
    >
      <summary className="settings__panel-head">
        <span className="settings__chev">
          <Icon name="chevron-down" size={14} />
        </span>
        <h2 className="settings__panel-title">{title}</h2>
      </summary>
      <div className="settings__panel-body">{children}</div>
    </details>
  );
}
