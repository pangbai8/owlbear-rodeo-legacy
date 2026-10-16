import {
  FIVE_E_BASE,
  MONSTER_DRAG_TYPE,
  isMonsterDrag,
  isMonsterRef,
  matchScore,
  monsterResult,
  monsterStats,
  onOpenFiveECard,
  openMonsterCard,
  parseMonsterDrag,
  proficiencyBonus,
  searchFiveE,
} from "./fiveETools";

const ref = {
  name: "地精头目",
  englishName: "Goblin Boss",
  source: "XMM",
  url: `${FIVE_E_BASE}bestiary.html#goblin%20boss_xmm`,
};

describe("monsterStats", () => {
  test("reads size, AC, HP, CR and builds the token URL", () => {
    const stats = monsterStats(
      {
        name: "地精头目",
        ENG_name: "Goblin Boss",
        source: "XMM",
        size: ["S"],
        ac: [17],
        hp: { average: 21, formula: "6d6" },
        dex: 15,
        cr: "1",
        hasToken: true,
      },
      ref
    );
    expect(stats).toMatchObject({ size: 1, ac: 17, hp: 21, initBonus: 2, cr: "1" });
    expect(stats.tokenUrl).toBe(
      `${FIVE_E_BASE}img/bestiary/tokens/XMM/Goblin%20Boss.webp`
    );
  });

  test("large creatures, AC objects, initiative proficiency, no token", () => {
    const stats = monsterStats(
      {
        ENG_name: "Adult Red Dragon",
        source: "XMM",
        size: ["H"],
        ac: [{ ac: 19, from: ["natural armor"] }],
        hp: { average: 256 },
        dex: 10,
        cr: { cr: "17", xpLair: 20000 },
        initiative: { proficiency: 2 },
      },
      ref
    );
    expect(stats).toMatchObject({ size: 3, ac: 19, hp: 256, initBonus: 12, cr: "17" });
    expect(stats.tokenUrl).toBeNull();
  });

  test("explicit initiative, special HP and relative token URLs", () => {
    const stats = monsterStats(
      {
        ENG_name: "Swarm",
        source: "MM",
        size: "M",
        ac: [12],
        hp: { special: "varies" },
        initiative: 5,
        cr: "1/2",
        tokenUrl: "img/custom/swarm.webp",
      },
      ref
    );
    expect(stats).toMatchObject({ size: 1, hp: null, initBonus: 5 });
    expect(stats.tokenUrl).toBe(`${FIVE_E_BASE}img/custom/swarm.webp`);
  });
});

test("proficiency bonus by CR", () => {
  expect(["0", "1/2", "4", "5", "8", "9", "16", "17", "30"].map(proficiencyBonus)).toEqual([
    2, 2, 2, 3, 3, 4, 5, 6, 9,
  ]);
});

test("matchScore ranks exact > prefix > contains", () => {
  expect(matchScore("地精", "地精")).toBe(100);
  expect(matchScore("地精头目", "地精")).toBe(70);
  expect(matchScore("沙尘地精", "地精")).toBe(40);
  expect(matchScore("火球术", "地精")).toBe(0);
  expect(matchScore("Goblin Boss", "goblin")).toBe(70);
});

