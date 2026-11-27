# Autoclass：好多個地方一齊問 Uncle Tommy（完整 plan，第 3 版）

狀態：**已實作（分支 `autoclass-group-tutor`），未 commit，未 deploy。**

實作同本文嘅差別（以實作為準）：

- 答案聲音放 R2 `uploads/autoclass/_tutor/<code>/<uuid>.mp3`，由現有 `/uploads/autoclass/...` 路由（`serveUpload`，支援 Range）讀取，**冇新增讀取路由**。
- `inflight` 超時係 **3 分鐘**（要容得下排隊 2 分鐘 + 整答案），唔係 90 秒。
- 群組內答案以「`<roomId>:<askId>`」識別（每個 room 都用 `ask-1`、`ask-2`…，唔加 room 會撞）；host 頁攞到嘅 `askId` 就係呢個格式。
- 50 個地方嘅驗證用**進程內測試**（`worker/group-flow.test.js`，真嘅 `RoomDurableObject` + `GroupDurableObject`，假儲存同假模型），冇做外部 `scripts/group-load-test.mjs`。
- `groupRate`、`watchMax` 只喺新 render 嘅 cues 入面出現；舊 cues 冇呢兩個值，host 頁用預設（10、3），所以唔使重新 render。

版本：

- 第 1 版：3 個地方，「每個地方保證 1 條」。
- 第 2 版：好多個地方，「收集 → 抽籤」，全 group 只答 Max 條，所有地方睇同一條。
- **第 3 版（今次）**：**每個地方嘅問題都答**；有問題嘅地方睇自己嘅答案，冇問題嘅地方**隨機睇其他地方嘅答案**。取消抽籤同全 group Max。

---

## 1. 玩法

例子：

| 地方 | 學生 | 有冇問問題 | 睇乜 |
| --- | --- | --- | --- |
| 地方 1 | A | 有 | 睇**自己**（A 嘅答案）|
| 地方 2 | B | 有 | 睇**自己**（B 嘅答案）|
| 地方 3 | C、D、E、F | 冇 | 隨機睇**其他地方**（A 或 B 嘅答案）|

規則：

1. **每個地方嘅問題都會被答**，冇人「冇中」。
2. 地方有自己嘅答案等緊，就睇自己嘅，唔會插入其他地方嘅。
3. 冇自己嘅答案，就喺停頓位睇**一條**其他地方嘅答案，隨機揀，睇過嘅唔會再睇。冇答案就唔播。
4. 同一個地方好多人問（例如 C、D、E、F 全部都問）：**先問先答，一次一條，其餘排後面**。
5. 卡片同依家一樣，只講學生名（`{名} asks`），**唔講地方名**。
6. 唔連 group 嘅 room 完全照舊。

設計目標：**100 個 room**，驗證目標 **50 個**。

---

## 2. 名詞

| 詞 | 意思 |
| --- | --- |
| room | 一個地方嘅一堂課，一個 `RoomDurableObject` |
| group | 好多個 room 連埋一齊，用同一個 group code |
| group code | 4 位數字，host 輸入（或網址 `?group=1234`）|
| 自己嘅答案 | 呢個 room 嘅學生問嘅問題嘅答案 |
| 其他地方嘅答案 | 別個 room 嘅答案，呢個 room 用「攞」嘅方式攞（`pick`）|
| `watchMax` | 一個 room 最多睇幾多條其他地方嘅答案（預設 3）|
| `groupRate` | 全 group 每分鐘最多開幾多條答案（預設 10），控制成本 |

---

## 3. 依家點做（要保留嘅部分）

### Server（`worker/`）

- 每個 room 係獨立 Durable Object（`room.js`，binding `ROOM`）。Room 之間冇連結。
- `room-tutor.js`：
  - `set_tutor`（host）開關 + 設定 lesson 資料。**注意**：每次 call 都會重置 `asked`（90 秒間隔）同 `total`。
  - `ask_question`（學生）→ `tutorAskCheck` → 錄音轉文字 → `askQuestion` 即刻開 job `tutor-answer`。
  - `room.js` 嘅 `#tutorAnswer`：模型寫答案（最多 40 字）→ `speakAsTommy` 讀答案同問題。
  - 結果：`tutor_answer`（只發 host）、`tutor_declined`（host）、`ask_status`（發發問嘅學生）。
