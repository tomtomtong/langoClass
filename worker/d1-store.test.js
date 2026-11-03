import assert from "node:assert/strict";
import test from "node:test";
import { requireTeacher } from "./d1-store.js";

const originalFetch = globalThis.fetch;
test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

function teacherRequest(token, teacherId) {
  return new Request("https://class.lango.ai/api/cms/dashboard/progress", {
    headers: { authorization: `Bearer ${token}`, "x-teacher-id": String(teacherId) },
  });
}

test("a teacher token the CMS accepted is not checked again right away", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response("{}", { status: 200 });
  };
  const env = { CMS_API_BASE: "https://cms.test" };
  assert.deepEqual(await requireTeacher(teacherRequest("tok-ok", 41), env), { token: "tok-ok", teacherId: 41 });
  assert.deepEqual(await requireTeacher(teacherRequest("tok-ok", 41), env), { token: "tok-ok", teacherId: 41 });
  assert.equal(calls, 1);
});

test("a rejected teacher token is checked again every time", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response("{}", { status: 401 });
  };
  const env = { CMS_API_BASE: "https://cms.test" };
  assert.equal((await requireTeacher(teacherRequest("tok-bad", 42), env)).status, 401);
  assert.equal((await requireTeacher(teacherRequest("tok-bad", 42), env)).status, 401);
  assert.equal(calls, 2);
});

test("the same token for another teacher is checked on its own", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response("{}", { status: 200 });
  };
  const env = { CMS_API_BASE: "https://cms.test" };
  await requireTeacher(teacherRequest("tok-shared", 43), env);
  await requireTeacher(teacherRequest("tok-shared", 44), env);
  assert.equal(calls, 2);
});
