// 기초 개념 카드: 야구 규칙을 잘 모르는 사람이 시뮬레이터의 판단을 이해하는 데 필요한 최소한의 개념.
// 카드마다 내야 그림(SVG) 하나와 짧은 설명을 보여준다.

type Pt = [number, number];

const BASE: Record<'home' | 'first' | 'second' | 'third', Pt> = {
  home: [110, 150],
  first: [172, 94],
  second: [110, 38],
  third: [48, 94],
};

// 수비 위치 (포지션 번호 그림용)
const SPOT: Record<string, Pt> = {
  '1': [110, 99],
  '2': [110, 166],
  '3': [164, 72],
  '4': [140, 52],
  '5': [56, 72],
  '6': [80, 52],
};

interface Arrow {
  from: Pt;
  to: Pt;
  kind?: 'run' | 'ball' | 'back';
}

interface Mark {
  at: Pt;
  text: string;
  tone?: 'good' | 'warn';
}

interface Diagram {
  runners?: Pt[];
  arrows?: Arrow[];
  marks?: Mark[];
  numbers?: boolean;
  glow?: Pt[]; // 강조할 베이스
}

function diagram(d: Diagram): string {
  const [h, f, s, t] = [BASE.home, BASE.first, BASE.second, BASE.third];
  const bag = (p: Pt) => {
    const lit = d.glow?.some((g) => g[0] === p[0] && g[1] === p[1]);
    return `<rect class="bag${lit ? ' lit' : ''}" x="${p[0] - 6}" y="${p[1] - 6}" width="12" height="12" transform="rotate(45 ${p[0]} ${p[1]})" />`;
  };
  const arrow = (a: Arrow) =>
    `<line class="arrow ${a.kind ?? 'run'}" x1="${a.from[0]}" y1="${a.from[1]}" x2="${a.to[0]}" y2="${a.to[1]}" marker-end="url(#ah-${a.kind ?? 'run'})" />`;
  const runner = (p: Pt) => `<circle class="runner" cx="${p[0]}" cy="${p[1]}" r="7" />`;
  const mark = (m: Mark) => `<text class="mark ${m.tone ?? 'good'}" x="${m.at[0]}" y="${m.at[1]}" text-anchor="middle">${m.text}</text>`;
  const num = (n: string, p: Pt) => `<circle class="pos" cx="${p[0]}" cy="${p[1]}" r="9" /><text class="pos-n" x="${p[0]}" y="${p[1] + 4}" text-anchor="middle">${n}</text>`;
  const head = (k: string) =>
    `<marker id="ah-${k}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path class="ah ${k}" d="M0,0 L10,5 L0,10 z" /></marker>`;
  return `<svg class="basics-svg" viewBox="0 0 220 176" aria-hidden="true">
    <defs>${head('run')}${head('ball')}${head('back')}</defs>
    <polygon class="infield" points="${h.join(',')} ${f.join(',')} ${s.join(',')} ${t.join(',')}" />
    ${[h, f, s, t].map(bag).join('')}
    ${d.numbers ? Object.entries(SPOT).map(([n, p]) => num(n, p)).join('') : ''}
    ${(d.arrows ?? []).map(arrow).join('')}
    ${(d.runners ?? []).map(runner).join('')}
    ${(d.marks ?? []).map(mark).join('')}
  </svg>`;
}

// 두 점 사이의 한 지점 (화살표를 베이스에서 조금 떨어뜨리려고)
const lerp = (a: Pt, b: Pt, k: number): Pt => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];

export interface BasicCard {
  title: string;
  svg: string;
  body: string[];
}

const { home, first, second, third } = BASE;

