import { BASE_LABEL, type BaseId } from './coords';
import {
  THROW_CHOICES,
  evaluate,
  isCarry,
  latestDecision,
  lateBest,
  lateDoublePlays,
  planRunners,
  playMargin,
  throwAnswers,
  type Choice,
  type Outcome,
  type ThrowScenario,
} from './scenario';

// 생성된 송구 상황의 해설을 규칙으로 만든다. 판정 엔진의 결과를 그대로 말로 옮긴다.

// 모든 번트 상황 해설 앞에 붙이는 판단 기준
export const BUNT_RULE =
  '번트는 공 속도에 따라 판단이 달라져요. 강하게 굴러와서 빨리 잡으면 앞 주자(병살까지), 느리게 굴러와서 앞으로 많이 달려 나와 잡으면 1루로 던져요.';

const NUM: Record<BaseId, string> = { home: '홈', first: '1루', second: '2루', third: '3루' };

function bestAt(scn: ThrowScenario, d: number): Outcome {
  return THROW_CHOICES.map((c) => evaluate(scn, c, d)).reduce((a, b) => (b.value > a.value ? b : a));
}

// 그 베이스로 오는 주자가 밀려 뛰는 게 아니라서 태그해야 하는가
function isTagBase(scn: ThrowScenario, c: Choice) {
  return planRunners(scn).some((r) => r.kind === 'advance' && r.target === c);
}

export function choiceLabel(scn: ThrowScenario, c: Choice) {
  if (c === 'hold') return '던지지 않기';
  if (isCarry(scn, c)) return `${BASE_LABEL[c]} ${isTagBase(scn, c) ? '직접 태그' : '직접 밟기'}`;
  return `${BASE_LABEL[c]} 송구`;
}

const join = (xs: string[]) => xs.join('·');

// 받침 유무에 맞는 조사를 붙인다 ('홈은', '2루는'). '으로'는 ㄹ 받침 뒤에서 '로'가 된다.
export function josa(word: string, withFinal: string, withoutFinal: string) {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  const final = code >= 0 && code <= 11171 ? code % 28 : 0;
  const hasFinal = final !== 0 && !(withFinal === '으로' && final === 8);
  return word + (hasFinal ? withFinal : withoutFinal);
}

// 직선타: 잡는 순간 타자 아웃, 귀루하지 못한 주자를 베이스에서 잡는다
function explainLiner(scn: ThrowScenario): string {
  const out: string[] = [];
  const { answers, ideal, immediate } = throwAnswers(scn);
  out.push(
    '땅에 닿기 전에 잡은 타구(직선타)는 잡는 순간 타자가 아웃이에요. 주자는 원래 베이스로 돌아가야(귀루) 하고, 돌아오기 전에 공이 그 베이스에 먼저 닿으면 베이스만 밟아도 주자가 아웃이에요.',
  );
  const e = ideal.events.find((x) => x.out);
  if (e && ideal.choice !== 'hold') {
    const who = `${NUM[e.base]} 주자`;
    const how = scn.hitAndRun ? '히트 앤드 런으로 멀리 뛰어나가 있어서' : '리드했다가 타구에 한 발 나와 있어서';
    const act = isCarry(scn, ideal.choice) ? `${josa(NUM[ideal.choice as BaseId], '을', '를')} 직접 밟으면` : `${josa(NUM[ideal.choice as BaseId], '으로', '로')} 던지면`;
    out.push(`${josa(who, '이', '가')} ${how} 아직 못 돌아왔어요. ${act} 한 번에 아웃 ${1 + ideal.outsMade}개예요.`);
    const others = answers.filter((c) => c !== ideal.choice);
    if (others.length) out.push(`${others.map((c) => choiceLabel(scn, c)).join(', ')}도 똑같이 귀루 아웃을 잡을 수 있어서 좋은 판단이에요.`);
    // 다른 주자는 이미 돌아와서 잡을 수 없다 (함께 인정한 곳의 주자는 빼고)
    const catchable = new Set(immediate.filter((o) => o.outsMade > 0).flatMap((o) => o.events.filter((x) => x.out).map((x) => x.base)));
    const back = planRunners(scn).filter((r) => r.kind === 'return' && !catchable.has(r.origin));
    if (back.length) out.push(`${back.map((r) => `${NUM[r.origin]} 주자`).join('·')}는 베이스 가까이 있어서 던져도 늦어요.`);
  }
  const total = scn.situation.outs + 1 + ideal.outsMade;
  if (total >= 3) out.push(`${scn.situation.outs === 0 ? '무사' : `${scn.situation.outs}사`}라 타자 아웃에 귀루 아웃까지 더하면 3아웃, 그대로 이닝이 끝나요.`);
  return out.join(' ');
}

