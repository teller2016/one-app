/**
 * Bash 명령을 "실제로 실행되는 조각"으로 정규화한다 — 가드 훅들이 공유하는 전처리.
 *
 * ⚠️ **왜 필요한가**: 훅이 명령 문자열을 통째로 정규식에 넣으면, 명령을 *언급하기만 해도* 막힌다.
 *    2026-09-03 에 실제로 세 번 걸렸다.
 *      - `grep -n "npm run release" scripts/release.mjs`   → 파일을 읽었을 뿐인데 배포로 판정
 *      - `git commit -m "… npm run release …"`             → 커밋 메시지가 배포로 판정
 *      - `python3 - <<'PY' … git commit … PY`              → heredoc 안 텍스트가 커밋으로 판정
 *    빌드·배포·커밋은 그 프로그램을 **실행할 때만** 일어난다. 그래서 조각으로 나눠 첫 단어를 본다.
 *
 * 쓰는 곳: `require-build-skill.mjs` · `require-commit-skill.mjs`
 * **한쪽 판정을 고치면 다른 쪽도 함께 볼 것.**
 */

/** 셸의 줄 연결(`\` + 개행) — 이어 붙이지 않으면 한 명령이 줄마다 쪼개져 잘못 잡힌다 */
const joinContinuations = (s) => s.replace(/\\\r?\n/g, ' ');

/**
 * heredoc 본문 제거 — `python3 - <<'PY' … PY` 안은 명령이 아니라 **데이터**다.
 * 여는 표시(`<<EOF`)만 남기고 본문과 닫는 표시를 지운다.
 */
const stripHeredocs = (s) =>
  s.replace(/<<-?\s*(['"]?)([A-Za-z_]\w*)\1[\s\S]*?^\s*\2\s*$/gm, '<<HEREDOC');

/**
 * 따옴표 안의 셸 구분자를 가린다 — 문자열 안의 `;`·`|`·개행 때문에 조각이 잘못 갈리면
 * (`git commit -m "a; npm run make"`) 뒷동강이 명령으로 오인된다.
 */
const NUL = '\x00';
const maskInQuotes = (s) =>
  s.replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, (m) => m.replace(/[;|&\r\n]/g, NUL));

/** 따옴표로 감싼 인자를 비운다 — 문자열 안에 적힌 명령은 실행되는 명령이 아니다 */
export const stripQuoted = (s) =>
  s.replace(/'[^']*'/g, "''").replace(/"(?:[^"\\]|\\.)*"/g, '""');

/**
 * 파일을 읽기만 하는 도구 — 어느 가드에서도 검사 대상이 아니다.
 * (`sed` 는 `-i` 로 파일을 바꿀 수 있지만 그것도 빌드·배포·커밋은 아니다)
 */
const READ_ONLY_TOOLS = [
  'grep|rg|ag|cat|bat|head|tail|less|more|wc|nl|sed|awk|cut|sort|uniq|tr',
  'ls|stat|file|find|fd|diff|echo|printf|jq|pwd|which|type',
].join('|');

/**
 * 첫 단어(실행 프로그램)로 "검사할 필요 없는 조각"을 가리는 정규식.
 * `extra` 로 훅마다 추가 도구를 덧붙인다 — 예: 빌드 가드는 `git` 이 무관하지만,
 * **커밋 가드는 `git` 이 검사 대상이므로 넣으면 안 된다.**
 */
export function harmlessMatcher(extra = []) {
  return new RegExp(
    '^(?:sudo\\s+)?(?:\\w+=\\S*\\s+)*(?:' + [READ_ONLY_TOOLS, ...extra].join('|') + ')\\b',
  );
}

/**
 * 명령에서 **실제로 실행되는 조각들**을 뽑는다.
 * 전처리(줄 연결 → heredoc 제거 → 따옴표 안 구분자 가리기) 후 `;` `|` `&&` `||` 개행으로 나누고,
 * `harmless` 에 걸리는 조각(읽기 전용 도구 등)은 버린다.
 */
export function activeSegments(command, harmless) {
  return maskInQuotes(stripHeredocs(joinContinuations(String(command))))
    .split(/\|\||&&|[;|&\n]/)
    .map((x) => x.trim())
    .filter(Boolean)
    .filter((seg) => !harmless || !harmless.test(seg));
}