- 聲音放喺 room 自己嘅 SQLite `audio` 表，host socket 收嗰陣由 `#forSocket` 換返 base64。
- 限制：每個學生 90 秒一條、每個 room 全堂 12 條。

### Host 頁（`public/autoclass.js`）

- `state.hands`、`state.answers`（自己嘅答案等位播）、`state.answered`、`state.usedBreaks`。
- `syncAsking()`：`answered + hands < tutor.maxAnswers`（預設 3）就開手按鈕，否則收埋。**連 group 之後呢個邏輯保留**，即每個地方自己最多 `maxAnswers` 條問題。
- 播放時機：`tutor.breaks` 停頓位、問題前、結果頁收埋時（`takeBreak()` / `answerWaiting()`）。
- `runTutor()`：一次一條。卡片展開 → lead-in → 讀問題 → 讀答案 → lead-out → 收返。最長 75 秒，可以 Skip。
- 學生手機：`public/join-tutor.js`。

### 可重用嘅做法

- 共用語音上 R2、用 GET 路由讀：`worker/question-tts.js`。
- Room 之間用 Durable Object RPC：`roomSummary` 已經用 `env.ROOM.getByName(id).read()`。

---

## 4. 決定

| # | 決定 | 狀態 |
| --- | --- | --- |
| 1 | 每個地方嘅問題都答；**取消抽籤、取消全 group Max** | 已定 |
| 2 | 有自己嘅答案就睇自己；冇就睇其他地方一條隨機答案 | 已定 |
| 3 | 同一個地方好多人問：先問先答，一次一條，其餘排後面 | 已定 |
| 4 | 冇問題嘅地方每個停頓位睇一條，冇答案就唔播；最多 `watchMax`（預設 3）條 | 已定（`watchMax` 係新）|
| 5 | 成本上限：group 每分鐘最多開 `groupRate`（預設 10）條答案，超出排隊 | 已定 |
| 6 | 其他地方嘅答案用「攞」（pull），唔係每條都轉發去全部地方 | 已定 |
| 7 | 攞嘅時候：揀**被睇次數最少**嘅，同分隨機（令每條答案都有人睇）| 新，請確認 |
| 8 | 其他地方嘅答案 3 分鐘內先可以攞（太舊唔睇）| 已定 |
| 9 | 唔同步，各自喺自己停頓位播；卡片只講學生名 | 已定 |
| 10 | Group code 由 host 手動輸入 4 位數字（或網址 `?group=1234`）| 已定 |
| 11 | 答案聲音上 R2，payload 只有文字 + 網址 | 已定 |
| 12 | 新 Durable Object class（`GroupDurableObject`）管成員、答案、排隊 | 已定 |
| 13 | 一個 group 最多 100 個 room | 已定 |
| 14 | 連 group 失敗：room 照開，畫面有提示同「再試」掣，唔阻住上堂 | 已定 |

---

## 5. 流程

### 5.1 連 group

```
Host（地方 N） 填 group code 1234（或 ?group=1234）→ 開 room → connectRoom
   → emit join_group { code, lessonId }
Room N         → GROUP("1234").join(roomId, lessonId, lessonTitle, limits)
GroupDO        第一個加入：建立 group，記低 lessonId 同 limits（groupRate）
               之後：lessonId 唔同 → 拒絕；已有 100 個 room → 拒絕
               成功：回 { ok, members, lessonTitle }
```

加入唔通知其他 room（開課前一刻幾十個 host 同時加入，唔會有廣播風暴）。成員數由「攞答案」嗰次一併更新。

### 5.2 學生發問

```
學生 C（地方 3）  錄音 → ask_question
Room 3           1. tutorAskCheck（照舊：開咗未、90 秒間隔、每 room 上限）
                 2. 有 group → GROUP.canAsk(roomId)
                       拒絕 "busy"（group 每分鐘轉文字次數到頂）→ 「稍後再試」，唔轉文字
                 3. 錄音轉文字（STT）
                 4. 呢個 room 而家有冇另一條問題喺度整緊答案？
                       冇 → 即刻開始（見 5.3）
                       有 → 入 room 排隊 session.tutor.queue（先問先答，最多 3 條；滿咗拒絕「你哋呢度排滿咗」）
                 5. ack { ok, id, text, waitMs }；ask_received 發 host（手 chip）
```

