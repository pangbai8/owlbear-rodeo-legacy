// PF2 conditions for tokens and the party panel (public/party-panel/index.html
// keeps the same list, PF2_CONDS: change both together). Names follow the
// Chinese PF2 wiki. A condition is stored as a string: "倒地", or with its
// value, "惊惧 1".

/** [name, has a value, short rules summary]; most used first */
export const PF2_CONDITIONS: [string, boolean, string][] = [
  ["惊惧", true, "所有检定和 DC 受等同数值的状态减值；每回合结束时减 1"],
  ["恶心", true, "所有检定和 DC 受状态减值；可花 1 动作进行强韧豁免来降低"],
  ["缓慢", true, "回合开始时少获得等同数值的动作"],
  ["震慑", true, "不能行动；之后的回合失去等同数值的动作"],
  ["倒地", false, "措手不及，攻击检定 −2；只能爬行或起身"],
  ["措手不及", false, "AC −2（环境减值）"],
  ["受擒", false, "措手不及且禁足；操作动作需 DC 5 纯骰检定"],
  ["束缚", false, "措手不及且禁足；只能尝试逃脱或强行挣脱"],
  ["禁足", false, "不能用移动动作离开当前位置"],
  ["隐蔽", false, "以你为目标需通过 DC 5 纯骰检定"],
  ["藏匿", false, "对方知道你的方位但看不到你；以你为目标需 DC 11 纯骰检定"],
  ["隐形", false, "所有生物都看不见你"],
  ["目盲", false, "看不见；视觉相关检定自动失败，察觉检定 −4"],
  ["目眩", false, "所有生物和物体对你都处于隐蔽"],
  ["耳聋", false, "听不见；听觉相关检定自动失败，察觉检定 −2"],
  ["麻痹", false, "措手不及；不能行动，只能回忆知识等纯心智动作"],
  ["困惑", false, "措手不及；随机攻击，不能延迟、准备或做反应"],
  ["被控制", false, "由控制者决定你的行动"],
  ["迷魂", false, "察觉和技能检定 −2；不能使用专注动作（除非与迷魂源有关）"],
  ["逃跑", false, "必须尽力远离来源移动"],
  ["疲乏", false, "AC 和豁免 −1；探索时不能进行探索活动"],
  ["失去意识", false, "倒地、目盲且措手不及；AC、察觉和反射 −4"],
  ["濒死", true, "失去意识；每回合开始进行复苏检定，达到 4（减毁灭值）时死亡"],
  ["受伤", true, "再次进入濒死时，濒死值额外增加受伤值"],
  ["毁灭", true, "濒死致死的数值降低等同数值"],
  ["笨拙", true, "敏捷类检定和 DC（含 AC、反射）受状态减值"],
  ["力竭", true, "力量类检定和 DC（含近战攻击与伤害）受状态减值"],
  ["呆滞", true, "智力、感知、魅力类检定和 DC 受减值；施法需纯骰检定"],
  ["流失", true, "体质类检定和 DC 受减值；生命值上限减少 等级×数值"],
  ["持续伤害", false, "回合结束时受到伤害，然后进行 DC 15 纯骰检定来结束"],
  ["迅捷", false, "回合开始时额外获得 1 个受限动作"],
  ["超载", false, "笨拙 1，速度 −10 尺"],
  ["石化", false, "化为石像，不能行动"],
  ["无踪", false, "对方不知道你的位置"],
];

const BY_NAME = new Map(PF2_CONDITIONS.map((c) => [c[0], c]));

/** "惊惧 2" -> { name: "惊惧", value: 2 }; "倒地" -> { name, value: null } */
export function parseCondition(text: string) {
  const m = String(text).trim().match(/^(.*?)\s*(\d+)$/);
  return m ? { name: m[1], value: Number(m[2]) } : { name: String(text).trim(), value: null };
}

export function conditionValue(conditions: string[], name: string) {
  for (const text of conditions) {
    const c = parseCondition(text);
    if (c.name === name) return c.value ?? 0;
  }
  return null;
}

/** Sets a condition: null (or 0 for a valued one) removes it */
export function setCondition(conditions: string[], name: string, value: number | null) {
  const rest = conditions.filter((text) => parseCondition(text).name !== name);
  const valued = BY_NAME.get(name)?.[1];
  if (value === null || (valued && value <= 0)) return rest;
  return [...rest, valued ? `${name} ${value}` : name];
}

export function conditionSummary(text: string) {
  return BY_NAME.get(parseCondition(text).name)?.[2] || "";
}

/** "惊惧1 · 倒地 · 恶心2 +1" for the badge under a token */
export function conditionBadge(conditions: string[], max = 3) {
  const short = conditions.map((text) => text.replace(/\s+(\d+)$/, "$1"));
  const shown = short.slice(0, max).join(" · ");
  return short.length > max ? `${shown} +${short.length - max}` : shown;
}
