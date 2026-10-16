// Clickable rolls in the 5e cards: finds attack bonuses ("攻击检定：+4"),
// dice ("1d6 + 2") and checks ("隐匿 +6") in rendered text, and rolls them.

export type Roll = { count: number; sides: number; modifier: number };

export type RollKind = "hit" | "damage" | "check";

export type TextPart =
  | string
  | {
      text: string;
      roll: Roll;
      kind: RollKind;
      /** PF2 strikes: the multiple attack penalty step (5, or 4 if agile) */
      map?: number;
    };

export type RollResult = Roll & {
  rolls: number[];
  total: number;
};

const sign = (n: number) => (n < 0 ? `−${-n}` : `+${n}`);
const toNumber = (s: string) => Number(s.replace("−", "-").replace(/\s+/g, ""));

/** "1d20+4", "2d6", "1d20−1" */
export function rollExpression({ count, sides, modifier }: Roll) {
  return `${count}d${sides}${modifier ? sign(modifier) : ""}`;
}

// An attack bonus after its label, or a dice expression not inside a word
const ROLLS =
  /(攻击(?:检定)?：|命中[：:]?)\s*([+\-−]\s*\d+)|(^|[^A-Za-z0-9])(\d*)d(\d+)(?:\s*([+\-−])\s*(\d+))?(?![A-Za-z0-9])/g;

/** Splits text into plain parts and rollable ones */
export function splitRolls(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  const push = (s: string) => s && parts.push(s);
  const re = new RegExp(ROLLS.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const index = m.index;
    if (m[2] !== undefined) {
      // Label stays text; the bonus becomes a d20 roll
      const bonusStart = index + m[0].length - m[2].length;
      push(text.slice(last, bonusStart));
      parts.push({
        text: m[2],
        roll: { count: 1, sides: 20, modifier: toNumber(m[2]) },
        kind: "hit",
      });
    } else {
      const sides = Number(m[5]);
      const count = m[4] ? Number(m[4]) : 1;
      if (sides < 2 || count < 1 || count > 100) continue;
      const start = index + m[3].length;
      push(text.slice(last, start));
      const modifier = m[6] ? toNumber(m[6] + m[7]) : 0;
      parts.push({
        text: text.slice(start, index + m[0].length),
        roll: { count, sides, modifier },
        kind: sides === 20 ? "check" : "damage",
      });
    }
    last = index + m[0].length;
  }
  push(text.slice(last));
  return parts;
}

/** "力量 +5，敏捷 +3": each bonus becomes a d20 check */
export function splitChecks(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  const re = /([+\-−]\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const index = m.index;
    if (index > last) parts.push(text.slice(last, index));
    parts.push({
      text: m[1],
      roll: { count: 1, sides: 20, modifier: toNumber(m[1]) },
      kind: "check",
    });
    last = index + m[1].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function randomInt(sides: number) {
  const cryptoObj = typeof window !== "undefined" ? window.crypto : undefined;
  if (cryptoObj?.getRandomValues) {
    // Rejection sampling keeps every face equally likely
    const limit = Math.floor(0x100000000 / sides) * sides;
    const buffer = new Uint32Array(1);
    do cryptoObj.getRandomValues(buffer);
    while (buffer[0] >= limit);
    return (buffer[0] % sides) + 1;
  }
  return Math.floor(Math.random() * sides) + 1;
}

export function rollDice(roll: Roll, random = randomInt): RollResult {
  const rolls = Array.from({ length: roll.count }, () => random(roll.sides));
  return {
    ...roll,
    rolls,
    total: rolls.reduce((sum, n) => sum + n, 0) + roll.modifier,
  };
}

/** "1d20+4 = 17（13+4）", noting a natural 20 or 1 */
export function describeRoll(result: RollResult) {
  const detail =
    (result.rolls.length > 1 ? `[${result.rolls.join("+")}]` : `${result.rolls[0]}`) +
    (result.modifier ? sign(result.modifier) : "");
  const natural =
    result.sides === 20 && result.count === 1
      ? result.rolls[0] === 20
        ? "（天然 20！）"
        : result.rolls[0] === 1
        ? "（天然 1）"
        : ""
      : "";
  return `${rollExpression(result)} = ${result.total}（${detail}）${natural}`;
}

// PF2 strikes: "斩马刀+8（触及10尺，摔绊…）" — a weapon name, its bonus,
// then its traits in brackets; spell attacks: "法术攻击 +8", "法术攻击调整值+8"
const PF2_STRIKE = /([^\s◆◇⟲，,。；;：:、（()*•]+)([+\-−]\d+)(?=\s*[（(])/g;
const PF2_SPELL_ATTACK = /(法术攻击(?:调整值)?)\s*([+\-−]\d+)/g;

/** splitRolls for PF2 text: strikes get the multiple attack penalty */
export function splitPf2Rolls(text: string): TextPart[] {
  const hits: { index: number; end: number; part: TextPart }[] = [];
  let m: RegExpExecArray | null;
  const strike = new RegExp(PF2_STRIKE.source, "g");
  while ((m = strike.exec(text))) {
    const bonusStart = m.index + m[1].length;
    // Agile weapons (灵巧) take −4/−8 instead of −5/−10
    const close = text.indexOf("）", bonusStart);
    const traits = text.slice(bonusStart, close > 0 ? close : bonusStart + 60);
    hits.push({
      index: bonusStart,
      end: bonusStart + m[2].length,
      part: {
        text: m[2],
        roll: { count: 1, sides: 20, modifier: toNumber(m[2]) },
        kind: "hit",
        map: /灵巧/.test(traits) ? 4 : 5,
      },
    });
  }
  const spell = new RegExp(PF2_SPELL_ATTACK.source, "g");
  while ((m = spell.exec(text))) {
    const bonusStart = m.index + m[0].length - m[2].length;
    hits.push({
      index: bonusStart,
      end: bonusStart + m[2].length,
      part: {
        text: m[2],
        roll: { count: 1, sides: 20, modifier: toNumber(m[2]) },
        kind: "hit",
      },
    });
  }
  hits.sort((a, b) => a.index - b.index);
  // Dice and the rest in between, as for 5e text
  const parts: TextPart[] = [];
  let last = 0;
  for (const hit of hits) {
    if (hit.index < last) continue;
    parts.push(...splitRolls(text.slice(last, hit.index)));
    parts.push(hit.part);
    last = hit.end;
  }
  parts.push(...splitRolls(text.slice(last)));
  // Trait dice ("致命d10", "双手d8") are not damage rolls: back to text
  const merged: TextPart[] = [];
  for (const part of parts) {
    const previous = merged[merged.length - 1];
    if (
      typeof part !== "string" &&
      part.kind === "damage" &&
      /^d\d/.test(part.text) &&
      typeof previous === "string" &&
      /[一-鿿]$/.test(previous)
    ) {
      merged[merged.length - 1] = previous + part.text;
    } else if (typeof part === "string" && typeof previous === "string") {
      merged[merged.length - 1] = previous + part;
    } else {
      merged.push(part);
    }
  }
  return merged;
}