### 5.3 開始整答案（group 限流）

```
Room 3   開始一條問題：有 group → GROUP.submit(roomId, askId, name)
GroupDO  過去 60 秒開咗少過 groupRate 條 → 回 { start: true }，記一個 start
         否則 → 入 waiting，回 { queued: true }（room 發 ask_status: queued 畀學生）
         排隊等緊嘅，喺有位時按先後次序 drain（task）：呼叫 room.startTutorAnswer(askId)
         排太耐（> 2 分鐘）→ 丟棄：room.groupNotChosen → ask_status: later（學生可以即刻再問）
Room 3   開 job tutor-answer（模型 + 聲音；有 group 時聲音上 R2）
```

冇 group 嘅 room：步驟 4 之後直接開 job，同舊版一樣。

### 5.4 答案整好

```
Room 3   applyTutorJob：
           ├─ ok：
           │    ├─ 發自己 host：tutor_answer（fromGroup:false，帶 audioUrl）
           │    ├─ GROUP.publish(roomId, askId, payload)   ← 只係存喺 group，唔轉發
           │    └─ 開 queue 入面下一條（有嘅話）
           └─ declined / failed → 照舊發 tutor_declined + ask_status；開下一條
```

**唔轉發。** 其他地方想睇就自己攞（5.5）。

### 5.5 冇自己答案嘅地方：攞其他地方嘅答案

```
Host 頁   watchSlot 空、已睇少過 watchMax 條、冇自己答案等緊
          → emit group_pull {}（每 20 秒最多一次，攞到就停）
Room      → GROUP.pick(roomId)
GroupDO   由 answers 入面揀：唔係呢個 room 嘅、呢個 room 冇攞過、3 分鐘內嘅
          揀「被攞次數最少」嘅，同分隨機；記低 delivered
          回 { answer | null, members }
Host 頁   攞到 → 放入 watchSlot，即刻 preload 聲音
```

### 5.6 Host 頁播放

```
到停頓位 / 問題前 / 結果頁收埋：
  state.answers 有 → 播自己嘅（同依家一樣）
  否則 watchSlot 有、未過期（3 分鐘）、watched < watchMax → 播呢條（watched + 1）
  否則唔播
播完 watchSlot 清空；唔夠 watchMax 就繼續攞下一條
```

- 自己嘅答案優先；有自己嘅答案等緊，watchSlot 保留到下一個停頓位。
- 其他地方嘅答案播完唔計入 `state.answered`。

### 5.7 結束

- Room 結束（host 撳結束，或 host 斷線被當作 `session_ended`）→ `GROUP.leave(roomId)`；該 room 排緊嘅 waiting 項目一併移走。
- Group 冇成員，或者最後一次活動後 12 小時 → 清空自己，同時刪走 R2 嘅 `uploads/autoclass/_tutor/<code>/` 聲音。

---

## 6. 成本同課堂時間

### 6.1 成本

| 項目 | 上限 |
| --- | --- |
| 模型 + 語音（最貴）| 每個 room 最多 `maxAnswers` 條自己嘅問題；全 group 每分鐘最多開 `groupRate`（10）條 |
| 錄音轉文字 | group 每分鐘最多 20 次（`STT_PER_MIN`）；學生 90 秒一條；每 room 排隊最多 3 條 |
| 聲音檔 | 每條答案 2 個，12 小時後刪 |
| 攞答案 | 每個 room 每 20 秒最多 1 次，攞夠 `watchMax` 條就停 |

最壞情況：50 個地方、每個 3 條 = 150 條答案；每分鐘 10 條就要 15 分鐘先開晒，排太耐（2 分鐘）嘅問題會收到「今次排唔切」，學生可以再問。`groupRate` 可以按預算調。

### 6.2 課堂時間

每個地方最多聽：自己嘅答案（≤ `maxAnswers`，預設 3）+ 其他地方嘅答案（≤ `watchMax`，預設 3），每條約 45–75 秒，最多約 5–7 分鐘，而且只喺停頓位播，唔會打斷 lesson。

