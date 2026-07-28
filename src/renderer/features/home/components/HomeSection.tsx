import {
  useCallback,
  useState,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";
import { Icon } from "../../../components/Icon";
import type { IconName } from "../../../components/Icon";
import { RefreshButton } from "../../../components/RefreshButton";
import { usePolling } from "../../../lib/usePolling";
import {
  getAttendanceSnapshot,
  subscribeAttendance,
} from "../../attendance";
import { isDone } from "../../jira";

// Jira 섹션과 같은 '확인함' 기준 — 새 티켓 강조를 사이드바 뱃지와 일치시킨다
const JIRA_SEEN_KEY = "jira:seenKeys";

/** 카드 하나의 공통 데이터 — 실패·미설정은 sub 로 설명하고 value 는 '—' */
type CardState<T> = { data?: T; error?: string; unconfigured?: boolean };

type JiraSummary = { open: number; fresh: number };
type PrSummary = { count: number };
type MailSummary = { unread: number };
type DeploySummary = { projects: number; building: string[] };

function StatCard({
  icon,
  label,
  value,
  sub,
  accent = false,
  onClick,
}: {
  icon: IconName;
  label: string;
  value: ReactNode;
  sub: ReactNode;
  accent?: boolean;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span className="home__card-head">
        <Icon name={icon} size={14} />
        <span>{label}</span>
        {onClick && (
          <span className="home__card-go">
            <Icon name="chevron-right" size={12} />
          </span>
        )}
      </span>
      <span
        className={"home__card-value" + (accent ? " home__card-value--accent" : "")}
      >
        {value}
      </span>
      <span className="home__card-sub">{sub}</span>
    </>
  );
  return onClick ? (
    <button type="button" className="home__card home__card--link" onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className="home__card">{body}</div>
  );
}

/**
 * 홈 대시보드 — 오늘 요약(출퇴근·Jira·PR·메일·배포)을 카드로 한눈에.
 * 기존 기능의 IPC 만 조합하며, 카드 클릭 시 해당 섹션으로 이동한다.
 * 출퇴근은 위젯이 조회한 결과를 공유 스토어로 재사용 (puppeteer 중복 구동 방지).
 */
export function HomeSection({
  onNavigate,
}: {
  onNavigate: (sectionId: string) => void;
}) {
  const att = useSyncExternalStore(subscribeAttendance, getAttendanceSnapshot);
  const [jira, setJira] = useState<CardState<JiraSummary> | null>(null);
  const [pr, setPr] = useState<CardState<PrSummary> | null>(null);
  const [mail, setMail] = useState<CardState<MailSummary> | null>(null);
  const [deploy, setDeploy] = useState<CardState<DeploySummary> | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      // Jira — 미해결 수 + 사이드바 뱃지와 같은 기준의 '새 티켓' 수
      window.oneApp.jira
        .list()
        .then((res) => {
          if (!res.ok) {
            setJira(
              res.configured === false
                ? { unconfigured: true }
                : { error: res.error ?? "조회 실패" },
            );
            return;
          }
          const keys = (res.issues ?? [])
            .filter((i) => !isDone(i))
            .map((i) => i.key);
          let seen: string[] = [];
          try {
            seen = JSON.parse(
              localStorage.getItem(JIRA_SEEN_KEY) ?? "[]",
            ) as string[];
          } catch {
            seen = [];
          }
          setJira({
            data: {
              open: keys.length,
              fresh: keys.filter((k) => !seen.includes(k)).length,
            },
          });
        })
        .catch(() => setJira({ error: "조회 실패" })),
      // PR — 접근 가능한 전체 저장소의 열린 PR 수
      window.oneApp.prs
        .fetch()
        .then((res) =>
          setPr(
            !res.configured
              ? { unconfigured: true }
              : res.ok
                ? { data: { count: (res.prs ?? []).length } }
                : { error: res.error ?? "조회 실패" },
          ),
        )
        .catch(() => setPr({ error: "조회 실패" })),
      // 메일 — 안읽은 수
      window.oneApp.mail
        .getUnreadCount()
        .then((res) =>
          setMail(
            !res.configured
              ? { unconfigured: true }
              : res.ok
                ? { data: { unread: res.unreadCount } }
                : { error: res.error ?? "조회 실패" },
          ),
        )
        .catch(() => setMail({ error: "조회 실패" })),
      // 배포 — 프로젝트 수 + 지금 빌드/대기 중인 대상 이름
      (async () => {
        try {
          const projects = await window.oneApp.deploy.getProjects();
          if (projects.length === 0) {
            setDeploy({ unconfigured: true });
            return;
          }
          const statuses = await Promise.all(
            projects.map((p) =>
              window.oneApp.deploy
                .fetchStatuses(p.id)
                .catch(() => ({}) as Record<string, never>),
            ),
          );
          const building: string[] = [];
          projects.forEach((p, i) => {
            for (const t of p.targets) {
              const st = statuses[i][t.id];
              if (st && (st.state === "building" || st.state === "queued")) {
                building.push(`${p.name} · ${t.name}`);
              }
            }
          });
          setDeploy({ data: { projects: projects.length, building } });
        } catch {
          setDeploy({ error: "조회 실패" });
        }
      })(),
    ]);
    setRefreshing(false);
  }, []);

  // 홈이 보이는 동안 2분마다 갱신 — PR·젠킨스 폴링 부하와 균형
  usePolling(
    useCallback(() => void refresh(), [refresh]),
    120_000,
  );

  const now = new Date();
  const dateStr = `${now.getMonth() + 1}월 ${now.getDate()}일 ${
    ["일", "월", "화", "수", "목", "금", "토"][now.getDay()]
  }요일`;
  const hour = now.getHours();
  const hello =
    hour < 6
      ? "늦은 시간까지 고생 많아요"
      : hour < 12
        ? "좋은 아침이에요"
        : hour < 18
          ? "좋은 오후예요"
          : "오늘도 수고했어요";

  // 출퇴근 카드 — 다음 행동 기준 문구 (위젯과 동일한 판단)
  const info = att.info;
  const attValue =
    att.loading && !info
      ? "확인 중"
      : !info
        ? "—"
        : !info.comeTime
          ? "출근 전"
          : !info.leaveTime
            ? info.comeTime
            : `${info.comeTime} → ${info.leaveTime}`;
  const attSub = !info
    ? att.error || "사이드바 근태 위젯에서 조회됩니다"
    : !info.comeTime
      ? "아직 출근을 안 찍었어요"
      : !info.leaveTime
        ? "출근 완료 — 퇴근 전"
        : "오늘 출퇴근 완료";

  const cardValue = <T,>(
    st: CardState<T> | null,
    pick: (data: T) => ReactNode,
  ): ReactNode => (st?.data !== undefined ? pick(st.data) : "—");

  const cardSub = <T,>(
    st: CardState<T> | null,
    normal: (data: T) => ReactNode,
    unconfiguredMsg: string,
  ): ReactNode =>
    st === null
      ? "불러오는 중..."
      : st.unconfigured
        ? unconfiguredMsg
        : st.error
          ? st.error
          : st.data !== undefined
            ? normal(st.data)
            : null;

  return (
    <div className="section home">
      <div className="home__head">
        <div className="home__greet">
          <h2 className="home__date">{dateStr}</h2>
          <p className="home__hello">{hello}</p>
        </div>
        <RefreshButton
          size={14}
          spinning={refreshing}
          onClick={() => void refresh()}
          title="요약 새로고침"
        />
      </div>

      <div className="home__grid">
        <StatCard
          icon="building"
          label="출퇴근"
          value={attValue}
          sub={attSub}
          accent={!!info && !info.comeTime}
        />
        <StatCard
          icon="clipboard-list"
          label="Jira"
          value={cardValue(jira, (d) => d.open)}
          sub={cardSub(
            jira,
            (d) =>
              d.fresh > 0 ? `새 티켓 ${d.fresh}건 — 확인해 보세요` : "미해결 이슈",
            "환경설정 → 연동에서 Jira 를 설정하세요",
          )}
          accent={(jira?.data?.fresh ?? 0) > 0}
          onClick={() => onNavigate("jira")}
        />
        <StatCard
          icon="git-pull-request"
          label="PR"
          value={cardValue(pr, (d) => d.count)}
          sub={cardSub(
            pr,
            () => "열린 PR",
            "환경설정 → 연동에서 Gitea 를 설정하세요",
          )}
          onClick={() => onNavigate("prs")}
        />
        <StatCard
          icon="mail"
          label="메일"
          value={cardValue(mail, (d) => d.unread)}
          sub={cardSub(
            mail,
            (d) => (d.unread > 0 ? "안읽은 메일" : "모두 읽었어요"),
            "환경설정에서 비즈박스 계정을 설정하세요",
          )}
          accent={(mail?.data?.unread ?? 0) > 0}
          onClick={() => void window.oneApp.mail.openWeb()}
        />
        <StatCard
          icon="rocket"
          label="배포"
          value={cardValue(deploy, (d) =>
            d.building.length > 0 ? d.building.length : d.projects,
          )}
          sub={cardSub(
            deploy,
            (d) =>
              d.building.length > 0
                ? `빌드 중 — ${d.building.join(", ")}`
                : "등록된 프로젝트 · 모두 대기",
            "배포 탭에서 프로젝트를 등록하세요",
          )}
          accent={(deploy?.data?.building.length ?? 0) > 0}
          onClick={() => onNavigate("deploy")}
        />
      </div>
    </div>
  );
}
