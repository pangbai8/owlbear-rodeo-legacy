// Conditions for tokens and the party panel, 5e or PF2. A condition is
// stored as a string: "倒地", or with its value, "惊惧 1" / "力竭 2".
// The party panel (public/party-panel/index.html) keeps the same lists,
// CONDS (5e) and PF2_CONDS: change both together.

/** [name, has a value, short rules summary, highest value] */
export type ConditionTable = [string, boolean, string, number?][];

/** 5e (the party panel's built-in library, plus exhaustion levels) */
export const DND5E_CONDITIONS: ConditionTable = [
  ["目盲", false, "看不见；攻击检定劣势，攻击你的检定有优势"],
  ["魅惑", false, "不能攻击魅惑者；对方社交检定对你有优势"],
  ["耳聋", false, "听不见；依赖听觉的检定自动失败"],
  ["恐慌", false, "看得见恐惧源时，攻击与属性检定劣势，不能主动靠近"],
  ["受擒", false, "速度为 0"],
  ["失能", false, "不能执行动作、附赠动作或反应"],
  ["隐形", false, "攻击检定有优势，攻击你的检定劣势"],
  ["麻痹", false, "失能且不能移动；力量敏捷豁免自动失败，5 尺内命中即重击"],
  ["石化", false, "化为石像，失能；对大多数伤害有抗性"],
  ["中毒", false, "攻击检定与属性检定劣势"],
  ["倒地", false, "只能爬行；攻击劣势；5 尺内攻击你有优势，远程攻击劣势"],
  ["束缚", false, "速度为 0；攻击劣势，攻击你有优势，敏捷豁免劣势"],
  ["震慑", false, "失能；力量敏捷豁免自动失败，攻击你有优势"],
  ["昏迷", false, "失能并倒地；力量敏捷豁免失败，5 尺内命中即重击"],
  ["力竭", true, "每级：d20 检定 −2，速度 −5 尺；6 级死亡", 6],
];

/** 4e (the 4e wiki's 状态表, plus ongoing damage); most used first */
export const DND4E_CONDITIONS: ConditionTable = [
  ["被标记", false, "攻击不包括标记者的目标时攻击骰 −2"],
  ["晕眩", false, "每回合只能进行一个标准、移动或次要动作；不能即时或借机动作；提供战斗优势"],
  ["定身", false, "无法移动，除非传送或被拉近、推离、滑动"],
  ["迟缓", false, "速度变为 2，不能从速度加值获益"],
  ["倒地", false, "攻击骰 −2；近战攻击者获得战斗优势，不邻近的远程攻击对你 +2 防御"],
  ["虚弱", false, "攻击只造成一半伤害（持续伤害等除外）"],
  ["震慑", false, "无法进行动作；提供战斗优势；无法夹击"],
  ["目盲", false, "看不见，目标对你全隐蔽；侦查 −10；提供战斗优势"],
  ["束缚", false, "无法移动（传送除外）；攻击骰 −2；提供战斗优势"],
  ["被擒拿", false, "定身；擒拿者受阻或你离开范围时结束"],
  ["被支配", false, "由支配者每回合替你选择一个动作；提供战斗优势"],
  ["持续伤害", true, "回合开始时受到等同数值的伤害（豁免终止）"],
  ["耳聋", false, "听不到声音；侦查 −10"],
  ["无助", false, "提供战斗优势；可被致命一击"],
  ["失去意识", false, "无助、无法进行动作；所有防御 −5；可能倒地"],
  ["濒死", false, "失去意识；必须进行死亡豁免"],
  ["石化", false, "失去意识；20 点全伤害抗力；不会衰老"],
  ["被突袭", false, "无法进行动作；提供战斗优势；无法夹击"],
  ["移除游戏", false, "无法进行动作，与其他东西互无视线和效果线"],
];

/** PF2 (names follow the Chinese PF2 wiki); most used first */
export const PF2_CONDITIONS: ConditionTable = [
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

const entry = (table: ConditionTable, name: string) =>
  table.find((c) => c[0] === name);

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
export function setCondition(
  conditions: string[],
  name: string,
  value: number | null,
  table: ConditionTable = PF2_CONDITIONS
) {
  const valued = entry(table, name)?.[1];
  const remove = value === null || (valued && value <= 0);
  const text = valued ? `${name} ${value}` : name;
  // A changed value keeps its place, so the list does not jump around
  const index = conditions.findIndex((t) => parseCondition(t).name === name);
  if (index < 0) return remove ? conditions : [...conditions, text];
  const next = [...conditions];
  if (remove) next.splice(index, 1);
  else next[index] = text;
  return next;
}

/** The highest value a condition takes (力竭 6 in 5e, else 9) */
export function conditionMax(name: string, table: ConditionTable = PF2_CONDITIONS) {
  return entry(table, name)?.[3] ?? 9;
}

export function conditionSummary(text: string, table: ConditionTable = PF2_CONDITIONS) {
  return entry(table, parseCondition(text).name)?.[2] || "";
}

/** "惊惧1 · 倒地 · 恶心2 +1" for the badge under a token */
export function conditionBadge(conditions: string[], max = 3) {
  const short = conditions.map((text) => text.replace(/\s+(\d+)$/, "$1"));
  const shown = short.slice(0, max).join(" · ");
  return short.length > max ? `${shown} +${short.length - max}` : shown;
}
