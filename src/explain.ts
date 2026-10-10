import { BASE_LABEL, type BaseId } from './coords';
import {
  THROW_CHOICES,
  evaluate,
  isCarry,
  latestDecision,
  planRunners,
  type Choice,
  type Outcome,
  type ThrowScenario,
} from './scenario';

// 생성된 송구 상황의 해설을 규칙으로 만든다. 판정 엔진의 결과를 그대로 말로 옮긴다.

const NUM: Record<BaseId, string> = { home: '홈', first: '1루', second: '2루', third: '3루' };

function bestAt(scn: ThrowScenario, d: number): Outcome {
  return THROW_CHOICES.map((c) => evaluate(scn, c, d)).reduce((a, b) => (b.value > a.value ? b : a));
}

export function choiceLabel(scn: ThrowScenario, c: Choice) {
  if (c === 'hold') return '들고 있기';
  return isCarry(scn, c) ? `${BASE_LABEL[c]} 직접 밟기` : `${BASE_LABEL[c]} 송구`;
}

const join = (xs: string[]) => xs.join('·');

// 받침 유무에 맞는 조사를 붙인다 ('홈은', '2루는'). '으로'는 ㄹ 받침 뒤에서 '로'가 된다.
export function josa(word: string, withFinal: string, withoutFinal: string) {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  const final = code >= 0 && code <= 11171 ? code % 28 : 0;
  const hasFinal = final !== 0 && !(withFinal === '으로' && final === 8);
  return word + (hasFinal ? withFinal : withoutFinal);
}

export function explainThrow(scn: ThrowScenario): string {
  const out: string[] = [];
  const runners = planRunners(scn).filter((r) => r.id !== 'batter');

  // 1. 주자 상황
  const forced = runners.filter((r) => r.kind === 'force');
  if (forced.length) {
    out.push(
      `${join(forced.map((r) => NUM[r.origin]))} 주자는 밀려서 뛰어야 해서 ${josa(join(forced.map((r) => NUM[r.target])), '은', '는')} 베이스만 밟아도 아웃(포스아웃)이에요.`,
    );
  }
  for (const r of runners.filter((x) => x.kind === 'advance')) {
    out.push(
      `${NUM[r.origin]} 주자는 밀려서 뛰는 게 아닌데 ${r.target === 'home' ? '홈으로' : `${NUM[r.target]}로`} 뛰었어요. ${NUM[r.target]}에서 잡으려면 베이스가 아니라 주자를 태그해야 해요.`,
    );
  }
  const held = runners.filter((x) => x.kind === 'hold');
  if (held.length) {
    out.push(`${join(held.map((r) => NUM[r.origin]))} 주자는 멈춰 있어서 그 앞 베이스로 던져도 잡을 주자가 없어요.`);
  }

  const best = bestAt(scn, 0);
  const totalOuts = best.outsMade + best.autoOuts;

  // 2. 아웃 카운트
  if (scn.situation.outs === 2 && totalOuts >= 1) {
    out.push('2아웃이라 아웃 하나면 이닝이 끝나요. 가장 가깝고 확실한 아웃 하나면 충분해요.');
  }

  // 3. 최선의 선택이 왜 좋은지
  const label = choiceLabel(scn, best.choice);
  const scoredRunner = planRunners(scn).some(
    (r) => r.target === 'home' && (r.kind === 'force' || r.kind === 'advance') && !best.events.some((e) => e.runner === r.id && e.out),
  );
  const endsInning = scn.situation.outs + totalOuts >= 3;
  if (best.outsMade === 0) {
    out.push('어디로 던져도 아웃을 잡기 어려운 상황이에요. 무리하게 던지면 실책만 늘어요.');
  } else if (best.outsMade >= 2) {
    out.push(`${label} 후 이어 던지면 병살이에요.`);
    if (endsInning && scoredRunner) out.push('세 번째 아웃이 포스아웃이면, 그 사이 홈을 밟은 주자의 득점은 인정되지 않아요.');
  } else if (best.choice === 'home') {
    out.push('실점을 막는 게 가장 중요해서 홈에서 승부해요.');
  } else if (best.choice !== 'first' && scn.situation.outs < 2) {
    out.push(`${NUM[best.choice as BaseId]}에서 앞 주자를 잡으면 득점권에 주자를 덜 남겨서 1루 아웃보다 좋아요.`);
  } else if (best.choice === 'first' && scn.situation.outs < 2) {
    const tagOption = THROW_CHOICES.map((c) => evaluate(scn, c, 0)).some((o) => o.choice !== 'first' && o.events.some((e) => e.out && e.tag));
    out.push(
      tagOption
        ? '다른 베이스에서도 아웃을 노릴 수는 있지만 태그가 필요해서 위험해요. 확실한 1루 아웃을 챙기세요.'
        : '확실하게 잡을 수 있는 1루로 던지세요.',
    );
  }
  if (best.choice !== 'hold' && isCarry(scn, best.choice)) {
    out.push('베이스가 가까우니 던지지 않고 직접 밟는 게 가장 빠르고 확실해요.');
  }
  if (best.runs > 0 && !endsInning) out.push('1점은 주지만, 아웃을 늘리는 게 더 나아요.');

  // 4. 늦었을 때의 차선
  if (best.outsMade > 0) {
    const w = latestDecision(scn, best.choice, best.outsMade);
    if (w !== null) {
      const late = bestAt(scn, w + 0.05);
      if (late.choice !== best.choice && late.outsMade > 0) out.push(`판단이 늦었다면 ${josa(choiceLabel(scn, late.choice), '이', '가')} 차선이에요.`);
      else if (late.choice === best.choice && late.outsMade < best.outsMade && late.outsMade > 0)
        out.push('판단이 늦어서 병살이 안 되더라도 같은 곳으로 던져 아웃 하나는 챙기세요.');
    }
  }
  return out.join(' ');
}