---

## 7. 擴展到好多地方：要處理嘅位

| 位 | 問題 | 處理 |
| --- | --- | --- |
| 轉發量 | 50 個地方 × 每條答案轉發去全部 | 唔轉發，改為各地方自己攞（5.5）|
| 加入風暴 | 開課前一刻幾十個 host 同時加入 | 加入唔廣播（O(M)）|
| 成員數更新 | 廣播會 O(M²) | 攞答案嗰次順便回成員數，唔廣播 |
| 成本 | 地方多，問題多 | `groupRate` 排隊 + 2 分鐘丟棄；`STT_PER_MIN`；每 room 排隊上限 |
| 一個 alarm | Durable Object 一次只有一個 alarm | `tasks` 表記下一個到期事項（`drain`、`prune`、`cleanup`），alarm = 最近嗰個 |
| 唔同 host 網速 | 聲音檔要自己載 | R2 檔 + `Cache-Control`；攞到即刻 preload，播嗰陣已經載好 |
| 錯 code | 人多手快輸錯 code | chip 顯示「已連 23 個地方 · {lesson 名}」；lesson 唔同會被拒 |
| 隨機偏向 | 純隨機會有答案冇人睇 | 揀被攞次數最少嘅，同分隨機 |

---

## 8. 資料結構

### GroupDurableObject（SQLite）

```
meta      (id=1, lesson_id, lesson_title, group_rate, created_at)
members   (room_id PRIMARY KEY, joined_at INT)
waiting   (ask_id PRIMARY KEY, room_id, name, at INT)            -- 等緊開始整答案，限流用
starts    (at INT)                                               -- 最近 60 秒嘅開始時間
answers   (ask_id PRIMARY KEY, room_id, name, question, answer, language,
           audio_url, question_audio_url, created_at INT, delivered INT)
delivered (ask_id, room_id, PRIMARY KEY (ask_id, room_id))
rate      (minute INT PRIMARY KEY, count INT)                    -- 轉文字計數，用完即刪
tasks     (name PRIMARY KEY, due INT)                            -- 'drain' | 'prune' | 'cleanup'
```

- 名：`env.GROUP.getByName(code)`。
- 每次寫入都 `setAlarm(min(tasks.due))`。
- `prune`：刪走 10 分鐘前嘅 `answers`、`delivered`；`cleanup`：最後活動後 12 小時清空全部同 R2。
- 答案文字存喺 group 係為咗畀其他地方攞；學生錄音唔會去到 group。

### Room state

```
session.group           = { code, members }
session.tutor.queue     = [{ askId, playerId, name, question }]   // 等前一條整完，最多 3 條
session.tutor.inflight  = { askId, at } | null                    // 正整緊嘅一條
```

- `inflight` 超過 3 分鐘當失敗，清走（防止卡死）。

### Host 頁 state

```
state.group      = { code, members } | null
state.watchSlot  = { askId, name, question, answer, audioUrl, questionAudioUrl, createdAt } | null
state.watched    = 0
state.seenAsks   = Set                                            // 睇過嘅，唔再攞
```

---

## 9. 介面

### 9.1 Host → Room（socket event）

| event | data | ack |
| --- | --- | --- |
| `join_group` | `{ code, lessonId }` | `{ ok, members, lessonTitle }` 或 `{ ok:false, error }` |
| `leave_group` | `{}` | `{ ok }` |
| `group_pull` | `{}` | `{ ok, answer: {…} \| null, members }` |

只限 host。同一 code 重複 `join_group` = 冪等；唔同 code = 先 leave 再 join。

### 9.2 Room → Host

- `tutor_answer`（已有）：加 `fromGroup: false`、`audioUrl`、`questionAudioUrl`（有 group 時用網址；冇 group 仍然用 base64）。
- `tutor_declined`（已有）：加用喺「排太耐丟棄」。
- 唔再有 `group_state`、`tutor_state full`（group 層面）。

### 9.3 Room → 學生

`ask_status` 加兩個狀態：

| state | 學生手機訊息（i18n key）| 之後 |
| --- | --- | --- |
| `queued` | `join.askQueued`：「Tommy 好快輪到你，等一等！」| 照舊等 |
| `later` | `join.askLater`：「今次排唔切，等一陣再問啦！」| 即刻可以再問（90 秒間隔清除）|