describe("searchFiveE", () => {
  const index = {
    x: [
      { id: 1, c: 1, u: "goblin_mm", s: 1, n: "Goblin Boss", cn: "地精头目", dR: 1 },
      { id: 2, c: 1, u: "goblin_xmm", s: 0, n: "Goblin Boss", cn: "地精头目" },
      { id: 3, c: 10, u: "goblin_race", s: 0, n: "Goblin", cn: "地精" },
      { id: 4, c: 2, u: "fireball", s: 0, n: "Fireball", cn: "火球术" },
      { id: 5, c: 30, u: "x", uh: "class_hash", s: "EFA", n: "Feature", cn: "地精特性" },
    ],
    m: { s: { XMM: 0, MM: 1 } },
  };

  beforeAll(() => {
    // A plain function: CRA resets jest.fn implementations before each test
    const files: Record<string, any> = {
      "search/index.json": index,
      "data/books.json": {
        book: [
          { id: "MM", published: "2014-09-30" },
          { id: "XMM", published: "2025-02-18" },
        ],
      },
      // Missing: search still works, only that list is not used
      "data/adventures.json": undefined,
    };
    (global as any).fetch = (url: string) => {
      const path = url.slice(FIVE_E_BASE.length);
      return Promise.resolve({
        ok: files[path] !== undefined,
        status: 404,
        json: () => Promise.resolve(files[path]),
      });
    };
  });

  test("exact names first, 2014 core books before newer ones, links per category", async () => {
    const results = await searchFiveE("地精");
    expect(results.map((r) => r.id)).toEqual([3, 1, 2, 5]);
    expect(results[1]).toMatchObject({ source: "MM", reprinted: false, modern: false });
    expect(results[2]).toMatchObject({
      name: "地精头目",
      englishName: "Goblin Boss",
      source: "XMM",
      modern: true,
      isMonster: true,
      categoryLabel: "怪物",
      url: `${FIVE_E_BASE}bestiary.html#goblin_xmm`,
    });
    expect(results[3].url).toBe(`${FIVE_E_BASE}classes.html#class_hash`);
    expect(results[3].source).toBe("EFA");
    // A better name match still wins over the 2014 boost
    expect((await searchFiveE("地精头目")).map((r) => r.id)).toEqual([1, 2]);
    expect((await searchFiveE("goblin")).map((r) => r.id)[0]).toBe(3);
  });

  test("English names match too; empty queries return nothing", async () => {
    expect((await searchFiveE("fireball")).map((r) => r.id)).toEqual([4]);
    expect(await searchFiveE("  ")).toEqual([]);
  });
});

test("monster drag data", () => {
  const data: Record<string, string> = {
    [MONSTER_DRAG_TYPE]: JSON.stringify(ref),
  };
  const transfer = {
    types: [MONSTER_DRAG_TYPE],
    getData: (type: string) => data[type] || "",
  } as unknown as DataTransfer;
  expect(isMonsterDrag(transfer)).toBe(true);
  expect(parseMonsterDrag(transfer)).toEqual(ref);
  const other = { types: ["Files"], getData: () => "" } as unknown as DataTransfer;
  expect(isMonsterDrag(other)).toBe(false);
  expect(parseMonsterDrag(other)).toBeNull();
  expect(isMonsterDrag(null)).toBe(false);
});

test("stored monsters: checked, turned back into a result, opened by event", () => {
  expect(isMonsterRef(ref)).toBe(true);
  expect(isMonsterRef({ ...ref, url: "https://example.com/x" })).toBe(false);
  expect(isMonsterRef({ name: "x" })).toBe(false);
  expect(isMonsterRef(null)).toBe(false);

  expect(monsterResult(ref)).toMatchObject({
    name: "地精头目",
    englishName: "Goblin Boss",
    source: "XMM",
    url: ref.url,
    isMonster: true,
    categoryLabel: "怪物",
  });

  const opened: unknown[] = [];
  const stop = onOpenFiveECard((r) => opened.push(r));
  openMonsterCard(ref);
  openMonsterCard({ ...ref, url: "javascript:alert(1)" });
  stop();
  openMonsterCard(ref);
  expect(opened).toEqual([monsterResult(ref)]);
});

test("5r: 2024 books first and highlighted, replaced entries dimmed", async () => {
  // The searchFiveE index above: Goblin Boss in MM (replaced, dR) and XMM
  const results = await searchFiveE("地精头目", 60, "2024");
  expect(results.map((r) => r.source)).toEqual(["XMM", "MM"]);
  expect(results[0]).toMatchObject({ accent: "#2e7d6b", reprinted: false });
  expect(results[1]).toMatchObject({ reprinted: true });
  expect(results[1].accent).toBeUndefined();
});
