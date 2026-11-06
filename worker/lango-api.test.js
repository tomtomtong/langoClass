import assert from "node:assert/strict";
import test from "node:test";
import { handleStoreApi } from "./d1-api.js";
import { api, developerToken, memoryD1, putDoc } from "./test-env.js";

const env = () => ({ DB: memoryD1(), ORIGIN: "", CMS_API_BASE: "https://cms.test" });

// Stands in for newcms; records each call and answers from routes.
async function withCms(routes, run) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    calls.push({ url: target, method: init.method || "GET", headers: init.headers || {}, body: init.body });
    for (const [prefix, respond] of Object.entries(routes)) {
      if (target.startsWith(prefix)) return respond(init);
    }
    throw new Error(`Unexpected fetch ${target}`);
  };
  try {
    return await run(calls);
  } finally {
    globalThis.fetch = real;
  }
}

function post(path, body) {
  const url = new URL(path, "https://class.lango.ai");
  return [new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), url];
}

test("school teachers log in through newcms", async () => {
  await withCms(
    {
      "https://cms.test/api/login": () =>
        Response.json({ token: "school-token", user: { id: 77, username: "ms.chan", schoolId: 12 } }),
    },
    async (calls) => {
      const store = env();
      const [request, url] = post("/api/lango/login", { username: "ms.chan", password: "pw" });
      const response = await handleStoreApi(request, store, url);
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.deepEqual(body, {
        ok: true,
        token: "school-token",
        user: { id: 77, username: "ms.chan", schoolId: 12, token: "school-token", school_id: 12 },
      });
      assert.equal(calls.length, 1);
      assert.equal(calls[0].method, "POST");
      assert.deepEqual(JSON.parse(calls[0].body), { login: "ms.chan", password: "pw" });
    }
  );
});

test("a rejected school login keeps the newcms status and message", async () => {
  await withCms(
    { "https://cms.test/api/login": () => Response.json({ error: "Invalid credentials" }, { status: 401 }) },
    async () => {
      const [request, url] = post("/api/lango/login", { login: "ms.chan", password: "wrong" });
      const response = await handleStoreApi(request, env(), url);
      assert.equal(response.status, 401);
      assert.equal((await response.json()).message, "Invalid credentials");
    }
  );
});

test("login without a password is refused before calling newcms", async () => {
  await withCms({}, async (calls) => {
    const [request, url] = post("/api/lango/login", { login: "ms.chan" });
    const response = await handleStoreApi(request, env(), url);
    assert.equal(response.status, 400);
    assert.equal(calls.length, 0);
  });
});

test("the dev account still logs in without newcms", async () => {
  await withCms({}, async (calls) => {
    const token = await developerToken(handleStoreApi, env());
    assert.match(token, /^dev\./);
    assert.equal(calls.length, 0);
  });
});

test("school class lists come from newcms in the host page's shape", async () => {
  await withCms(
    {
      "https://cms.test/api/teachers/77/classes": () =>
        Response.json({ teacher: { id: 77 }, classes: [{ class_id: "301", class_name: "P5 Rose", student_count: "28" }] }),
    },
    async (calls) => {
      const call = api(handleStoreApi, env(), "school-token");
      const response = await call("/api/lango/classList", { headers: { "x-teacher-id": "77" } });
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.deepEqual(body.classList, [
        { id: 301, name: "P5 Rose", studentCount: 28, studentList: [], englishLevel: "P5", level: "P5", grade: null },
      ]);
      assert.deepEqual(body.teacher, { id: 77 });
      assert.equal(calls[0].headers.Authorization, "Bearer school-token");
    }
  );
});

test("class students come from newcms, sorted by class number", async () => {
  await withCms(
    {
      "https://cms.test/api/schools/12/classes/301/students": () =>
        Response.json({ total: 1, students: [{ id: "5", student_id: "S005", first_name: "Mei", last_name: "Wong" }] }),
    },
    async (calls) => {
      const call = api(handleStoreApi, env(), "school-token");
      const response = await call("/api/lango/classStudents?schoolId=12&classId=301");
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.deepEqual(body, {
        ok: true,
        schoolId: "12",
        classId: "301",
        total: 1,
        students: [{ id: 5, studentCode: "S005", username: null, firstName: "Mei", lastName: "Wong", fullName: "Mei Wong" }],
      });
      assert.match(calls[0].url, /\?sort=class_no&order=asc$/);
    }
  );
});

test("app context reports the Worker's speech provider", async () => {
  const url = new URL("https://class.lango.ai/api/cms/app-context");
  const body = await (await handleStoreApi(new Request(url), { ...env(), INWORLD_API_KEY: "k" }, url)).json();
  assert.equal(body.ttsProvider, "inworld");
  assert.equal(body.ttsAvailable, true);
});

