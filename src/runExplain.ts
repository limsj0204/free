import { NEXT, OF_NAME, ORIGIN, type Arm, type OutfielderId, type RunScenario } from './runner';
import { extraRoute } from './runExtra';
import { isForced } from './runGround';

// 생성된 주루 상황의 해설을 규칙으로 쓴다. 숫자(세이프 확률, 기대 득점)는 결과 화면에 따로 나온다.

function ballText(scn: RunScenario) {
  const of = OF_NAME[scn.fielder!];
  const r = scn.hit!.release;
  if (scn.hit!.type === 'fly') {
    if (r === 'charging') return `얕은 타구라 ${of}가 앞으로 오면서 잡고, 그 기세로 바로 던져요.`;
    if (r === 'back') return `깊은 타구라 ${of}가 뒤로 물러나며 잡아서, 몸을 돌려 던지기까지 오래 걸려요.`;
    return `${of}가 제자리 근처에서 잡아서 던져요.`;
  }
  if (r === 'charging') return `${of}가 앞으로 오면서 잡아서 바로 던질 수 있는 타구예요.`;
  if (r === 'back') return `${of}가 뒤로 쫓아가 잡아서, 몸을 돌려 던지기까지 오래 걸려요.`;
  return `${of}가 옆으로 움직여 잡아서, 던지기까지 조금 걸려요.`;
}

function distanceText(scn: RunScenario) {
  const target = scn.kind === 'extra' ? extraRoute(scn).target : NEXT[ORIGIN[scn.me]];
  if (target === 'third' && scn.fielder === 'RF') return '우익수에서 3루는 외야에서 가장 먼 송구예요.';
  if (target === 'third' && scn.fielder === 'LF') return '좌익수에서 3루는 가까워요.';
  if (scn.kind === 'extra' && target === 'third' && scn.fielder === 'CF') return '중견수에서 3루는 우익수보다 훨씬 가까워서, 중견수가 잡는 단타면 1루 주자는 2루에서 멈추는 게 기본이에요.';
  return '';
}

const ARM_TEXT: Record<Arm, string> = { strong: '어깨가 강해서 송구가 빨라요.', average: '', weak: '어깨가 약한 편이라 송구가 느려요.' };

function extraText(scn: RunScenario) {
  const o = scn.situation.outs;
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

// 플라이 1단계 원칙
function flyText(scn: RunScenario) {
  const o = scn.situation.outs;
  const pc = scn.hit!.catchProb ?? 1;
  if (o === 2) return '2아웃이면 잡히는 순간 이닝이 끝나서 베이스로 돌아갈 이유가 없어요. 타격과 동시에 스타트해요.';
  const parts: string[] = [];
  if (pc < 0.7) parts.push('잡힐지 떨어질지 모르는 타구예요. 하프웨이로 나가 있으면 잡혀도 돌아올 수 있고, 떨어지면 바로 다음 베이스로 가요.');
  if (scn.me === 'r1') parts.push('1루 주자는 공이 떨어지면 타자가 1루로 오니 2루까지 가야 해요(포스). 베이스에 붙어 있다가 떨어지면 2루에서 잡힐 수 있어요.');
  if (scn.me === 'r3') parts.push('3루 주자는 외야 플라이면 베이스로 돌아가 태그업을 준비하는 게 기본이에요. 잡히는 순간 베이스를 밟고 있어야 홈으로 뛸 수 있어요.');
  if (scn.me === 'r2') parts.push(o === 0 ? '무사 2루면 태그업으로 3루에 가는 게 값져요(1사 3루). 깊은 타구면 베이스로 돌아가 준비해요.' : '1아웃이면 태그업으로 3루에 가도 2아웃 3루라 얻는 게 적어요. 하프웨이로 나가 떨어지면 홈까지 가는 쪽을 생각해요.');
  parts.push('스타트했다가 공이 잡히면 원래 베이스로 돌아가야 해서, 멀리 나가 있을수록 더블아웃이 돼요.');
  return parts.join(' ');
}

function groundText(scn: RunScenario) {
  const o = scn.situation.outs;
  if (isForced(scn)) return '포스(의무 진루) 상황이에요. 내 뒤 베이스가 다 차 있어서, 타구가 어디로 가든 다음 베이스로 뛰어야 해요. 병살이 될 것 같아도 최대한 빨리 가는 게 주자의 일이에요.';
  const base = scn.me === 'r2' ? '2루' : '3루';
  if (o === 2) return `2아웃이면 타구가 맞는 순간 뛰어요. 아웃이면 어차피 이닝이 끝나요.`;
  return `포스가 아니라 ${base}에 남아도 돼요. 타구가 내 앞으로 오면 뛰는 순간 내 쪽으로 던져서 잡히고, 수비가 1루로 던질 수밖에 없는 타구면 진루해요.`;
}

export function explainRun(scn: RunScenario) {
  if (scn.explanation) return scn.explanation;
  if (scn.kind === 'ground') return groundText(scn);
  const tail = scn.kind === 'fly' ? flyText(scn) : extraText(scn);
  return [ballText(scn), distanceText(scn), ARM_TEXT[scn.arm!], tail].filter(Boolean).join(' ');
}

// 브리핑에 보여줄 외야수 셋의 어깨. 공을 처리하는 외야수는 상황에 정해진 값, 나머지는 상황마다 고정된 임의 값.
export function armsOf(scn: RunScenario): Record<OutfielderId, Arm> | null {
  if (!scn.fielder || !scn.arm) return null;
  let h = 0;
  for (const c of scn.id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const arms: Arm[] = ['strong', 'average', 'weak'];
  const out = {} as Record<OutfielderId, Arm>;
  (['LF', 'CF', 'RF'] as OutfielderId[]).forEach((f, i) => {
    out[f] = f === scn.fielder ? scn.arm! : arms[(h >>> (i * 3)) % 3];
  });
  return out;
}