- 兩個 key 加喺 `public/i18n.js` 四種語言（`join.askDeclined` 旁邊，現有 4 個位置：英文、繁體、粵語、簡體）。
- 語氣：唔責備、唔點名、唔叫「小朋友」（見 `docs/autoclass-lesson-rules.md`）。

### 9.4 Group DO（RPC，只畀 room 呼叫）

| 方法 | 作用 |
| --- | --- |
| `join(roomId, lessonId, lessonTitle, limits)` | 加入，建立 group |
| `leave(roomId)` | 離開；移走佢嘅 waiting；冇人就清 |
| `canAsk(roomId)` | 轉文字次數檢查（`busy`）|
| `submit(roomId, askId, name)` | 限流：`{ start:true }` 或 `{ queued:true }` |
| `publish(roomId, askId, payload)` | 存答案，畀其他地方攞 |
| `pick(roomId)` | 攞一條其他地方嘅答案（第 5.5 節規則）|

### 9.5 Room（RPC，畀 group 呼叫）

| 方法 | 作用 |
| --- | --- |
| `startTutorAnswer(askId)` | 用 queue / pending 資料開 job（背景跑，即刻回）|
| `groupNotChosen(askId)` | 排太耐丟棄：通知 host 同學生（`later`），清走間隔 |

### 9.6 R2 聲音

- Key：`uploads/autoclass/_tutor/<code>/<uuid>.mp3`、`…/<uuid>-q.mp3`。
- 讀取：現有 `/uploads/autoclass/_tutor/<code>/<file>`（`serveUpload`，支援 Range，冇新路由）。
- 上載用 `env.UPLOADS`；`Cache-Control: public, max-age=43200`。
- 12 小時後由 group 嘅 `cleanup` 任務 list + delete 前綴。

---

## 10. Host 頁改動（`public/autoclass.js`、`autoclass.html`、`autoclass.css`）

### UI

- 設定卡加「連線（可選）」欄位：`Group code`（4 位數字）。亦支援網址 `?group=1234`。
- 等候室同上堂畫面角落加細 chip：`🔗 已連 23 個地方 · 動物的家`（數量同 lesson 名，唔列地方）。連唔到顯示 `未連到：{原因}` 加「再試」掣。
- 學生手機同大螢幕卡片：冇新增（卡片已經顯示 `{名} asks`）。

### Logic

- `openRoom()`：開咗 room 同 `set_tutor` 之後，有 code 就 `join_group`；失敗只設 chip，唔阻住。
- **`syncAsking()` 保留**：按每個地方自己嘅 `maxAnswers` 開關手按鈕；`state.answered` 只計自己嘅。
- 攞答案：`maybePull()`，條件：有 group、`watchSlot` 空、`watched < watchMax`、冇自己嘅答案等緊、距上次攞 ≥ 20 秒、頁面冇被 `tutorBusy`；攞到就 preload。
- 播放：`answerWaiting()`、`takeBreak()`、`runTutor()` 共用 `nextAnswer()`：先 `state.answers`，再 `watchSlot`（未過 3 分鐘）。
- `runTutor()`：`playClip` 優先用 `audioUrl`，冇就用舊嘅 base64 `audioContent`（冇 group 嘅 room 行為不變）。
- `closeTutor()`：自己嘅答案先 `state.answered += 1`；watchSlot 嘅 `state.watched += 1`。
- Host 重連（`host_session` 後）：重新 `join_group`（冪等）。

---

## 11. 同第 2 版改咗乜

| 第 2 版 | 第 3 版 | 原因 |
| --- | --- | --- |
| 收集 → 抽籤，只答 1 條，全部地方睇同一條 | **每個地方嘅問題都答**，各睇各 | 你嘅玩法：有問睇自己，冇問睇人哋 |
| 全 group Max（`groupMax`）| 取消；改 `groupRate`（每分鐘開幾多條）限成本 | 冇「冇中」嘅人，只係怕太多太快 |
| 未被答過嘅地方優先 | 唔需要 | 全部都答 |
| 冇中嘅人提示 `later` | `later` 只用喺排太耐（2 分鐘）丟棄；新增 `queued` | 狀態改咗意思 |
| 每條答案轉發去全部地方 | 唔轉發，冇問題嘅地方自己攞（pull）| 好多地方時轉發量太大 |
| `group_state` 防抖推送、`tutor_state full` | 取消 | 冇 Max，冇 `full` |
| 抽籤窗口 10 秒 | 取消 | 冇抽籤，答案更快 |
| `tutor.groupMax` | `tutor.groupRate`、`tutor.watchMax` | 見上 |
| 一個地方一次排 1 條（pending 拒絕）| 先問先答，room 內排隊（最多 3 條）| 你嘅決定 |