test("app context lists the classroom languages without a login", async () => {
  const url = new URL("https://class.lango.ai/api/cms/app-context");
  const response = await handleStoreApi(new Request(url), env(), url);
  const body = await response.json();
  assert.equal(body.appVariant, "");
  assert.deepEqual(body.speakLanguages.map((entry) => entry.code), ["en", "yue", "zh"]);
  assert.deepEqual(body.questionLanguages.map((entry) => entry.code), ["en", "yue", "zh"]);
  assert.equal(body.defaultSpeakLangCode, "en");
  assert.equal(body.ttsProvider, "inworld");
  assert.equal(body.ttsAvailable, true);
  assert.ok(body.questionLanguages.some((entry) => entry.code === "yue"));
});

test("dashboard progress shows started courses first with their completion", async () => {
  const store = env();
  const token = await developerToken(handleStoreApi, store);
  const exercise = (id, order, title) => ({ id, order, title });
  await putDoc(store, "teacher-courses", {
    courses: [
      { id: -1, teacherId: 835, name: "Animals", classIds: [62], sections: [{ id: "s1", order: 0, title: "Farm", exercises: [exercise(1, 0, "Cow"), exercise(2, 1, "Pig")] }], updatedAt: "2026-10-01T00:00:00Z" },
      { id: -2, teacherId: 835, name: "Colours", classIds: [62], sections: [{ id: "s2", order: 0, title: "Red", exercises: [exercise(3, 0, "Apple")] }], updatedAt: "2026-10-02T00:00:00Z" },
      { id: -3, teacherId: 835, name: "Other class", classIds: [579], sections: [] },
    ],
  });
  await putDoc(store, "host-progress", {
    records: [{ teacherId: 835, classId: 62, courseId: -1, completedExerciseIds: [1], visitedSectionIds: ["s1"], lastSectionId: "s1", lastExerciseId: 1, updatedAt: "2026-10-05T00:00:00Z" }],
  });
  await putDoc(store, "student-scores", {
    students: {},
    records: [
      { recordKey: "a", teacherId: 835, classId: 62, courseId: -1, exerciseId: 1, exerciseTitle: "Cow", studentUserId: "62001", score: 80 },
      { recordKey: "b", teacherId: 835, classId: 62, courseId: -1, exerciseId: 2, exerciseTitle: "Pig", studentUserId: "62001", score: 40 },
    ],
  });

  const response = await api(handleStoreApi, store, token)("/api/cms/dashboard/progress?classId=62");
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.classId, 62);
  assert.deepEqual(
    body.courses.map((course) => [course.name, course.status, course.completedCount, course.totalExercises, course.percent]),
    [
      ["Animals", "in_progress", 1, 2, 50],
      ["Colours", "not_started", 0, 1, 0],
    ]
  );
  assert.equal(body.courses[0].lastSectionTitle, "Farm");
  assert.equal(body.courses[0].lastExerciseTitle, "Cow");
  assert.equal(body.courses[0].engagementScore, 60);
  assert.equal(body.courses[0].topStruggle, "Pig");
  assert.equal(body.courses[1].engagementScore, null);
});

test("dashboard progress for several classes matches asking for each one", async () => {
  const store = env();
  const token = await developerToken(handleStoreApi, store);
  await putDoc(store, "teacher-courses", {
    courses: [
      { id: -1, teacherId: 835, name: "Animals", classIds: [62, 579], sections: [{ id: "s1", order: 0, title: "Farm", exercises: [{ id: 1, order: 0, title: "Cow" }] }] },
      { id: -2, teacherId: 835, name: "Only 579", classIds: [579], sections: [] },
      { id: -3, teacherId: 999, name: "Someone else", classIds: [62], sections: [] },
    ],
  });
  await putDoc(store, "host-progress", {
    records: [{ teacherId: 835, classId: 579, courseId: -1, completedExerciseIds: [1], visitedSectionIds: ["s1"], lastSectionId: "s1", lastExerciseId: 1 }],
  });
  const call = api(handleStoreApi, store, token);
  const many = await (await call("/api/cms/dashboard/progress?classIds=62,579,0,62")).json();
  assert.deepEqual(many.classes.map((entry) => entry.classId), [62, 579]);
  for (const entry of many.classes) {
    const single = await (await call(`/api/cms/dashboard/progress?classId=${entry.classId}`)).json();
    // A course nobody has started is stamped with the time of the request.
    const stable = (courses) => courses.map(({ updatedAt: _updatedAt, ...rest }) => rest);
    assert.deepEqual(stable(entry.courses), stable(single.courses));
  }
  assert.deepEqual(many.classes[0].courses.map((course) => course.name), ["Animals"]);
  assert.equal(many.classes[1].courses[0].status, "completed");
  assert.equal((await call("/api/cms/dashboard/progress?classIds=0,")).status, 400);
});

