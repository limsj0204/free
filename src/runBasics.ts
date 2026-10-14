// 주루 판단 기초 개념 카드: 야구 규칙을 잘 모르는 사람이 주루 판단을 이해하는 데 필요한 최소한의 개념.
// 카드마다 그림(SVG) 하나와 짧은 설명을 보여준다. 그림과 화면은 내야 수비의 기초 개념 카드와 같은 모양이다.

type Pt = [number, number];

const BASE: Record<'home' | 'first' | 'second' | 'third', Pt> = {
  home: [110, 150],
  first: [172, 94],
  second: [110, 38],
  third: [48, 94],
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
  glow?: Pt[]; // 강조할 베이스
  balls?: Pt[]; // 공 위치 (외야 뜬공 등)
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
  const ball = (p: Pt) => `<circle class="ball" cx="${p[0]}" cy="${p[1]}" r="4" />`;
  const mark = (m: Mark) => `<text class="mark ${m.tone ?? 'good'}" x="${m.at[0]}" y="${m.at[1]}" text-anchor="middle">${m.text}</text>`;
  const head = (k: string) =>
    `<marker id="ah-${k}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path class="ah ${k}" d="M0,0 L10,5 L0,10 z" /></marker>`;
  return `<svg class="basics-svg" viewBox="0 0 220 176" aria-hidden="true">
    <defs>${head('run')}${head('ball')}${head('back')}</defs>
    <polygon class="infield" points="${h.join(',')} ${f.join(',')} ${s.join(',')} ${t.join(',')}" />
    ${[h, f, s, t].map(bag).join('')}
    ${(d.arrows ?? []).map(arrow).join('')}
    ${(d.runners ?? []).map(runner).join('')}
    ${(d.balls ?? []).map(ball).join('')}
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

export const RUN_BASIC_CARDS: BasicCard[] = [
  {
    title: '포스: 밀려서 뛰는 주자',
    svg: diagram({
      runners: [lerp(home, first, 0.35), lerp(first, second, 0.4)],
      arrows: [
        { from: lerp(home, first, 0.45), to: lerp(home, first, 0.85) },
        { from: lerp(first, second, 0.5), to: lerp(first, second, 0.85) },
      ],
      glow: [second],
      marks: [{ at: [150, 30], text: '꼭 가야 해요', tone: 'warn' }],
    }),
    body: [
      '타자는 공을 치면 <b>무조건 1루로</b> 뛰어요. 그래서 1루에 있던 주자는 자리를 비켜 주려고 2루로 <b>밀려서</b> 뛰어야 해요. 이걸 포스(의무 진루)라고 해요.',
      '포스인 주자는 땅볼이면 <b>돌아갈 곳이 없어요</b>. 병살이 될 것 같아도 최대한 빨리 다음 베이스로 가요.',
      '포스인지는 <b>"내 뒤 베이스가 다 차 있는지"</b>로 봐요. 1·2루면 2루 주자도, 만루면 3루 주자도 포스예요.',
    ],
  },
  {
    title: '포스가 아닐 때: 타구를 보고 정해요',
    svg: diagram({
      runners: [second],
      arrows: [
        { from: lerp(home, second, 0.12), to: [72, 60], kind: 'ball' },
        { from: lerp(home, second, 0.12), to: [150, 64], kind: 'ball' },
      ],
      marks: [
        { at: [50, 52], text: '내 앞: 머문다', tone: 'warn' },
        { at: [176, 56], text: '내 뒤: 진루' },
      ],
    }),
    body: [
      '뒤에 주자가 없으면 밀리지 않아서, 땅볼에도 뛸지 말지 <b>스스로 정해요</b>.',
      '타구가 <b>내 앞</b>(2루 주자라면 유격수·3루수 쪽)으로 오면, 뛰는 순간 수비가 내 쪽으로 던져서 잡혀요. 머물러요.',
      '타구가 <b>내 뒤</b>(1루수·2루수 쪽)로 가면 수비는 1루로 던지기 쉬워요. 그 사이 다음 베이스로 가요.',
    ],
  },
  {
    title: '리드와 귀루',
    svg: diagram({
      runners: [lerp(first, second, 0.3)],
      arrows: [{ from: lerp(first, second, 0.24), to: lerp(first, second, 0.08), kind: 'back' }],
      balls: [[150, 14]],
      glow: [first],
      marks: [
        { at: [150, 8], text: '잡히면' },
        { at: [158, 124], text: '먼저 밟아야 세이프', tone: 'warn' },
      ],
    }),
    body: [
      '주자는 투구 전에 다음 베이스 쪽으로 몇 걸음 나가 있어요. 이걸 <b>리드</b>라고 해요.',
      '뜬공이 땅에 닿기 전에 잡히면 타자는 아웃이고, 주자는 <b>원래 베이스로 돌아가야(귀루)</b> 해요.',
      '돌아오기 전에 공이 그 베이스에 먼저 가면 주자도 아웃이에요. 그래서 2아웃 전에는 뜬공에 <b>멀리 나가면 안 돼요</b>.',
    ],
  },
  {
    title: '태그업',
    svg: diagram({
      runners: [third],
      arrows: [{ from: lerp(third, home, 0.15), to: lerp(third, home, 0.85) }],
      balls: [[70, 14]],
      glow: [third],
      marks: [
        { at: [70, 8], text: '잡히는 순간' },
        { at: [40, 132], text: '베이스에서 출발' },
      ],
    }),
    body: [
      '뜬공이 잡혀도 주자는 <b>베이스를 밟고 있다가</b> 공이 글러브에 닿는 순간 다음 베이스로 뛸 수 있어요. 이걸 태그업이라고 해요.',
      '잡히기 전에 베이스를 떠나 있었다면 <b>다시 밟고</b> 출발해야 해요. 그래서 3루 주자는 뜬공이 뜨면 먼저 베이스로 돌아가요.',
      '3루 주자가 태그업으로 홈에 들어오면 <b>희생플라이</b>예요. 외야수가 멀리서 잡을수록 성공하기 쉬워요.',
    ],
  },
  {
    title: '하프웨이',
    svg: diagram({
      runners: [lerp(first, second, 0.5)],
      arrows: [
        { from: lerp(first, second, 0.43), to: lerp(first, second, 0.12), kind: 'back' },
        { from: lerp(first, second, 0.57), to: lerp(first, second, 0.88) },
      ],
      balls: [[110, 8]],
      marks: [
        { at: [186, 74], text: '잡히면 1루로', tone: 'warn' },
        { at: [160, 34], text: '떨어지면 2루로' },
      ],
    }),
    body: [
      '뜬공이 잡힐지 떨어질지 모를 때, 두 베이스 <b>중간쯤</b> 나가서 기다리는 거예요.',
      '잡히면 돌아올 시간이 있고, 떨어지면 바로 다음 베이스로 가요. 1루 주자의 기본 자세예요.',
      '<b>2아웃</b>이면 하프웨이 대신 타격과 동시에 뛰어요(스타트). 잡히면 어차피 이닝이 끝나니까요.',
    ],
  },
  {
    title: '한 베이스 더',
    svg: diagram({
      runners: [lerp(second, third, 0.15)],
      arrows: [
        { from: lerp(second, third, 0.25), to: lerp(second, third, 0.85) },
        { from: [206, 40], to: lerp(third, second, 0.1), kind: 'ball' },
      ],
      balls: [[206, 40]],
      glow: [third],
      marks: [{ at: [160, 24], text: '우익수 → 3루: 먼 송구' }],
    }),
    body: [
      '외야 안타 때 한 베이스 더 갈지는 <b>외야수가 공을 잡는 모습</b>과 <b>송구 거리</b>로 정해요.',
      '앞으로 오면서 잡으면 바로 던지니 멈추고, 옆이나 뒤로 쫓아가 잡으면 던지기까지 오래 걸리니 더 가요.',
      '베이스 몇 걸음 전에 정해야 속도를 줄이지 않고 돌 수 있어요. 늦게 정하면 그만큼 <b>베이스에서 머뭇거려요</b>.',
    ],
  },
  {
    title: '아웃 카운트에 따라 달라지는 것',
    svg: '',
    body: [
      '같은 타구라도 <b>아웃 카운트에 따라 답이 달라져요</b>. 아웃되면 잃는 것과 한 베이스 더 가서 얻는 것을 함께 따져요.',
      '<b>무사</b>: 아웃이 아까워요. 무사 3루면 다음 타자의 땅볼이나 플라이로도 점수가 나니, 아슬아슬하면 무리하지 않아요.',
      '<b>1사</b>: 잡히면 2아웃이라 다음 타자에게 기대기 어려워요. 3루 주자는 희생플라이로 과감하게 홈을 노려요.',
      '<b>2아웃</b>: 아웃 하나로 이닝이 끝나서, 주자는 공이 맞으면 모두 뛰어요.',
      '이제 목록의 기본 상황을 <b>기초 → 응용 → 심화</b> 순서로, 위에서부터 차례로 해보세요.',
    ],
  },
];
