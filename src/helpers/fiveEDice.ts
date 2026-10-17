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

/** A roll for the log: "1d20+4", 17 and "（13+4）（天然 20！）" */
export type RollSummary = { expression: string; total: number; rest: string };

/** "1d20+4 = 17（13+4）", noting a natural 20 or 1 */
export function describeRoll(result: RollResult) {
  return describeSummary(summarizeRoll(result));
}

export function describeSummary({ expression, total, rest }: RollSummary) {
  return `${expression} = ${total}${rest}`;
}

export function summarizeRoll(result: RollResult): RollSummary {
  return summarizeFormula({
    dice: [{ count: result.count, sides: result.sides, sign: 1 }],
    modifier: result.modifier,
    rolls: [result.rolls],
    total: result.total,
  });
}

/** A typed formula: dice terms and a flat modifier ("2d6+1d8+3") */
export type Formula = {
  dice: { count: number; sides: number; sign: 1 | -1 }[];
  modifier: number;
};

export type FormulaResult = Formula & { rolls: number[][]; total: number };

/**
 * Reads "1d20+7", "8d6", "2d6 + 1d8 − 1", "d20"; a bare bonus ("+7")
 * is a d20 roll. Null when it is not a roll.
 */
export function parseFormula(text: string): Formula | null {
  let rest = text
    .replace(/[＋]/g, "+")
    .replace(/[−－–]/g, "-")
    .replace(/[Ｄ]/g, "d")
    .replace(/\s+/g, "")
    .toLowerCase();
  if (/^[+-]\d+$/.test(rest)) rest = "1d20" + rest;
  if (!rest) return null;
  const formula: Formula = { dice: [], modifier: 0 };
  let first = true;
  while (rest) {
    const m = rest.match(first ? /^([+-]?)(?:(\d*)d(\d+)|(\d+))/ : /^([+-])(?:(\d*)d(\d+)|(\d+))/);
    if (!m) return null;
    const sign = m[1] === "-" ? -1 : 1;
    if (m[3] !== undefined) {
      const count = m[2] ? Number(m[2]) : 1;
      const sides = Number(m[3]);
      if (count < 1 || count > 100 || sides < 2 || sides > 1000) return null;
      formula.dice.push({ count, sides, sign });
    } else {
      formula.modifier += sign * Number(m[4]);
    }
    rest = rest.slice(m[0].length);
    first = false;
  }
  return formula.dice.length ? formula : null;
}

/** "2d6+1d8+3" */
export function formulaExpression({ dice, modifier }: Formula) {
  const terms = dice.map(
    ({ count, sides, sign: s }, i) => (s < 0 ? "−" : i > 0 ? "+" : "") + `${count}d${sides}`
  );
  return terms.join("") + (modifier ? sign(modifier) : "");
}

export function rollFormula(formula: Formula, random = randomInt): FormulaResult {
  const rolls = formula.dice.map(({ count, sides }) =>
    Array.from({ length: count }, () => random(sides))
  );
  const total =
    formula.dice.reduce(
      (sum, { sign: s }, i) => sum + s * rolls[i].reduce((a, b) => a + b, 0),
      0
    ) + formula.modifier;
  return { ...formula, rolls, total };
}

export function summarizeFormula(result: FormulaResult): RollSummary {
  const detail =
    result.rolls
      .map((rolls, i) => {
        const term = rolls.length > 1 ? `[${rolls.join("+")}]` : `${rolls[0]}`;
        return result.dice[i].sign < 0 ? `−${term}` : i > 0 ? `+${term}` : term;
      })
      .join("") + (result.modifier ? sign(result.modifier) : "");
  const only = result.dice.length === 1 ? result.dice[0] : null;
  const natural =
    only && only.sides === 20 && only.count === 1 && only.sign > 0
      ? result.rolls[0][0] === 20
        ? "（天然 20！）"
        : result.rolls[0][0] === 1
        ? "（天然 1）"
        : ""
      : "";
  return { expression: formulaExpression(result), total: result.total, rest: `（${detail}）${natural}` };
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