test("dashboard progress needs a class id", async () => {
  const store = env();
  const token = await developerToken(handleStoreApi, store);
  const response = await api(handleStoreApi, store, token)("/api/cms/dashboard/progress");
  assert.equal(response.status, 400);
});

test("admin portal login lets a newcms admin in", async () => {
  await withCms(
    { "https://cms.test/api/login": () => Response.json({ token: "t", user: { id: 1, username: "head", role: "admin", schoolId: 3 } }) },
    async () => {
      const [request, url] = post("/api/lango/admin/login", { username: "head", password: "pw" });
      const response = await handleStoreApi(request, env(), url);
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(body.token, "t");
      assert.equal(body.user.school_id, 3);
    }
  );
});

test("admin portal login refuses a teacher and returns no token", async () => {
  await withCms(
    { "https://cms.test/api/login": () => Response.json({ token: "t", user: { id: 2, role: "teacher" } }) },
    async () => {
      const [request, url] = post("/api/lango/admin/login", { username: "ms.chan", password: "pw" });
      const response = await handleStoreApi(request, env(), url);
      const body = await response.json();
      assert.equal(response.status, 403);
      assert.equal(body.token, undefined);
    }
  );
});

test("admin session check needs a token and the admin role", async () => {
  await withCms(
    { "https://cms.test/api/me": (init) => Response.json({ user: { id: 2, role: String(init.headers.Authorization).includes("boss") ? "admin" : "teacher" } }) },
    async () => {
      const url = new URL("/api/lango/admin/me", "https://class.lango.ai");
      const bare = await handleStoreApi(new Request(url), env(), url);
      assert.equal(bare.status, 401);
      const teacher = await handleStoreApi(new Request(url, { headers: { authorization: "Bearer tch" } }), env(), url);
      assert.equal(teacher.status, 403);
      const admin = await handleStoreApi(new Request(url, { headers: { authorization: "Bearer boss" } }), env(), url);
      assert.equal(admin.status, 200);
    }
  );
});

test("admin directory refuses teachers and returns only whitelisted fields to admins", async () => {
  await withCms(
    {
      "https://cms.test/api/me": (init) => Response.json({ user: { id: 2, role: String(init.headers.Authorization).includes("boss") ? "admin" : "teacher" } }),
      "https://cms.test/api/schools/1001/teachers": () =>
        Response.json({ teachers: [{ id: 9, username: "ms.chan", email: "a@b.c", teacher_id: "T1", class_ids: ["1A"], password: "secret", password_hash: "x" }] }),
      "https://cms.test/api/schools/1001/classes": () => Response.json({ classes: [{ class_id: "1A", student_count: 25 }] }),
      "https://cms.test/api/schools": () => Response.json({ schools: [{ id: "1001", name: "Test School" }] }),
    },
    async () => {
      const url = new URL("/api/lango/admin/directory", "https://class.lango.ai");
      const bare = await handleStoreApi(new Request(url), env(), url);
      assert.equal(bare.status, 401);
      const teacher = await handleStoreApi(new Request(url, { headers: { authorization: "Bearer tch" } }), env(), url);
      assert.equal(teacher.status, 403);
      const admin = await handleStoreApi(new Request(url, { headers: { authorization: "Bearer boss" } }), env(), url);
      assert.equal(admin.status, 200);
      const text = await admin.text();
      assert.ok(!text.includes("secret"));
      const body = JSON.parse(text);
      assert.equal(body.schools[0].teachers[0].username, "ms.chan");
      assert.equal(body.schools[0].studentCount, 25);
    }
  );
});

test("an admin token can read a teacher's courses but not change them", async () => {
  await withCms(
    {
      "https://cms.test/api/teachers/": () => Response.json({ ok: true }),
      "https://cms.test/api/me": (init) => Response.json({ user: { id: 1, role: String(init.headers.Authorization).includes("boss") ? "admin" : "teacher" } }),
    },
    async () => {
      const store = env();
      const call = (token, method) => {
        const url = new URL("/api/cms/courses", "https://class.lango.ai");
        const body = method === "POST" ? JSON.stringify({ name: "X" }) : undefined;
        return handleStoreApi(new Request(url, { method, body, headers: { authorization: `Bearer ${token}`, "x-teacher-id": "55", "content-type": "application/json" } }), store, url);
      };
      assert.equal((await call("boss", "GET")).status, 200);
      const blocked = await call("boss", "POST");
      assert.equal(blocked.status, 403);
      assert.match((await blocked.json()).message, /View only/);
      assert.notEqual((await call("tch", "POST")).status, 403);
    }
  );
});
