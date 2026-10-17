import {
  PartyOpError,
  applyOp,
  emptySnapshot,
  newestSnapshot,
  receiveChange,
  validDocPath,
} from "./partyData";

test("document paths: collection/doc pairs", () => {
  expect(validDocPath("teams/t1")).toBe(true);
  expect(validDocPath("teams/t1/members/c1")).toBe(true);
  expect(validDocPath("teams")).toBe(false);
  expect(validDocPath("teams/t1/members")).toBe(false);
  expect(validDocPath("teams/../x")).toBe(false);
  expect(validDocPath(42)).toBe(false);
});

test("the host numbers each change and sends it out", () => {
  let s = emptySnapshot();
  const a = applyOp(s, { op: "set", path: "teams/t1", data: { name: "A" } }, 100);
  expect(a.change).toEqual({ kind: "doc", version: 1, path: "teams/t1", data: { name: "A" } });
  s = a.snapshot;
  expect(s).toMatchObject({ version: 1, updated: 100, docs: { "teams/t1": { name: "A" } } });
  const d = applyOp(s, { op: "delete", path: "teams/t1" }, 200);
  expect(d.change).toEqual({ kind: "doc", version: 2, path: "teams/t1", data: null });
  expect(d.snapshot.docs).toEqual({});
  const c = applyOp(a.snapshot, { op: "clear" }, 300);
  expect(c.change).toEqual({ kind: "reset", version: 2 });
  expect(() => applyOp(s, { op: "set", path: "bad", data: {} })).toThrow(PartyOpError);
  expect(() => applyOp(s, { op: "set", path: "teams/t2", data: [] as any })).toThrow(PartyOpError);
});

test("copies follow the host's changes and notice a missed one", () => {
  const host = applyOp(emptySnapshot(), { op: "set", path: "teams/t1", data: { n: 1 } });
  const second = applyOp(host.snapshot, { op: "set", path: "teams/t1", data: { n: 2 } });
  const copy = receiveChange(emptySnapshot(), host.change)!;
  expect(copy.docs["teams/t1"]).toEqual({ n: 1 });
  // An old change again: no effect
  expect(receiveChange(copy, host.change)).toBe(copy);
  // Missed the first: behind, ask for everything
  expect(receiveChange(emptySnapshot(), second.change)).toBeNull();
  expect(receiveChange(copy, second.change)!.docs["teams/t1"]).toEqual({ n: 2 });
});

test("a new host carries on from the newest copy", () => {
  const a = { docs: { "teams/a": {} }, version: 5, updated: 10 };
  const b = { docs: { "teams/b": {} }, version: 7, updated: 5 };
  const c = { docs: { "teams/c": {} }, version: 7, updated: 9 };
  expect(newestSnapshot([a, b, c])).toBe(c);
  expect(newestSnapshot([]).version).toBe(0);
});
