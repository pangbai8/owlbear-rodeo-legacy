import { parseShimoUrl } from "./shimo";

test("accepts shimo doc links", () => {
  expect(parseShimoUrl(" https://shimo.im/docs/abc123 ")).toBe(
    "https://shimo.im/docs/abc123",
  );
  expect(parseShimoUrl("shimo.im/sheets/xyz")).toBe(
    "https://shimo.im/sheets/xyz",
  );
  expect(parseShimoUrl("https://team.shimo.im/docs/abc")).toBe(
    "https://team.shimo.im/docs/abc",
  );
});

test("rejects other sites and schemes", () => {
  expect(parseShimoUrl("")).toBeNull();
  expect(parseShimoUrl("https://evilshimo.im/docs/abc")).toBeNull();
  expect(parseShimoUrl("https://shimo.im.evil.com/")).toBeNull();
  expect(parseShimoUrl("http://shimo.im/docs/abc")).toBeNull();
  expect(parseShimoUrl("javascript:alert(1)")).toBeNull();
});
