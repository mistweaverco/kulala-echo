import { expect, test } from "bun:test";
import { parseEchoRequestBody } from "./utils";

test("parseEchoRequestBody parses JSON without Content-Type", () => {
  const body = '{"foo":"bar"}';
  expect(parseEchoRequestBody("", body)).toEqual({
    data: body,
    json: { foo: "bar" },
    form: {},
    files: {},
  });
});

test("parseEchoRequestBody keeps plain text without Content-Type", () => {
  expect(parseEchoRequestBody("", "hello")).toEqual({
    data: "hello",
    json: null,
    form: {},
    files: {},
  });
});

test("parseEchoRequestBody handles application/json", () => {
  const body = '{"a":1}';
  expect(parseEchoRequestBody("application/json", body)).toEqual({
    data: body,
    json: { a: 1 },
    form: {},
    files: {},
  });
});

test("parseEchoRequestBody handles form-urlencoded", () => {
  expect(parseEchoRequestBody("application/x-www-form-urlencoded", "a=1&b=2")).toEqual({
    data: "a=1&b=2",
    json: null,
    form: { a: "1", b: "2" },
    files: {},
  });
});