export const BASIC_CARDS: BasicCard[] = [
  {
    title: '포지션과 번호',
    svg: diagram({ numbers: true }),
    body: [
      '기록에서는 수비 위치를 번호로 불러요. <b>1 투수, 2 포수, 3 1루수, 4 2루수, 5 3루수, 6 유격수</b>예요. (7~9는 외야수)',
      '"6-4-3 병살"은 유격수(6)가 잡아 2루수(4)에게, 2루수가 1루수(3)에게 던져 아웃 2개를 잡았다는 뜻이에요.',
      '2루수와 유격수를 묶어 <b>키스톤</b>이라고 불러요. 2루 근처를 함께 지키는 짝이에요.',
    ],
  },
  {
    title: '포스아웃: 밀리는 주자',
    svg: diagram({
      runners: [lerp(home, first, 0.35), lerp(first, second, 0.4)],
      arrows: [
        { from: lerp(home, first, 0.45), to: lerp(home, first, 0.85) },
        { from: lerp(first, second, 0.5), to: lerp(first, second, 0.85) },
      ],
      glow: [first, second],
      marks: [
        { at: [182, 120], text: '밟으면 아웃' },
        { at: [150, 30], text: '밟으면 아웃' },
      ],
    }),
    body: [
      '타자는 공을 치면 <b>무조건 1루로</b> 뛰어야 해요. 그래서 1루에 있던 주자는 자리를 비켜 줘야 하니 2루로 <b>밀려서</b> 뛰어요.',
      '이렇게 밀리는 주자는, 공을 가지고 <b>그 베이스를 밟기만 해도 아웃</b>이에요. 이게 포스아웃이에요.',
      '주자가 1·2루면 2루 주자도 3루로, 만루면 3루 주자도 홈으로 밀려요.',
    ],
  },
  {
    title: '태그아웃: 밀리지 않는 주자',
    svg: diagram({
      runners: [lerp(second, third, 0.4), lerp(home, first, 0.35)],
      arrows: [
        { from: lerp(second, third, 0.5), to: lerp(second, third, 0.85) },
        { from: lerp(home, first, 0.45), to: lerp(home, first, 0.85) },
      ],
      glow: [third],
      marks: [
        { at: [36, 122], text: '직접 태그', tone: 'warn' },
        { at: [182, 120], text: '밟으면 아웃' },
      ],
    }),
    body: [
      '뒤에 주자가 없으면 밀리지 않아요. 예를 들어 주자 2루에서 땅볼이 나오면, 2루 주자는 뛸지 말지 <b>스스로 정해요</b>.',
      '이런 주자를 잡으려면 베이스를 밟는 게 아니라, 공을 든 글러브로 <b>주자를 직접 건드려야</b> 해요. 이게 태그아웃이에요.',
      '태그는 시간이 더 걸리고 놓치기 쉬워서, 결과가 같다면 <b>포스아웃이 더 안전</b>해요.',
    ],
  },
  {
    title: '포스가 풀릴 때',
    svg: diagram({
      runners: [lerp(first, second, 0.45)],
      glow: [first, second],
      marks: [
        { at: [182, 120], text: '① 먼저 밟음' },
        { at: [150, 30], text: '② 이제 태그', tone: 'warn' },
      ],
    }),
    body: [
      '뒤 주자가 먼저 아웃되면, 앞 주자는 <b>더 이상 밀리지 않아요</b>.',
      '1루를 먼저 밟아 타자를 잡으면 1루 주자의 포스가 풀려서, 2루에서는 <b>태그</b>해야 해요. 그래서 병살은 보통 <b>앞 주자(2루)부터</b> 잡고 1루로 이어요.',
      '만루에서 1루부터 밟으면 홈도 태그가 돼서 실점 위험이 커져요. 만루에서는 홈부터예요.',
    ],
  },
  {
    title: '병살과 병살 대형',
    svg: diagram({
      runners: [lerp(first, second, 0.3)],
      arrows: [
        { from: [80, 58], to: lerp(second, third, 0.12), kind: 'ball' },
        { from: lerp(second, first, 0.12), to: lerp(second, first, 0.86), kind: 'ball' },
      ],
      glow: [second, first],
      marks: [
        { at: [62, 46], text: '① 2루로' },
        { at: [176, 62], text: '② 1루로' },
      ],
    }),
    body: [
      '한 번의 플레이로 아웃 2개를 잡는 걸 <b>병살</b>이라고 해요. 1루에 주자가 있고 2아웃이 아니면 2루(포스) → 1루(포스)로 병살을 노려요.',
      '그래서 이런 상황엔 2루수와 유격수가 2루 쪽으로 조금 당겨 서요. 이걸 <b>병살 대형</b>이라고 해요.',
      '공을 <b>잡지 않은 쪽</b> 키스톤이 2루를 커버해요. 유격수가 잡으면 2루수가, 2루수가 잡으면 유격수가 2루로 가요.',
    ],
  },
  {
    title: '직선타와 귀루',
    svg: diagram({
      runners: [lerp(first, second, 0.35)],
      arrows: [{ from: lerp(first, second, 0.3), to: lerp(first, second, 0.08), kind: 'back' }],
      glow: [first],
      marks: [{ at: [182, 120], text: '먼저 밟으면 아웃' }],
    }),
    body: [
      '땅에 닿기 전에 잡힌 타구(뜬공·직선타)는 잡는 순간 <b>타자가 아웃</b>이에요.',
      '이때 주자는 <b>원래 베이스로 돌아가야(귀루)</b> 해요. 리드하거나 뛰어나갔던 주자가 돌아오기 전에 공이 그 베이스에 먼저 가면, 베이스만 밟아도 주자가 아웃이에요.',
    ],
  },
  {
    title: '아웃카운트에 따라 달라지는 것',
    svg: '',
    body: [
      '<b>무사·1사</b>: 병살로 아웃 2개를 노릴 수 있어요. 앞 주자를 잡을지, 확실한 1루를 잡을지가 판단의 핵심이에요.',
      '<b>2아웃</b>: 아웃 하나면 이닝이 끝나요. 주자들은 공이 맞으면 모두 뛰고, 가장 확실한 아웃 하나면 충분해요.',
      '세 번째 아웃이 <b>포스아웃</b>이면, 그 사이 홈을 밟은 주자의 점수는 인정되지 않아요.',
      '이제 목록의 기본 상황을 <b>기초 → 응용 → 심화</b> 순서로, 위에서부터 차례로 해보세요.',
    ],
  },
];