export function explainThrow(scn: ThrowScenario): string {
  if (scn.batted.type === 'liner') return explainLiner(scn);
  const out: string[] = [];
  const runners = planRunners(scn).filter((r) => r.id !== 'batter');
  const bunt = scn.batted.type === 'bunt';

  if (bunt) out.push(BUNT_RULE);

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

  const { answers, close, immediate, follows, loadedHome, forceDp, twoOutAny } = throwAnswers(scn);
  const best = bestAt(scn, 0);
  const totalOuts = best.outsMade + best.autoOuts;
  // 해설에서 이미 좋은 판단이라고 말한 선택지 (나머지는 뒤에서 따로 알려준다)
  const mentioned = new Set<Choice>([best.choice]);
  const tagged = (o: Outcome) => o.events.some((e) => e.out && e.tag);

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
    const fa = best.choice !== 'hold' && isCarry(scn, best.choice) && best.follow && best.follow !== 'hold' ? best.follow : null;
    const ro = (b: Choice) => josa(NUM[b as BaseId], '으로', '로');
    out.push(fa ? `${label} 후 ${ro(fa)} 이어 던지면 병살이에요.` : `${label} 후 이어 던지면 병살이에요.`);
    // 뒤 주자를 먼저 잡아서 앞 주자의 포스가 풀린 경우
    const released = fa && best.events.find((e) => e.base === fa && e.tag && planRunners(scn).some((r) => r.id === e.runner && r.kind === 'force'));
    if (released) out.push(`${josa(NUM[best.choice as BaseId], '을', '를')} 먼저 밟아서 ${ro(fa)} 가는 주자는 포스가 풀렸어요. ${NUM[fa as BaseId]}에서는 태그해야 해요.`);
    if (fa) {
      // 밟은 뒤 다른 곳으로 던져도 병살이 되면, 왜 이쪽이 나은지 알려준다
      const fl = follows[best.choice];
      const alt = fl?.options.find((o) => o.follow !== fa && o.outsMade >= 2);
      if (alt && alt.follow && alt.follow !== 'hold') {
        const a = NUM[alt.follow as BaseId];
        if (fl!.best.includes(alt.follow)) out.push(`${josa(a, '으로', '로')} 던져도 같은 병살이라 똑같이 좋은 판단이에요.`);
        else if (alt.resultState !== best.resultState)
          out.push(`${josa(a, '으로', '로')} 던져도 병살이지만 남는 상황이 ${alt.resultState}예요. ${ro(fa)} 던지면 ${best.resultState}라 더 좋아요.`);
        else out.push(`${josa(a, '으로', '로')} 던져도 병살이지만, ${josa(NUM[fa as BaseId], '이', '가')} 더 가까워서 안전해요.`);
      }
    }
    if (endsInning && scoredRunner) out.push('세 번째 아웃이 포스아웃이면, 그 사이 홈을 밟은 주자의 득점은 인정되지 않아요.');
  } else if (best.choice === 'home') {
    out.push('실점을 막는 게 가장 중요해서 홈에서 승부해요.');
  } else if (best.choice !== 'first' && scn.situation.outs < 2) {
    out.push(
      `${tagged(best) ? '태그가 필요하지만 시간 여유가 있어서, ' : ''}${NUM[best.choice as BaseId]}에서 앞 주자를 잡으면 득점권에 주자를 덜 남겨서 1루 아웃보다 좋아요.`,
    );
  } else if (best.choice === 'first' && scn.situation.outs < 2) {
    const tagAlt = immediate.find((o) => o.choice !== 'first' && tagged(o));
    if (tagAlt && answers.includes(tagAlt.choice)) {
      out.push(`${NUM[tagAlt.choice as BaseId]}에서 태그로 앞 주자를 잡을 시간도 있어서 둘 다 좋은 판단이에요. 다만 태그는 실수할 여지가 있어서 확실한 1루 아웃이 조금 더 안전해요.`);
      mentioned.add(tagAlt.choice);
    } else if (tagAlt) out.push('다른 베이스에서도 아웃을 노릴 수는 있지만 태그가 필요해서 위험해요. 확실한 1루 아웃을 챙기세요.');
    else out.push('확실하게 잡을 수 있는 1루로 던지세요.');
  }
  if (close) {
    out.push(
      `다만 ${josa(choiceLabel(scn, close.lead.choice), '은', '는')} 잡자마자 던져도 ${close.margin.toFixed(2)}초 차이로 아슬아슬해서, 확실한 ${choiceLabel(scn, close.safe.choice)}도 좋은 판단이에요.`,
    );
    mentioned.add(close.safe.choice);
  }
  // 무사 만루·무사 1·3루: 홈으로 실점을 막는 것과 병살은 상황에 따라 최선이 갈린다
  const sit = scn.situation;
  let loadedNote = '';
  if (sit.outs === 0 && sit.runners.first && sit.runners.third && !sit.runners.second) {
    const home = immediate.find((o) => o.choice === 'home');
    if (loadedHome && home) {
      loadedNote =
        `3루 주자를 홈에서 태그로 확실하게 잡을 수 있으니 홈 승부도 좋은 판단이에요(${home.resultState}). 병살 대형이면 보통 1점을 주고 병살을 잡지만, ` +
        '1점이 중요한 접전이나 경기 후반이면 홈에서 실점을 막는 게 나아요. 점수 차와 이닝에 따라 최선이 달라져요.';
      mentioned.add('home');
    }
  } else if (sit.outs === 0 && sit.runners.first && sit.runners.second && sit.runners.third) {
    const home = immediate.find((o) => o.choice === 'home');
    if (best.choice === 'home' && best.outsMade >= 2) {
      loadedNote =
        '무사 만루에서는 홈도 포스 상황이라, 타구가 빠르면 홈에서 3루 주자를 잡고 포수가 1루로 이어 던지는 병살(실점 없이 아웃 2개)이 가장 좋아요. 타구가 느리거나 주자 스타트가 빠르면 홈은 아웃 하나뿐이니 타구 속도와 주자 속도를 보고 판단하세요.';
    } else if (loadedHome && home) {
      loadedNote =
        `홈으로 던져 3루 주자를 잡는 것도 좋은 판단이에요. 실점은 막지만 아웃은 하나뿐(${home.resultState})이고, 병살은 1점을 주는 대신 아웃이 2개예요. ` +
        '타구가 빠르고 주자 스타트가 늦으면 홈에서 포수가 1루로 이어 던져 병살까지 되니, 타구 속도와 주자 속도에 따라 최선이 달라져요.';
      mentioned.add('home');
    }
  }
  // 최선의 병살에 태그가 섞여 있으면, 포스로만 잡는 병살도 함께 인정한다
  let forceNote = '';
  if (forceDp) {
    const base = best.choice !== 'hold' ? NUM[best.choice as BaseId] : '';
    forceNote =
      (isCarry(scn, best.choice as BaseId) ? `${josa(base, '을', '를')} 먼저 밟으면 다른 주자들의 포스가 풀려서, 다음 아웃은 주자를 직접 태그해야 해요. ` : '') +
      `태그가 부담되면 ${josa(NUM[forceDp.choice as BaseId], '으로', '로')} 던져 둘 다 포스로 잡는 병살도 좋은 판단이에요(${forceDp.resultState.replace(/ \((.+)\)$/, ', $1')}).`;
    mentioned.add(forceDp.choice);
  }
  // 2아웃이면 어디서든 확실한 포스아웃 하나로 이닝이 끝난다 (위의 '2아웃이라 …' 문장에 이어서)
  if (twoOutAny?.length) {
    out.push(`${scn.situation.outs === 2 ? '어디서 잡아도 결과가 같으니' : '1사에 병살이면 이닝이 끝나서 어느 쪽으로 병살을 잡아도 결과가 같으니'}, 여유 있게 잡을 수 있는 ${twoOutAny.map((c) => choiceLabel(scn, c)).join(', ')}도 똑같이 좋은 판단이에요.`);
    for (const c of twoOutAny) mentioned.add(c);
  }
  // 점수 차이가 거의 없어서 같이 인정되는 선택지
  const others = answers.filter((c) => !mentioned.has(c));
  if (others.length) out.push(`${others.map((c) => choiceLabel(scn, c)).join(', ')}도 결과가 거의 같아서 좋은 판단이에요.`);
  if (bunt && best.choice === 'first') {
    // 앞 주자를 왜 못 잡는지: 잡자마자 던져도 늦는다
    const late = immediate.filter((o) => o.choice !== 'first' && o.events.length).map((o) => ({ o, m: playMargin(o)! })).find((x) => x.m < 0);
    if (late) out.push(`${josa(NUM[late.o.choice as BaseId], '은', '는')} 잡자마자 던져도 주자보다 ${(-late.m).toFixed(2)}초 늦어요.`);
  }
  if (best.choice !== 'hold' && isCarry(scn, best.choice)) {
    out.push(
      isTagBase(scn, best.choice)
        ? '베이스가 가까우니 던지지 않고 들고 가서 직접 태그하는 게 가장 빨라요.'
        : '베이스가 가까우니 던지지 않고 직접 밟는 게 가장 빠르고 확실해요.',
    );
  }
  if (best.runs > 0 && !endsInning && !loadedHome) out.push('1점은 주지만, 아웃을 늘리는 게 더 나아요.');
  if (loadedNote) out.push(loadedNote);
  if (forceNote) out.push(forceNote);

  // 4. 늦었을 때: 함께 인정되는 선택이면 '더 안전하다', 아니면 '차선'.
  // 2아웃이면 아웃 하나로 끝나서, 늦었을 때 엉뚱한 곳이 계산상 차선으로 나오는 경우가 있어 말하지 않는다.
  if (best.outsMade > 0 && scn.situation.outs < 2) {
    const w = latestDecision(scn, best.choice, best.outsMade);
    if (w !== null) {
      const late = lateBest(scn, w + 0.05);
      const lateLabel = josa(choiceLabel(scn, late.choice), '이', '가');
      // 늦어도 병살이 되는 곳이 여럿이면 같이 알려준다 (더 늦게까지 병살이 되는 쪽부터)
      const dps = lateDoublePlays(scn, w + 0.05).filter((o) => o.choice !== best.choice && o.choice !== 'hold');
      if (dps.length >= 2) {
        const [a, b] = dps;
        if (isCarry(scn, a.choice as BaseId) || isCarry(scn, b.choice as BaseId))
          out.push(`판단이 늦었다면 ${josa(choiceLabel(scn, a.choice as BaseId), '이나', '나')} ${josa(choiceLabel(scn, b.choice as BaseId), '으로', '로')} 병살을 노리세요.`);
        else out.push(`판단이 늦었다면 ${josa(NUM[a.choice as BaseId], '이나', '나')} ${josa(NUM[b.choice as BaseId], '으로', '로')} 던져 병살을 노리세요.`);
      } else if (late.choice !== best.choice && late.outsMade > 0)
        out.push(answers.includes(late.choice) ? `판단이 늦었다면 ${lateLabel} 더 안전해요.` : `판단이 늦었다면 ${lateLabel} 차선이에요.`);
      else if (late.choice === best.choice && late.outsMade < best.outsMade && late.outsMade > 0)
        out.push('판단이 늦어서 병살이 안 되더라도 같은 곳으로 던져 아웃 하나는 챙기세요.');
    }
  }
  return out.join(' ');
}
