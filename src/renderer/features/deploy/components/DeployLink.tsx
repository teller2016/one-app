import type { ButtonHTMLAttributes } from 'react';
import { Icon } from '../../../components/Icon';

/**
 * 배포 화면의 글자 링크 — 목업 a(액센트 · 밑줄 없음). 젠킨스 URL·잡·커밋 해시·이슈 키가 쓴다.
 * 공용 TextLink 는 크기·서체가 고정이라(13/12 본문 서체) 목업의 모노 11.5~12.5 를 못 맞춘다 —
 * 공용 클래스 크기를 덮어쓰지 않고 이 기능 전용 버튼으로 둔다(프로젝트 카드의 원격 주소와 같은 방식).
 */
export function DeployLink({
  mono = false,
  external = false,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  /** 식별자(URL·해시·잡 경로·이슈 키) — 모노 */
  mono?: boolean;
  /** 외부 링크 표시 아이콘 */
  external?: boolean;
}) {
  const cls =
    'deploy__link' +
    (mono ? ' deploy__link--mono' : '') +
    (className ? ` ${className}` : '');
  return (
    <button type="button" className={cls} {...rest}>
      {children}
      {external && <Icon name="arrow-up-right" size={11} />}
    </button>
  );
}
