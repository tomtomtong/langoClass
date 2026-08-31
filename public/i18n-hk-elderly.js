/**
 * HK elderly Cantonese overlays. Loaded only on /hk pages after i18n.js.
 * Does not change the main app's yue strings.
 */
(function (global) {
  const i18n = global.LangoI18n;
  if (!i18n?.addMessages) return;

  i18n.addMessages("yue", {
    "login.title": "LangoClass 登入",
    "login.usernamePlaceholder": "請輸入帳號",
    "login.passwordPlaceholder": "請輸入密碼",
    "login.button": "登入",
    "login.success": "登入成功",
    "login.fail": "登入唔到，請再試",
    "login.enterCredentials": "請先輸入帳號同密碼。",

    "join.gameTitle": "加入課堂",
    "join.nickname": "你嘅名",
    "join.nicknamePlaceholder": "例如：陳婆婆",
    "join.connecting": "而家連緊線，請等一陣…",
    "join.button": "加入",
    "join.classTitle": "加入課堂",
    "join.classHint": "請用老師俾你嘅連結或者二維碼入嚟。",
    "join.joiningTitle": "而家加入緊",
    "join.joiningStatus": "請等一陣…",
    "join.waitingTitle": "請等一下",
    "join.waitingStatus": "請望住前面塊大屏幕。老師準備好就會開始。",
    "join.leaveWaiting": "離開",
    "join.watchTitle": "請望住大屏幕",
    "join.watchStatus": "而家唔使撳掣。請望住老師個畫面。",
    "join.classStarting": "課堂就快開始，請準備。",
    "join.inClassWaiting": "你已經入到課堂。請等老師開始下一個活動。",
    "join.youreIn": "歡迎你，{name}",
    "join.enterNameToJoin": "請輸入你嘅名，然後撳下面綠色掣。",
    "join.enterNickname": "請先輸入你嘅名。",
    "join.endedTitle": "課堂完咗",
    "join.endedStatus": "呢堂課已經完咗。請等老師再開始新課堂。",
    "join.rejoin": "再加入課堂",
    "join.connectedEnter": "已經連到線 — 請輸入你嘅名",
    "join.cannotReach": "連唔到伺服器。請問老師再掃一次二維碼。",

    "waiting.title": "等候室",
    "waiting.copyHint": "撳呢度複製房號",
    "waiting.forStudents": "等緊同學加入…",
    "waiting.studentsSubtitle": "同學可以喺手機加入，等你開始課堂。",

    "class.title": "選擇程度與班級",
    "class.loggedInPrefix": "已登入",
    "class.select": "選擇",
    "class.studentCountOne": "1 位學生",
    "class.studentCount": "{n} 位學生",

    "settings.btnLabel": "設定",
    "sound.btnLabel": "聲音",
    "common.login": "登入",

    "mcq.getReady": "請準備…",
    "mcq.selectedAnswer": "你揀咗呢個答案",
    "mcq.answerLocked": "已經揀好答案",
    "mcq.timesUp": "時間到",
    "mcq.resultCorrect": "答啱喇！",
    "mcq.resultClose": "差少少，下次再試。",
    "mcq.encourageKeepGoing": "做得好，繼續。",
    "buzzin.stepRecord": "撳下面綠色「錄音」掣",
    "buzzin.stepSpeak": "講出你嘅答案",
    "buzzin.stepSubmit": "再撳一次「錄音」交答案",
    "buzzin.record": "錄音",
    "buzzin.buzzInBtn": "搶答",
    "leaderboard.encourage": "做得好！繼續加油。",
    "leaderboard.playAgain": "再玩一次",
  });
})(typeof window !== "undefined" ? window : globalThis);