---

## 12. 邊角情況

| 情況 | 處理 |
| --- | --- |
| 同一地方好多人同時問 | `inflight` 一次一條，其餘入 room `queue`（最多 3），滿咗拒絕「排滿咗」|
| 全 group 一齊問（超過 `groupRate`）| `waiting` 排隊，按先後 drain；等過 2 分鐘 → `later` |
| 好多地方冇答案可攞 | `pick` 回 null；host 20 秒後再攞；`watchSlot` 空就唔播 |
| 其他地方嘅答案太舊（> 3 分鐘）| `pick` 唔會揀；`watchSlot` 入面過期嘅丟棄 |
| 自己同其他地方嘅答案同時有 | 先自己，`watchSlot` 保留到下一個停頓位 |
| 攞到嘅答案係自己 room 嘅 | `pick` 排除自己 room |
| 答案冇人睇 | 揀被攞次數最少嘅，所以盡量每條都有人睇 |
| 聲音失敗但文字有 | `audioUrl: null`，用字幕逐粒亮（現有做法）|
| 抽到答案嘅 room 已結束（drain 嗰陣）| `startTutorAnswer` 失敗 → 跳過，drain 下一個 |
| host 頁閂咗 / 斷線 | Room 結束就 `leave`，waiting 移走 |
| 同 code 但 lesson 唔同 | 拒絕：「呢個代碼已經用緊另一堂」|
| 第 101 個 room | 拒絕：「呢個群組已滿」|
| Room 重連 | `host_session` 後重新 `join_group`（冪等）；`watched` 同 `seenAsks` 保留喺頁面 |
| `inflight` 卡死（job 無返應）| 3 分鐘後清走，開下一條 |
| `set_tutor` 重置 `asked` / `total` | 已知現有行為；連 group 後 `syncAsking` 仍然按 `maxAnswers` 切換，所以可能觸發，維持現狀；舊行為另開 issue |
| GroupDO 暫時唔回應 | `canAsk` / `submit` 失敗：呢個 room 退返單 room 模式（直接開 job，唔限流）；`pick` 失敗：下次再攞 |
| Group 已過期（12 小時）| room 當冇 group |

---

## 13. Server 改動

| 檔案 | 改動 |
| --- | --- |
| `wrangler.jsonc` | `durable_objects.bindings` 加 `{ "name": "GROUP", "class_name": "GroupDurableObject" }`；`exports` 加 `"GroupDurableObject": { "type": "durable-object", "storage": "sqlite" }` |
| `worker/index.js` | `export { GroupDurableObject } from "./group.js";` |
| `worker/group-rules.js`（新）| 純函數：`canAsk`（轉文字速率）、`submitDecision`（限流 / 排隊 / 2 分鐘丟棄）、`pickAnswer`（排除自己 / 已攞、3 分鐘、最少被攞、隨機）、加入檢查 |
| `worker/group.js`（新）| `GroupDurableObject`：包住 `group-rules.js`，管 SQLite、`tasks` alarm、RPC、R2 清理 |
| `worker/room-group.js`（新）| room 端純 logic：`join_group` / `leave_group` / `group_pull`、`session.group`、room 內排隊 `queue` / `inflight` |
| `worker/room-events.js` | 加 `join_group`、`leave_group`、`group_pull` case |
| `worker/room-tutor.js` | `askQuestion` 改為「有 inflight 就入 queue」；`tutorJobFor(state, askId)`；`applyTutorJob` 成功後回傳 `groupPublish` 同「開下一條」指示；`tutor_answer` 加 `fromGroup`、`audioUrl` |
| `worker/room.js` | `ask_question` 喺 `tutorAskCheck` 後 `await group.canAsk`；開 job 前 `group.submit`；`#tutorAnswer` 有 group 時聲音上 R2；`#deliver` 處理 `groupPublish`；新 RPC `startTutorAnswer`、`groupNotChosen`；`group_pull` 呼叫 `group.pick`；`close()` 時 `leave` |
| `lib/autoclass-script.mjs` | `tutor.groupRate`（1–60，預設 10）、`tutor.watchMax`（0–10，預設 3）|
| `public/i18n.js` | 加 `join.askQueued`、`join.askLater`（四種語言）|
| `public/join-tutor.js` | `onStatus` 處理 `queued`、`later` |
| `public/autoclass.js` / `.html` / `.css` | 第 10 節 |
| `docs/autoclass-lesson-rules.md` | 加「好多個地方一齊上堂」一節 |

