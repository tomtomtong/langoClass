import assert from "node:assert/strict";
import test from "node:test";
import { normalizeStudentList } from "./classes.js";
import { developerClassList, developerLogin } from "./dev-account.js";

async function developerBearer() {
  const response = await developerLogin(
    new Request("https://class.lango.ai/api/lango/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ login: "lango-developer-alex", password: "lango123" }),
    })
  );
  const body = await response.json();
  return body.token;
}

async function classList(token) {
  return developerClassList(
    new Request("https://class.lango.ai/api/lango/classList", {
      headers: { authorization: `Bearer ${token}` },
    })
  );
}

test("dev classes carry a roster, since the dev teacher has no school_id", async () => {
  const response = await classList(await developerBearer());
  const body = await response.json();
  assert.equal(body.classList.length, 4);
  for (const item of body.classList) {
    assert.equal(item.studentList.length, item.studentCount, item.name);
    const students = normalizeStudentList(item);
    assert.equal(students.length, item.studentCount, item.name);
    assert.equal(new Set(students.map((s) => s.id)).size, students.length, item.name);
  }
  const first = body.classList.find((item) => item.name === "5A").studentList[0];
  assert.deepEqual(first, {
    id: 62001,
    studentCode: "5A-01",
    firstName: "Student",
    lastName: "01",
    fullName: "5A Student 01",
  });
});

test("dev class list is refused for other tokens", async () => {
  assert.equal(await classList("someone-else"), null);
});
