/**
 * Lightweight UI i18n for Lango Class host.
 * Usage: LangoI18n.t("settings.title"), LangoI18n.setLocale("zh-TW")
 */
(function (global) {
  const STORAGE_LOCALE_KEY = "lango_ui_locale";

  const LOCALES = [
    { code: "en", label: "English" },
    { code: "zh-CN", label: "简体中文" },
    { code: "zh-TW", label: "繁體中文" },
    { code: "yue", label: "廣東話" },
    { code: "hi", label: "हिन्दी" },
    { code: "es", label: "Español" },
    { code: "fr", label: "Français" },
    { code: "ar", label: "العربية" },
    { code: "bn", label: "বাংলা" },
    { code: "pt", label: "Português" },
    { code: "ru", label: "Русский" },
    { code: "id", label: "Bahasa Indonesia" },
    { code: "de", label: "Deutsch" },
    { code: "ja", label: "日本語" },
    { code: "ms", label: "Bahasa Melayu" },
    { code: "my", label: "Myanmar" },
  ];

  const RTL_LOCALES = new Set(["ar"]);

  const EN = {
    "settings.title": "Settings",
    "settings.subtitle": "Preferences for the classroom host",
    "settings.back": "Back",
    "settings.on": "On",
    "settings.off": "Off",
    "settings.btnAria": "Settings",
    "settings.btnLabel": "Settings",
    "settings.audioIsolation.title": "Audio isolation",
    "settings.audioIsolation.descOn":
      "Background music fades out when video or speech plays, so classroom audio stays clear.",
    "settings.audioIsolation.descOff":
      "Background music can keep playing under video and speech.",
    "settings.language.title": "Language",
    "settings.language.desc": "Choose the interface language for the host.",

    "common.back": "Back",
    "common.next": "Next",
    "common.dashboard": "Dashboard",
    "common.login": "Login",
    "common.logout": "Log out",
    "common.start": "Start",
    "common.cancel": "Cancel",
    "common.course": "Course",
    "common.waitingRoom": "Waiting room",

    "flow.progress": "Progress",
    "flow.login": "1 Login",
    "flow.class": "2 Class",
    "flow.course": "3 Course",
    "flow.section": "4 Section",
    "flow.journey": "5 Exercise",
    "flow.waiting": "6 Waiting room",
    "flow.quiz": "7 Quiz",

    "sound.bgm": "Background Music",
    "sound.effects": "Sound Effects",
    "sound.volume": "Volume",
    "sound.settings": "Sound settings",
    "sound.btnLabel": "Sound",
    "sound.settingsMuted": "Sound settings (all muted)",
    "sound.on": "On",
    "sound.muted": "Muted",

    "login.title": "Lango School Login",
    "login.usernamePlaceholder": "Your name or email",
    "login.passwordPlaceholder": "Password",
    "login.button": "Login",
    "login.success": "Success",
    "login.fail": "Login fail",
    "login.enterCredentials": "Enter username and password.",

    "class.title": "Select level & Class",
    "class.loggedInPrefix": "Logged in as",
    "class.loading": "Loading classes…",
    "class.none": "No classes returned for this teacher.",
    "class.creating": "Creating waiting room…",

    "course.step": "Step 2 Of 2",
    "course.title": "Select Your Course",
    "course.loading": "Loading courses…",

    "section.step": "Step 3 · Pick your section",
    "section.title": "Continue Your Journey!",
    "section.coursePrefix": "Course:",
    "section.loading": "Loading sections…",
    "section.none": "No sections in this course.",
    "section.progressLabel": "Sections Completed",
    "section.progressOutOf": "out of",
    "section.quizzes": "Quizzes",
    "section.exercisesLoading": "Loading exercises…",
    "section.mediaLoading": "Preparing media ({done}/{total})…",
    "section.exercisesEmpty": "No exercises in this section.",
    "section.startExercise": "Start exercise",
    "section.starting": "Starting…",

    "waiting.title": "Waiting Room",
    "waiting.roomCode": "Room Code",
    "waiting.copyHint": "Tap to copy",
    "waiting.copied": "Copied!",
    "waiting.copyFail": "Could not copy room code.",
    "waiting.startIn": "Start In",
    "waiting.studentsTitle": "Connected Students",
    "waiting.studentsSubtitle": "Students can join and wait here until you start an exercise.",
    "waiting.forStudents": "Waiting for students to join…",
    "waiting.startAnother": "Start another session",

    "join.gameTitle": "Join a Game",
    "join.nickname": "Nickname",
    "join.nicknamePlaceholder": "Your name",
    "join.connecting": "Connecting to server…",
    "join.button": "Join",
    "join.classTitle": "Join class",
    "join.classHint": "Open the join link from your teacher's notification.",
    "join.joiningTitle": "Joining class",
    "join.joiningStatus": "Connecting…",
    "join.waitingTitle": "Waiting Room",
    "join.waitingStatus": "Please look at the digital whiteboard outside.",
    "join.leaveWaiting": "Leave waiting room",
    "join.watchTitle": "Watch the lesson",
    "join.watchStatus": "No action is needed. Please watch the teacher's screen.",
    "join.classStarting": "Class is starting — get ready!",
    "join.inClassWaiting": "You're in class — your teacher will start the next activity when ready.",
  };

  const LOCALIZED = {
    "zh-TW": {
      "settings.title": "設定",
      "settings.subtitle": "課堂主持端偏好設定",
      "settings.back": "返回",
      "settings.on": "開",
      "settings.off": "關",
      "settings.btnAria": "設定",
      "settings.btnLabel": "設定",
      "settings.audioIsolation.title": "音量隔離",
      "settings.audioIsolation.descOn":
        "播放影片或語音時，背景音樂會淡出，讓課堂聲音更清晰。",
      "settings.audioIsolation.descOff":
        "背景音樂可在影片或語音播放時繼續播放。",
      "settings.language.title": "語言",
      "settings.language.desc": "選擇主持端介面語言。",
      "common.back": "返回",
      "common.next": "下一步",
      "common.dashboard": "主頁",
      "common.login": "登入",
      "common.logout": "登出",
      "common.start": "開始",
      "common.cancel": "取消",
      "common.course": "課程",
      "common.waitingRoom": "等候室",
      "flow.progress": "進度",
      "flow.login": "1 登入",
      "flow.class": "2 班級",
      "flow.course": "3 課程",
      "flow.section": "4 單元",
      "flow.journey": "5 練習",
      "flow.waiting": "6 等候室",
      "flow.quiz": "7 測驗",
      "sound.bgm": "背景音樂",
      "sound.effects": "音效",
      "sound.volume": "音量",
      "sound.settings": "聲音設定",
      "sound.btnLabel": "聲音",
      "sound.settingsMuted": "聲音設定（已全部靜音）",
      "sound.on": "開",
      "sound.muted": "靜音",
      "login.title": "Lango School 登入",
      "login.usernamePlaceholder": "你的姓名或電郵",
      "login.passwordPlaceholder": "密碼",
      "login.button": "登入",
      "login.success": "成功",
      "login.fail": "登入失敗",
      "login.enterCredentials": "請輸入帳號和密碼。",
      "class.title": "選擇程度與班級",
      "class.loggedInPrefix": "已登入",
      "class.loading": "載入班級中…",
      "class.none": "此教師沒有可用班級。",
      "class.creating": "正在建立等候室…",
      "course.step": "步驟 2 / 2",
      "course.title": "選擇你的課程",
      "course.loading": "載入課程中…",
      "section.step": "步驟 3 · 選擇單元",
      "section.title": "繼續你的旅程！",
      "section.coursePrefix": "課程：",
      "section.loading": "載入單元中…",
      "section.none": "此課程沒有單元。",
      "section.progressLabel": "已完成單元",
      "section.progressOutOf": "/",
      "section.quizzes": "測驗",
      "section.exercisesLoading": "載入練習中…",
      "section.mediaLoading": "準備媒體中（{done}/{total}）…",
      "section.exercisesEmpty": "此單元沒有練習。",
      "section.startExercise": "開始練習",
      "section.starting": "開始中…",
      "waiting.title": "等候室",
      "waiting.roomCode": "房間代碼",
      "waiting.copyHint": "點擊複製",
      "waiting.copied": "已複製！",
      "waiting.copyFail": "無法複製房間代碼。",
      "waiting.startIn": "倒數開始",
      "waiting.studentsTitle": "已連線學生",
      "waiting.studentsSubtitle": "學生可在此加入並等候，直到你開始練習。",
      "waiting.forStudents": "等待學生加入…",
      "waiting.startAnother": "開始另一場",
      "join.gameTitle": "加入遊戲",
      "join.nickname": "暱稱",
      "join.nicknamePlaceholder": "你的名字",
      "join.connecting": "正在連線伺服器…",
      "join.button": "加入",
      "join.classTitle": "加入課堂",
      "join.classHint": "請開啟老師通知中的加入連結。",
      "join.joiningTitle": "正在加入課堂",
      "join.joiningStatus": "連線中…",
      "join.waitingTitle": "等候室",
      "join.waitingStatus": "請看教室外面的電子白板。",
      "join.leaveWaiting": "離開等候室",
      "join.watchTitle": "觀看課堂",
      "join.watchStatus": "不用操作，請看老師畫面。",
      "join.classStarting": "課堂即將開始 — 準備好！",
      "join.inClassWaiting": "你已在課堂中 — 老師準備好會開始下一個活動。",
    },
    yue: {
      "settings.title": "設定",
      "settings.subtitle": "課堂主持用嘅偏好設定",
      "settings.back": "返轉頭",
      "settings.on": "開",
      "settings.off": "熄",
      "settings.btnAria": "設定",
      "settings.btnLabel": "設定",
      "settings.audioIsolation.title": "音量隔離",
      "settings.audioIsolation.descOn":
        "播片或者講嘢嗰陣，背景音樂會收細，課堂聲音就會清啲。",
      "settings.audioIsolation.descOff":
        "播片或者講嘢嗰陣，背景音樂都可以繼續播。",
      "settings.language.title": "語言",
      "settings.language.desc": "揀主持畫面用邊種語言。",
      "common.back": "返轉頭",
      "common.next": "下一頁",
      "common.dashboard": "主頁",
      "common.login": "登入",
      "common.logout": "登出",
      "common.start": "開始",
      "common.cancel": "取消",
      "common.course": "課程",
      "common.waitingRoom": "等候室",
      "flow.progress": "進度",
      "flow.login": "1 登入",
      "flow.class": "2 班",
      "flow.course": "3 課程",
      "flow.section": "4 單元",
      "flow.journey": "5 練習",
      "flow.waiting": "6 等候室",
      "flow.quiz": "7 測驗",
      "sound.bgm": "背景音樂",
      "sound.effects": "音效",
      "sound.volume": "音量",
      "sound.settings": "聲音設定",
      "sound.btnLabel": "聲音",
      "sound.settingsMuted": "聲音設定（全部靜咗音）",
      "sound.on": "開",
      "sound.muted": "靜音",
      "login.title": "Lango School 登入",
      "login.usernamePlaceholder": "你個名或者電郵",
      "login.passwordPlaceholder": "密碼",
      "login.button": "登入",
      "login.success": "得！",
      "login.fail": "登入唔到",
      "login.enterCredentials": "入吓帳號同密碼先啦。",
      "class.title": "揀程度同班",
      "class.loggedInPrefix": "而家登入緊",
      "class.loading": "載緊班級…",
      "class.none": "呢個老師冇班可以用。",
      "class.creating": "開緊等候室…",
      "course.step": "步驟 2 / 2",
      "course.title": "揀你嘅課程",
      "course.loading": "載緊課程…",
      "section.step": "步驟 3 · 揀單元",
      "section.title": "繼續你嘅旅程！",
      "section.coursePrefix": "課程：",
      "section.loading": "載緊單元…",
      "section.none": "呢個課程冇單元。",
      "section.progressLabel": "完成咗嘅單元",
      "section.progressOutOf": "/",
      "section.quizzes": "測驗",
      "section.exercisesLoading": "載緊練習…",
      "section.mediaLoading": "準備緊媒體（{done}/{total}）…",
      "section.exercisesEmpty": "呢個單元冇練習。",
      "section.startExercise": "開始練習",
      "section.starting": "開始緊…",
      "waiting.title": "等候室",
      "waiting.roomCode": "房號",
      "waiting.copyHint": "撳一下複製",
      "waiting.copied": "複製咗！",
      "waiting.copyFail": "複製唔到房號。",
      "waiting.startIn": "倒數開始",
      "waiting.studentsTitle": "連線緊嘅學生",
      "waiting.studentsSubtitle": "學生可以喺度等，直到你開始練習。",
      "waiting.forStudents": "等緊學生入嚟…",
      "waiting.startAnother": "再開一場",
      "join.gameTitle": "加入遊戲",
      "join.nickname": "花名",
      "join.nicknamePlaceholder": "你個名",
      "join.connecting": "連緊伺服器…",
      "join.button": "加入",
      "join.classTitle": "加入課堂",
      "join.classHint": "用老師通知入面條 link 入嚟。",
      "join.joiningTitle": "加入緊課堂",
      "join.joiningStatus": "連線中…",
      "join.waitingTitle": "等候室",
      "join.waitingStatus": "望下課室外邊塊電子白板啦。",
      "join.leaveWaiting": "離開等候室",
      "join.watchTitle": "睇課堂",
      "join.watchStatus": "唔使撳嘢，望住老師個畫面就得。",
      "join.classStarting": "課堂就開始 — 準備啦！",
      "join.inClassWaiting": "你喺課堂度喇 — 老師準備好會開下一個活動。",
    },
    "zh-CN": {
      "settings.title": "设置",
      "settings.subtitle": "课堂主持端偏好设置",
      "settings.back": "返回",
      "settings.on": "开",
      "settings.off": "关",
      "settings.btnAria": "设置",
      "settings.btnLabel": "设置",
      "settings.audioIsolation.title": "音量隔离",
      "settings.audioIsolation.descOn":
        "播放视频或语音时，背景音乐会淡出，让课堂声音更清晰。",
      "settings.audioIsolation.descOff":
        "背景音乐可在视频或语音播放时继续播放。",
      "settings.language.title": "语言",
      "settings.language.desc": "选择主持端界面语言。",
      "common.back": "返回",
      "common.next": "下一步",
      "common.dashboard": "主页",
      "common.login": "登录",
      "common.logout": "登出",
      "common.start": "开始",
      "common.cancel": "取消",
      "common.course": "课程",
      "common.waitingRoom": "等候室",
      "flow.progress": "进度",
      "flow.login": "1 登录",
      "flow.class": "2 班级",
      "flow.course": "3 课程",
      "flow.section": "4 单元",
      "flow.journey": "5 练习",
      "flow.waiting": "6 等候室",
      "flow.quiz": "7 测验",
      "sound.bgm": "背景音乐",
      "sound.effects": "音效",
      "sound.volume": "音量",
      "sound.settings": "声音设置",
      "sound.btnLabel": "声音",
      "sound.settingsMuted": "声音设置（已全部静音）",
      "sound.on": "开",
      "sound.muted": "静音",
      "login.title": "Lango School 登录",
      "login.usernamePlaceholder": "你的姓名或邮箱",
      "login.passwordPlaceholder": "密码",
      "login.button": "登录",
      "login.success": "成功",
      "login.fail": "登录失败",
      "login.enterCredentials": "请输入账号和密码。",
      "class.title": "选择程度与班级",
      "class.loggedInPrefix": "已登录",
      "class.loading": "正在加载班级…",
      "class.none": "此教师没有可用班级。",
      "class.creating": "正在创建等候室…",
      "course.step": "步骤 2 / 2",
      "course.title": "选择你的课程",
      "course.loading": "正在加载课程…",
      "section.step": "步骤 3 · 选择单元",
      "section.title": "继续你的旅程！",
      "section.coursePrefix": "课程：",
      "section.loading": "正在加载单元…",
      "section.none": "此课程没有单元。",
      "section.progressLabel": "已完成单元",
      "section.progressOutOf": "/",
      "section.quizzes": "测验",
      "section.exercisesLoading": "正在加载练习…",
      "section.mediaLoading": "正在准备媒体（{done}/{total}）…",
      "section.exercisesEmpty": "此单元没有练习。",
      "section.startExercise": "开始练习",
      "section.starting": "开始中…",
      "waiting.title": "等候室",
      "waiting.roomCode": "房间代码",
      "waiting.copyHint": "点击复制",
      "waiting.copied": "已复制！",
      "waiting.copyFail": "无法复制房间代码。",
      "waiting.startIn": "倒计时开始",
      "waiting.studentsTitle": "已连接学生",
      "waiting.studentsSubtitle": "学生可在此加入并等待，直到你开始练习。",
      "waiting.forStudents": "等待学生加入…",
      "waiting.startAnother": "开始另一场",
      "join.gameTitle": "加入游戏",
      "join.nickname": "昵称",
      "join.nicknamePlaceholder": "你的名字",
      "join.connecting": "正在连接服务器…",
      "join.button": "加入",
      "join.classTitle": "加入课堂",
      "join.classHint": "请打开老师通知中的加入链接。",
      "join.joiningTitle": "正在加入课堂",
      "join.joiningStatus": "连接中…",
      "join.waitingTitle": "等候室",
      "join.waitingStatus": "请看教室外面的电子白板。",
      "join.leaveWaiting": "离开等候室",
      "join.watchTitle": "观看课堂",
      "join.watchStatus": "无需操作，请看老师画面。",
      "join.classStarting": "课堂即将开始 — 准备好！",
      "join.inClassWaiting": "你已在课堂中 — 老师准备好会开始下一个活动。",
    },
    ms: {
      "settings.title": "Tetapan",
      "settings.subtitle": "Keutamaan untuk hos bilik darjah",
      "settings.back": "Kembali",
      "settings.on": "Hidup",
      "settings.off": "Mati",
      "settings.btnAria": "Tetapan",
      "settings.btnLabel": "Tetapan",
      "settings.audioIsolation.title": "Pengasingan audio",
      "settings.audioIsolation.descOn":
        "Muzik latar pudar apabila video atau suara dimainkan supaya audio bilik darjah kekal jelas.",
      "settings.audioIsolation.descOff":
        "Muzik latar boleh terus dimainkan semasa video atau suara.",
      "settings.language.title": "Bahasa",
      "settings.language.desc": "Pilih bahasa antara muka untuk hos.",
      "common.back": "Kembali",
      "common.next": "Seterusnya",
      "common.dashboard": "Laman utama",
      "common.login": "Log masuk",
      "common.logout": "Log keluar",
      "common.start": "Mula",
      "common.cancel": "Batal",
      "common.course": "Kursus",
      "common.waitingRoom": "Bilik menunggu",
      "flow.progress": "Kemajuan",
      "flow.login": "1 Log masuk",
      "flow.class": "2 Kelas",
      "flow.course": "3 Kursus",
      "flow.section": "4 Bahagian",
      "flow.journey": "5 Latihan",
      "flow.waiting": "6 Bilik menunggu",
      "flow.quiz": "7 Kuiz",
      "sound.bgm": "Muzik Latar",
      "sound.effects": "Kesan Bunyi",
      "sound.volume": "Kelantangan",
      "sound.settings": "Tetapan bunyi",
      "sound.btnLabel": "Bunyi",
      "sound.settingsMuted": "Tetapan bunyi (semua diredam)",
      "sound.on": "Hidup",
      "sound.muted": "Redam",
      "login.title": "Log Masuk Lango School",
      "login.usernamePlaceholder": "Nama atau e-mel anda",
      "login.passwordPlaceholder": "Kata laluan",
      "login.button": "Log masuk",
      "login.success": "Berjaya",
      "login.fail": "Log masuk gagal",
      "login.enterCredentials": "Masukkan nama pengguna dan kata laluan.",
      "class.title": "Pilih tahap & Kelas",
      "class.loggedInPrefix": "Diloger masuk sebagai",
      "class.loading": "Memuatkan kelas…",
      "class.none": "Tiada kelas untuk guru ini.",
      "class.creating": "Mencipta bilik menunggu…",
      "course.step": "Langkah 2 / 2",
      "course.title": "Pilih Kursus Anda",
      "course.loading": "Memuatkan kursus…",
      "section.step": "Langkah 3 · Pilih bahagian",
      "section.title": "Teruskan Perjalanan Anda!",
      "section.coursePrefix": "Kursus:",
      "section.loading": "Memuatkan bahagian…",
      "section.none": "Tiada bahagian dalam kursus ini.",
      "section.progressLabel": "Bahagian Selesai",
      "section.progressOutOf": "daripada",
      "section.quizzes": "Kuiz",
      "section.exercisesLoading": "Memuatkan latihan…",
      "section.mediaLoading": "Menyediakan media ({done}/{total})…",
      "section.exercisesEmpty": "Tiada latihan dalam bahagian ini.",
      "section.startExercise": "Mula latihan",
      "section.starting": "Memulakan…",
      "waiting.title": "Bilik Menunggu",
      "waiting.roomCode": "Kod Bilik",
      "waiting.copyHint": "Ketik untuk salin",
      "waiting.copied": "Disalin!",
      "waiting.copyFail": "Tidak dapat salin kod bilik.",
      "waiting.startIn": "Mula Dalam",
      "waiting.studentsTitle": "Pelajar Bersambung",
      "waiting.studentsSubtitle": "Pelajar boleh sertai dan menunggu di sini sehingga anda mula latihan.",
      "waiting.forStudents": "Menunggu pelajar sertai…",
      "waiting.startAnother": "Mulakan sesi lain",
      "join.gameTitle": "Sertai Permainan",
      "join.nickname": "Nama panggilan",
      "join.nicknamePlaceholder": "Nama anda",
      "join.connecting": "Menyambung ke pelayan…",
      "join.button": "Sertai",
      "join.classTitle": "Sertai kelas",
      "join.classHint": "Buka pautan sertai dari pemberitahuan guru.",
      "join.joiningTitle": "Menyertai kelas",
      "join.joiningStatus": "Menyambung…",
      "join.waitingTitle": "Bilik Menunggu",
      "join.waitingStatus": "Sila lihat papan putih digital di luar.",
      "join.leaveWaiting": "Tinggalkan bilik menunggu",
      "join.watchTitle": "Tonton pelajaran",
      "join.watchStatus": "Tiada tindakan diperlukan. Sila tonton skrin guru.",
      "join.classStarting": "Kelas bermula — bersedia!",
      "join.inClassWaiting": "Anda dalam kelas — guru akan mulakan aktiviti seterusnya bila bersedia.",
    },
    id: {
      "settings.title": "Pengaturan",
      "settings.subtitle": "Preferensi untuk host ruang kelas",
      "settings.back": "Kembali",
      "settings.on": "Aktif",
      "settings.off": "Nonaktif",
      "settings.btnAria": "Pengaturan",
      "settings.btnLabel": "Setelan",
      "settings.audioIsolation.title": "Isolasi audio",
      "settings.audioIsolation.descOn":
        "Musik latar meredup saat video atau suara diputar agar audio kelas tetap jelas.",
      "settings.audioIsolation.descOff":
        "Musik latar dapat terus diputar bersama video atau suara.",
      "settings.language.title": "Bahasa",
      "settings.language.desc": "Pilih bahasa antarmuka untuk host.",
      "common.back": "Kembali",
      "common.next": "Berikutnya",
      "common.dashboard": "Beranda",
      "common.login": "Masuk",
      "common.logout": "Keluar",
      "common.start": "Mulai",
      "common.cancel": "Batal",
      "common.course": "Kursus",
      "common.waitingRoom": "Ruang tunggu",
      "flow.progress": "Progres",
      "flow.login": "1 Masuk",
      "flow.class": "2 Kelas",
      "flow.course": "3 Kursus",
      "flow.section": "4 Bagian",
      "flow.journey": "5 Latihan",
      "flow.waiting": "6 Ruang tunggu",
      "flow.quiz": "7 Kuis",
      "sound.bgm": "Musik Latar",
      "sound.effects": "Efek Suara",
      "sound.volume": "Volume",
      "sound.settings": "Pengaturan suara",
      "sound.btnLabel": "Suara",
      "sound.settingsMuted": "Pengaturan suara (semua dibisukan)",
      "sound.on": "Aktif",
      "sound.muted": "Bisu",
      "login.title": "Login Lango School",
      "login.usernamePlaceholder": "Nama atau email Anda",
      "login.passwordPlaceholder": "Kata sandi",
      "login.button": "Masuk",
      "login.success": "Berhasil",
      "login.fail": "Login gagal",
      "login.enterCredentials": "Masukkan nama pengguna dan kata sandi.",
      "class.title": "Pilih level & Kelas",
      "class.loggedInPrefix": "Masuk sebagai",
      "class.loading": "Memuat kelas…",
      "class.none": "Tidak ada kelas untuk guru ini.",
      "class.creating": "Membuat ruang tunggu…",
      "course.step": "Langkah 2 / 2",
      "course.title": "Pilih Kursus Anda",
      "course.loading": "Memuat kursus…",
      "section.step": "Langkah 3 · Pilih bagian",
      "section.title": "Lanjutkan Perjalanan Anda!",
      "section.coursePrefix": "Kursus:",
      "section.loading": "Memuat bagian…",
      "section.none": "Tidak ada bagian dalam kursus ini.",
      "section.progressLabel": "Bagian Selesai",
      "section.progressOutOf": "dari",
      "section.quizzes": "Kuis",
      "section.exercisesLoading": "Memuat latihan…",
      "section.mediaLoading": "Menyiapkan media ({done}/{total})…",
      "section.exercisesEmpty": "Tidak ada latihan di bagian ini.",
      "section.startExercise": "Mulai latihan",
      "section.starting": "Memulai…",
      "waiting.title": "Ruang Tunggu",
      "waiting.roomCode": "Kode Ruangan",
      "waiting.copyHint": "Ketuk untuk salin",
      "waiting.copied": "Disalin!",
      "waiting.copyFail": "Tidak dapat menyalin kode ruangan.",
      "waiting.startIn": "Mulai Dalam",
      "waiting.studentsTitle": "Siswa Terhubung",
      "waiting.studentsSubtitle": "Siswa dapat bergabung dan menunggu di sini sampai Anda mulai latihan.",
      "waiting.forStudents": "Menunggu siswa bergabung…",
      "waiting.startAnother": "Mulai sesi lain",
      "join.gameTitle": "Gabung Game",
      "join.nickname": "Nama panggilan",
      "join.nicknamePlaceholder": "Nama Anda",
      "join.connecting": "Menghubungkan ke server…",
      "join.button": "Gabung",
      "join.classTitle": "Gabung kelas",
      "join.classHint": "Buka tautan gabung dari notifikasi guru.",
      "join.joiningTitle": "Bergabung ke kelas",
      "join.joiningStatus": "Menghubungkan…",
      "join.waitingTitle": "Ruang Tunggu",
      "join.waitingStatus": "Silakan lihat papan tulis digital di luar.",
      "join.leaveWaiting": "Keluar ruang tunggu",
      "join.watchTitle": "Tonton pelajaran",
      "join.watchStatus": "Tidak perlu tindakan. Silakan tonton layar guru.",
      "join.classStarting": "Kelas mulai — siap-siap!",
      "join.inClassWaiting": "Anda di kelas — guru akan mulai aktivitas berikutnya saat siap.",
    },
    ja: {
      "settings.title": "設定",
      "settings.subtitle": "ホスト用の環境設定",
      "settings.back": "戻る",
      "settings.on": "オン",
      "settings.off": "オフ",
      "settings.btnAria": "設定",
      "settings.btnLabel": "設定",
      "settings.audioIsolation.title": "オーディオ分離",
      "settings.audioIsolation.descOn":
        "動画や音声の再生時にBGMがフェードアウトし、教室の音声をはっきり聞かせます。",
      "settings.audioIsolation.descOff":
        "動画や音声の再生中もBGMを流し続けられます。",
      "settings.language.title": "言語",
      "settings.language.desc": "ホスト画面の表示言語を選びます。",
      "common.back": "戻る",
      "common.next": "次へ",
      "common.dashboard": "ホーム",
      "common.login": "ログイン",
      "common.logout": "ログアウト",
      "common.start": "開始",
      "common.cancel": "キャンセル",
      "common.course": "コース",
      "common.waitingRoom": "待機室",
      "flow.progress": "進行",
      "flow.login": "1 ログイン",
      "flow.class": "2 クラス",
      "flow.course": "3 コース",
      "flow.section": "4 セクション",
      "flow.journey": "5 演習",
      "flow.waiting": "6 待機室",
      "flow.quiz": "7 クイズ",
      "sound.bgm": "BGM",
      "sound.effects": "効果音",
      "sound.volume": "音量",
      "sound.settings": "サウンド設定",
      "sound.btnLabel": "サウンド",
      "sound.settingsMuted": "サウンド設定（すべてミュート）",
      "sound.on": "オン",
      "sound.muted": "ミュート",
      "login.title": "Lango School ログイン",
      "login.usernamePlaceholder": "名前またはメール",
      "login.passwordPlaceholder": "パスワード",
      "login.button": "ログイン",
      "login.success": "成功",
      "login.fail": "ログイン失敗",
      "login.enterCredentials": "ユーザー名とパスワードを入力してください。",
      "class.title": "レベルとクラスを選択",
      "class.loggedInPrefix": "ログイン中",
      "class.loading": "クラスを読み込み中…",
      "class.none": "この教師のクラスはありません。",
      "class.creating": "待機室を作成中…",
      "course.step": "ステップ 2 / 2",
      "course.title": "コースを選択",
      "course.loading": "コースを読み込み中…",
      "section.step": "ステップ 3 · セクションを選択",
      "section.title": "旅を続けよう！",
      "section.coursePrefix": "コース：",
      "section.loading": "セクションを読み込み中…",
      "section.none": "このコースにセクションはありません。",
      "section.progressLabel": "完了したセクション",
      "section.progressOutOf": "/",
      "section.quizzes": "クイズ",
      "section.exercisesLoading": "演習を読み込み中…",
      "section.mediaLoading": "メディアを準備中（{done}/{total}）…",
      "section.exercisesEmpty": "このセクションに演習はありません。",
      "section.startExercise": "演習を開始",
      "section.starting": "開始中…",
      "waiting.title": "待機室",
      "waiting.roomCode": "ルームコード",
      "waiting.copyHint": "タップしてコピー",
      "waiting.copied": "コピーしました！",
      "waiting.copyFail": "ルームコードをコピーできません。",
      "waiting.startIn": "開始まで",
      "waiting.studentsTitle": "接続中の生徒",
      "waiting.studentsSubtitle": "演習を始めるまで、生徒はここで待機できます。",
      "waiting.forStudents": "生徒の参加を待っています…",
      "waiting.startAnother": "別のセッションを開始",
      "join.gameTitle": "ゲームに参加",
      "join.nickname": "ニックネーム",
      "join.nicknamePlaceholder": "あなたの名前",
      "join.connecting": "サーバーに接続中…",
      "join.button": "参加",
      "join.classTitle": "クラスに参加",
      "join.classHint": "先生の通知の参加リンクを開いてください。",
      "join.joiningTitle": "クラスに参加中",
      "join.joiningStatus": "接続中…",
      "join.waitingTitle": "待機室",
      "join.waitingStatus": "外のデジタルホワイトボードを見てください。",
      "join.leaveWaiting": "待機室を出る",
      "join.watchTitle": "授業を見る",
      "join.watchStatus": "操作は不要です。先生の画面を見てください。",
      "join.classStarting": "授業が始まります — 準備して！",
      "join.inClassWaiting": "クラスにいます — 先生が準備できたら次の活動を始めます。",
    },
    my: {
      "settings.title": "ဆက်တင်များ",
      "settings.subtitle": "စာသင်ခန်း host အတွက် ဦးစားပေးများ",
      "settings.back": "နောက်သို့",
      "settings.on": "ဖွင့်",
      "settings.off": "ပိတ်",
      "settings.btnAria": "ဆက်တင်များ",
      "settings.btnLabel": "ဆက်တင်",
      "settings.audioIsolation.title": "အသံ ခွဲခြားခြင်း",
      "settings.audioIsolation.descOn":
        "ဗီဒီယို သို့မဟုတ် စကားသံ ဖွင့်သည့်အခါ နောက်ခံတေးဂီတ လျော့သွားပြီး စာသင်ခန်းအသံ ပိုရှင်းလင်းစေသည်။",
      "settings.audioIsolation.descOff":
        "ဗီဒီယို သို့မဟုတ် စကားသံနှင့်အတူ နောက်ခံတေးဂီတ ဆက်ဖွင့်နိုင်သည်။",
      "settings.language.title": "ဘာသာစကား",
      "settings.language.desc": "Host အင်တာဖေ့စ် ဘာသာစကား ရွေးပါ။",
      "common.back": "နောက်သို့",
      "common.next": "ရှေ့သို့",
      "common.dashboard": "ပင်မစာမျက်နှာ",
      "common.login": "ဝင်မည်",
      "common.logout": "ထွက်မည်",
      "common.start": "စတင်",
      "common.cancel": "ပယ်ဖျက်",
      "common.course": "သင်တန်း",
      "common.waitingRoom": "စောင့်ဆိုင်းခန်း",
      "flow.progress": "တိုးတက်မှု",
      "flow.login": "1 ဝင်မည်",
      "flow.class": "2 အတန်း",
      "flow.course": "3 သင်တန်း",
      "flow.section": "4 အပိုင်း",
      "flow.journey": "5 လေ့ကျင့်ခန်း",
      "flow.waiting": "6 စောင့်ဆိုင်းခန်း",
      "flow.quiz": "7 ပဟေဠိ",
      "sound.bgm": "နောက်ခံတေး",
      "sound.effects": "အသံအကျိုးသက်ရောက်မှု",
      "sound.volume": "အသံပမာဏ",
      "sound.settings": "အသံ ဆက်တင်များ",
      "sound.btnLabel": "အသံ",
      "sound.settingsMuted": "အသံ ဆက်တင်များ (အားလုံး ပိတ်)",
      "sound.on": "ဖွင့်",
      "sound.muted": "ပိတ်",
      "login.title": "Lango School ဝင်ရန်",
      "login.usernamePlaceholder": "အမည် သို့မဟုတ် အီးမေးလ်",
      "login.passwordPlaceholder": "စကားဝှက်",
      "login.button": "ဝင်မည်",
      "login.success": "အောင်မြင်",
      "login.fail": "ဝင်၍မရ",
      "login.enterCredentials": "အသုံးပြုသူအမည်နှင့် စကားဝှက် ထည့်ပါ။",
      "class.title": "အဆင့်နှင့် အတန်း ရွေးပါ",
      "class.loggedInPrefix": "ဝင်ထားသည်",
      "class.loading": "အတန်းများ ဖွင့်နေသည်…",
      "class.none": "ဤဆရာအတွက် အတန်း မရှိပါ။",
      "class.creating": "စောင့်ဆိုင်းခန်း ဖန်တီးနေသည်…",
      "course.step": "အဆင့် 2 / 2",
      "course.title": "သင်တန်း ရွေးပါ",
      "course.loading": "သင်တန်းများ ဖွင့်နေသည်…",
      "section.step": "အဆင့် 3 · အပိုင်း ရွေးပါ",
      "section.title": "ခရီးဆက်ကြစို့!",
      "section.coursePrefix": "သင်တန်း:",
      "section.loading": "အပိုင်းများ ဖွင့်နေသည်…",
      "section.none": "ဤသင်တန်းတွင် အပိုင်း မရှိပါ။",
      "section.progressLabel": "ပြီးစီးသော အပိုင်းများ",
      "section.progressOutOf": "/",
      "section.quizzes": "ပဟေဠိများ",
      "section.exercisesLoading": "လေ့ကျင့်ခန်းများ ဖွင့်နေသည်…",
      "section.mediaLoading": "မီဒီယာ ပြင်ဆင်နေသည် ({done}/{total})…",
      "section.exercisesEmpty": "ဤအပိုင်းတွင် လေ့ကျင့်ခန်း မရှိပါ။",
      "section.startExercise": "လေ့ကျင့်ခန်း စတင်",
      "section.starting": "စတင်နေသည်…",
      "waiting.title": "စောင့်ဆိုင်းခန်း",
      "waiting.roomCode": "အခန်းကုဒ်",
      "waiting.copyHint": "ကူးယူရန် နှိပ်ပါ",
      "waiting.copied": "ကူးပြီး!",
      "waiting.copyFail": "အခန်းကုဒ် ကူးမရပါ။",
      "waiting.startIn": "စတင်ရန်",
      "waiting.studentsTitle": "ချိတ်ဆက်ထားသော ကျောင်းသားများ",
      "waiting.studentsSubtitle": "လေ့ကျင့်ခန်း မစမီ ကျောင်းသားများ ဤနေရာတွင် စောင့်နိုင်သည်။",
      "waiting.forStudents": "ကျောင်းသားများ ဝင်ရန် စောင့်နေသည်…",
      "waiting.startAnother": "နောက်တစ်ကြိမ် စတင်",
      "join.gameTitle": "ဂိမ်းတွင် ပါဝင်မည်",
      "join.nickname": "အမည်ပြောင်",
      "join.nicknamePlaceholder": "သင့်အမည်",
      "join.connecting": "ဆာဗာသို့ ချိတ်ဆက်နေသည်…",
      "join.button": "ပါဝင်မည်",
      "join.classTitle": "အတန်းတွင် ပါဝင်မည်",
      "join.classHint": "ဆရာ၏ အသိပေးချက်မှ ပါဝင်ရန်လင့်ခ်ကို ဖွင့်ပါ။",
      "join.joiningTitle": "အတန်းသို့ ဝင်နေသည်",
      "join.joiningStatus": "ချိတ်ဆက်နေသည်…",
      "join.waitingTitle": "စောင့်ဆိုင်းခန်း",
      "join.waitingStatus": "အပြင်ဘက်ရှိ ဒစ်ဂျစ်တယ် whiteboard ကို ကြည့်ပါ။",
      "join.leaveWaiting": "စောင့်ဆိုင်းခန်းမှ ထွက်မည်",
      "join.watchTitle": "သင်ခန်းစာ ကြည့်မည်",
      "join.watchStatus": "လုပ်ဆောင်ရန် မလိုပါ။ ဆရာ၏ မျက်နှာပြင်ကို ကြည့်ပါ။",
      "join.classStarting": "အတန်း စတင်တော့မည် — ပြင်ဆင်ပါ!",
      "join.inClassWaiting": "သင် အတန်းထဲတွင် ရှိသည် — ဆရာ အဆင်သင့်ဖြစ်လျှင် နောက်လုပ်ဆောင်ချက် စတင်မည်။",
    },
  };

  const MESSAGES = { en: EN };
  Object.keys(LOCALIZED).forEach((code) => {
    MESSAGES[code] = Object.assign({}, EN, LOCALIZED[code]);
  });

  let currentLocale = "en";
  const listeners = new Set();

  function isSupported(code) {
    return LOCALES.some((item) => item.code === code) || Boolean(MESSAGES[code]);
  }

  function normalizeLocale(code) {
    if (!code || typeof code !== "string") return "en";
    const trimmed = code.trim();
    if (LOCALES.some((item) => item.code === trimmed) || MESSAGES[trimmed]) return trimmed;
    const lower = trimmed.toLowerCase();
    if (lower === "zh-tw" || lower === "zh_hant" || lower === "zh-hant") return "zh-TW";
    if (lower === "zh-cn" || lower === "zh_hans" || lower === "zh-hans" || lower === "zh") return "zh-CN";
    if (lower === "yue" || lower === "zh-hk" || lower === "zh_hk" || lower.startsWith("yue")) return "yue";
    if (lower.startsWith("zh")) return "zh-TW";
    if (lower.startsWith("hi")) return "hi";
    if (lower.startsWith("es")) return "es";
    if (lower.startsWith("fr")) return "fr";
    if (lower.startsWith("ar")) return "ar";
    if (lower.startsWith("bn")) return "bn";
    if (lower.startsWith("pt")) return "pt";
    if (lower.startsWith("ru")) return "ru";
    if (lower.startsWith("de")) return "de";
    if (lower.startsWith("ja")) return "ja";
    if (lower.startsWith("ms")) return "ms";
    if (lower.startsWith("id")) return "id";
    if (lower === "my" || lower.startsWith("my-") || lower.startsWith("bur")) return "my";
    if (lower.startsWith("en")) return "en";
    return "en";
  }

  function applyDocumentDirection(locale) {
    if (typeof document === "undefined") return;
    document.documentElement.dir = RTL_LOCALES.has(locale) ? "rtl" : "ltr";
  }

  function t(key, vars) {
    const table = MESSAGES[currentLocale] || MESSAGES.en;
    let text = table[key] ?? MESSAGES.en[key] ?? key;
    if (vars && typeof vars === "object") {
      Object.keys(vars).forEach((name) => {
        text = text.replace(new RegExp(`\\{${name}\\}`, "g"), String(vars[name]));
      });
    }
    return text;
  }

  function applyDom(root = document) {
    const scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      if (!key) return;
      const attr = el.getAttribute("data-i18n-attr");
      const value = t(key);
      if (attr) {
        attr.split(",").forEach((name) => {
          const trimmed = name.trim();
          if (!trimmed) return;
          el.setAttribute(trimmed, value);
        });
      } else {
        el.textContent = value;
      }
    });
  }

  function notify() {
    listeners.forEach((fn) => {
      try {
        fn(currentLocale);
      } catch {
        /* ignore listener errors */
      }
    });
  }

  function setLocale(code, { persist = true, apply = true } = {}) {
    const next = normalizeLocale(code);
    currentLocale = next;
    if (typeof document !== "undefined") {
      document.documentElement.lang = next;
      applyDocumentDirection(next);
      if (apply) applyDom();
    }
    if (persist) {
      try {
        localStorage.setItem(STORAGE_LOCALE_KEY, next);
      } catch {
        /* ignore */
      }
    }
    notify();
    return next;
  }

  function getLocale() {
    return currentLocale;
  }

  function getLocales() {
    return LOCALES.slice();
  }

  function onChange(fn) {
    if (typeof fn !== "function") return () => {};
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function readStoredLocale() {
    try {
      return localStorage.getItem(STORAGE_LOCALE_KEY);
    } catch {
      return null;
    }
  }

  function init({ locale } = {}) {
    const preferred = locale || readStoredLocale() || document.documentElement.lang || "en";
    setLocale(preferred, { persist: Boolean(locale || readStoredLocale()), apply: true });
    return currentLocale;
  }

  function addMessages(locale, dict) {
    if (!dict || typeof dict !== "object") return;
    const raw = String(locale || "").trim();
    const listed = LOCALES.find((item) => item.code === raw);
    const code = listed ? listed.code : normalizeLocale(raw);
    if (!MESSAGES[code]) MESSAGES[code] = Object.assign({}, EN);
    Object.assign(MESSAGES[code], dict);
  }

  function addMessagesAll(byLocale) {
    if (!byLocale || typeof byLocale !== "object") return;
    Object.keys(byLocale).forEach((code) => addMessages(code, byLocale[code]));
  }

  global.LangoI18n = {
    LOCALES,
    STORAGE_LOCALE_KEY,
    t,
    setLocale,
    getLocale,
    getLocales,
    applyDom,
    onChange,
    init,
    normalizeLocale,
    isSupported,
    addMessages,
    addMessagesAll,
  };
})(typeof window !== "undefined" ? window : globalThis);