規則文件新增內容：

> ### 好多個地方一齊上堂
> - 每個地方嘅問題都會被答；先問先答，一次一條，其餘排隊。
> - 有自己嘅答案就睇自己嘅；冇就喺停頓位睇一條其他地方嘅答案（隨機，最多 `watchMax` 條），冇就唔播。
> - 太多人同時問時要排隊；排太耐要溫和提示（「今次排唔切」），學生可以即刻再問；唔責備、唔點名。
> - 卡片只講學生名，唔講地方。
> - 其他地方嘅答案喺停頓位先播，等太耐就算，唔插入。

---

## 14. 不做（今次）

- 幾個地方影片同步（要改成 server 控制播放，另一個大工程）。
- 跨 room 計分 / 排行榜。
- 其他地方嘅學生手機見到「邊度有人舉手」。
- Group 長期保存、歷史記錄。
- 全 group 跨地方嘅「有人舉手」提示 chip。

---

## 15. 測試

### 自動（`node --test`）

**`worker/group-rules.test.js`（新）**

- `canAsk`：轉文字速率到頂 → `busy`；滾動 minute 過期後恢復
- `submitDecision`：未到 `groupRate` → start；到頂 → queue；排過 2 分鐘 → drop
- drain 次序：先排先開；room 已離開就跳過
- `pickAnswer`：
  - 排除自己 room
  - 排除呢個 room 攞過嘅
  - 排除 3 分鐘前嘅
  - 揀被攞次數最少嘅；同分隨機（注入 `pick`）
  - 冇答案 → null
- 加入檢查：lesson 唔同、超 100 個、重複加入

**`worker/room-tutor.test.js`（擴充）**

- 有 group：一次一條；第二條入 `queue`；`queue` 滿咗拒絕；前一條完咗自動開下一條
- 冇 group：同舊版一樣（回歸）
- `tutorJobFor` 由 queue 生成同舊版一樣嘅 job
- `applyTutorJob`：成功 → `groupPublish`；declined / failed → 開下一條
- `inflight` 3 分鐘超時清走
- `tutor_answer` 帶 `fromGroup`、`audioUrl`

**`worker/room-group.test.js`（新）**

- `join_group`、`leave_group`、`group_pull` 只限 host
- `groupNotChosen`：清走學生間隔、移走 queue 項目、發 `later`

**`lib/` / `worker/autoclass-script.test.js`**：`tutor.groupRate`、`tutor.watchMax` 範圍同預設

### 負載測試（新腳本 `scripts/group-load-test.mjs`）

對 `wrangler dev` 開 50 個假 room（假 host + 假學生）連同一個 group，驗證：

1. 50 個 room 同時 `join_group`：全部成功，冇廣播風暴。
2. 一齊發問：開 job 嘅速度唔超過 `groupRate`；超出嘅排隊、2 分鐘後 `later`。
3. 冇問題嘅 room 每個都攞到答案；每條答案被攞次數大致平均。
4. 一個 room 連續 4 個學生問：一次一條，先問先答。
5. R2 聲音可讀；用短 TTL 測 12 小時清理邏輯。
6. 冇 group code 嘅 room 同時存在：行為同舊版完全一樣。

### 手動（`wrangler dev`，3 個真 host 分頁加手機）

重現你個例子：

