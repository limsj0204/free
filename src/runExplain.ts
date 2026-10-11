import { OF_NAME, route, type Arm, type OutfielderId, type RunScenario } from './runner';

// 생성된 주루 상황의 해설을 규칙으로 쓴다: 타구와 외야수 → 아웃 카운트별로 무엇을 얻고 잃는지.
// 숫자(세이프 확률, 기대 득점)는 결과 화면에 따로 나온다.

function ballText(scn: RunScenario) {
  const of = OF_NAME[scn.fielder];
  const r = scn.hit.release;
  if (scn.hit.type === 'fly') {
    if (r === 'charging') return `얕은 플라이라 ${of}가 앞으로 오면서 잡고, 그 기세로 바로 던져요.`;
    if (r === 'back') return `깊은 플라이라 ${of}가 뒤로 물러나며 잡아서, 몸을 돌려 던지기까지 오래 걸려요.`;
    return `${of}가 제자리 근처에서 잡아서 던져요.`;
  }
  if (r === 'charging') return `${of}가 앞으로 오면서 잡아서 바로 던질 수 있는 타구예요.`;
  if (r === 'back') return `${of}가 뒤로 쫓아가 잡아서, 몸을 돌려 던지기까지 오래 걸려요.`;
  return `${of}가 옆으로 움직여 잡아서, 던지기까지 조금 걸려요.`;
}

function distanceText(scn: RunScenario) {
  const target = route(scn).target;
  if (target === 'third' && scn.fielder === 'RF') return '우익수에서 3루는 외야에서 가장 먼 송구예요.';
  if (target === 'third' && scn.fielder === 'LF') return '좌익수에서 3루는 가까워요.';
  return '';
}

const ARM_TEXT: Record<Arm, string> = { strong: '어깨가 강해서 송구가 빨라요.', average: '', weak: '어깨가 약한 편이라 송구가 느려요.' };

function situationText(scn: RunScenario) {
  const o = scn.situation.outs;
  if (scn.kind === 'tagup') {
    if (scn.me === 'r3') {
      return o === 0
        ? '무사라 잡혀도 1사 3루예요. 다음 타자의 땅볼이나 플라이로도 점수가 나니, 아슬아슬하면 3루에 머무는 게 나아요.'
        : '1아웃이면 잡히는 순간 2아웃이에요. 3루에 남으면 안타가 나와야만 점수가 나서, 세이프 확률이 낮아도 뛰는 게 이득일 때가 많아요.';
    }
    return o === 0
      ? '무사 2루가 1사 3루가 되면 다음 타자의 땅볼이나 플라이로도 점수가 나요. 3루에서 아웃될 위험과 비교해서 정해요.'
      : '1아웃이면 잡히는 순간 2아웃이에요. 2아웃이면 3루에 있어도 플라이로 점수가 안 나서 2루와 거의 같아요. 얻는 건 적은데 3루에서 아웃되면 이닝이 끝나니, 세이프가 확실할 때만 가세요.';
  }
  if (scn.me === 'batter') {
    return '2루에 가면 다음 안타 하나로 홈까지 올 수 있는 득점권이에요. 대신 2루에서 아웃되면 주자가 사라지고 아웃만 늘어서, 세이프 확률이 꽤 높을 때만 이득이에요.';
  }
  if (scn.me === 'r1') {
    if (o === 0) return '무사 1, 2루도 좋은 기회라서, 3루에서 첫 번째 아웃을 당하면 손해가 커요. 확실할 때만 가세요.';
    if (o === 1) return '1아웃에서 3루에 있으면 안타가 아니어도 플라이나 땅볼로 점수가 나요. 그래서 1사 때 1루→3루가 가장 가치 있어요.';
    return '2아웃이면 2루에 있어도 다음 안타 때 타격과 동시에 뛰어서 홈까지 올 수 있어서, 3루까지 가서 얻는 게 적어요. 3루에서 아웃되면 이닝이 끝나요.';
  }
  if (o === 0) return '무사 1, 3루는 땅볼이나 플라이로도 점수가 나는 큰 기회예요. 홈에서 아웃되면 그 기회가 사라지니, 세이프가 거의 확실할 때만 가세요.';
  if (o === 1) return '2아웃이 아니라서 타구가 빠지는 걸 보고 출발해 한발 늦어요. 1사 1, 3루도 플라이 하나면 점수가 나니, 세이프 확률이 꽤 높을 때만 가세요.';
  return '2아웃이라 타격과 동시에 출발했어요. 3루에 멈추면 다음 타자가 안타를 쳐야만 점수가 나서, 홈에서 아웃될 위험을 감수할 만해요. 2아웃 2루에서 안타면 웬만하면 홈으로 가요.';
}

export function explainRun(scn: RunScenario) {
  if (scn.explanation) return scn.explanation;
  return [ballText(scn), distanceText(scn), ARM_TEXT[scn.arm], situationText(scn)].filter(Boolean).join(' ');
}

// 브리핑에 보여줄 외야수 셋의 어깨. 공을 처리하는 외야수는 상황에 정해진 값, 나머지는 상황마다 고정된 임의 값.
export function armsOf(scn: RunScenario): Record<OutfielderId, Arm> {
  let h = 0;
  for (const c of scn.id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const arms: Arm[] = ['strong', 'average', 'weak'];
  const out = {} as Record<OutfielderId, Arm>;
  (['LF', 'CF', 'RF'] as OutfielderId[]).forEach((f, i) => {
    out[f] = f === scn.fielder ? scn.arm : arms[(h >>> (i * 3)) % 3];
  });
  return out;
}