1. 地方 1 嘅 A、地方 2 嘅 B 問問題；地方 3 嘅 C、D、E、F 冇問。
2. 地方 1 睇 A 嘅答案，地方 2 睇 B 嘅答案，地方 3 睇 A 或 B 嘅答案（隨機，睇過唔重複）。
3. 地方 3 嘅 C、D 同時問：先答 C，D 排後面。
4. 有自己答案嘅地方，唔會被其他地方嘅答案插隊。
5. 攞夠 `watchMax` 條就唔再攞。
6. 一個 host 閂頁：其他唔受影響；group 成員數喺下次攞答案時更新。

---

## 16. 分階段

| 階段 | 內容 | 規模 | 完成標準 |
| --- | --- | --- | --- |
| 1 | `group-rules.js` + 單元測試（限流、排隊、`pickAnswer`、加入檢查）| 中 | 測試全過 |
| 2 | `room-tutor.js` / `room-group.js`：room 內排隊（`queue`、`inflight`）；冇 group 時行為不變 | 中 | 測試全過；舊測試冇壞 |
| 3 | `GroupDurableObject`、`wrangler.jsonc`、room 接線（`join_group`、`canAsk`、`submit`、`publish`、`pick`）| 大 | 本機起到，RPC 跑得通 |
| 4 | R2 聲音上載 + 讀取路由 + `audioUrl` | 中 | 聲音可讀；舊 base64 路徑唔變 |
| 5 | `autoclass-script.mjs`（`groupRate`、`watchMax`）；i18n 兩個 key；`join-tutor.js` 新狀態 | 細 | 測試過 |
| 6 | Host 頁：group code UI、`maybePull`、`watchSlot`、`nextAnswer`、preload | 中 | 手動測試 1–6 過 |
| 7 | 負載測試腳本（50 room）| 中 | 全部驗證項過 |
| 8 | 規則文件 | 細 | — |
| 9 | Deploy | — | **你明確講 yes 先做**；`npx wrangler deploy` 後等最少 4 分鐘先 render（見 `CLAUDE.md`）|

PR 建議：1–2（room 內排隊，唔涉及 group，風險最低）、3–5（server + group）、6（host 頁）、7–8（測試腳本 + 文件），分開 review，亦方便個別 rollback。

---

## 17. 風險

| 風險 | 緩解 |
| --- | --- |
| 新 Durable Object class，deploy 後唔易 rollback | 先本機同負載測試；group 只喺 host 填 code 先用到，冇 code 嘅 room 完全唔經佢；有問題只要唔再填 code |
| 地方多，問題多，費用升 | `groupRate` 限流、轉文字限速、每 room `maxAnswers` 同排隊上限；詳見第 6 節 |
| 排隊令部分學生等太耐 | 2 分鐘後溫和提示 `later`，可以即刻再問；`groupRate` 可調 |
| 一個 GroupDO 處理 100 個 room | 每個事件都細（一個 row）；唔廣播；攞答案每 room 每 20 秒一次 ≈ 5 次 / 秒；遠低於 DO 能力 |
| R2 聲音檔公開可讀 | 檔名用 uuid；內容只係課堂答案；只喺 `AUTOCLASS` 開時有路由；12 小時清走 |
| 4 位 code 撞 | 同 code 但 lesson 唔同會被拒；chip 顯示 lesson 名同成員數核對 |
| `set_tutor` 重置計數嘅舊行為 | 維持現狀；另開 issue |
| 隨機睇其他地方嘅答案，同自己地方嘅 lesson 位置唔配 | 答案係針對同一份 lesson；只喺停頓位播；每個 room 最多 `watchMax` 條 |

---

## 18. 仲未決定嘅細節

1. `groupRate` 預設每分鐘 10 條，係咪啱？預期最多幾多個地方、幾多條問題？
2. `watchMax` 預設 3 條，係咪啱？
3. 其他地方嘅答案 3 分鐘內先可以攞，係咪啱？
4. 揀「被攞次數最少嘅」再隨機（第 4 節 #7），定係純隨機？
5. 排太耐（2 分鐘）就當「今次排唔切」，係咪啱？
6. 每個 room 排隊最多 3 條，係咪啱？
7. Group code 要唔要自動由 lesson 同日期產生，唔使 host 手動輸入？（今次手動，簡單、可控。）
