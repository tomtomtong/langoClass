# Lango「LET'S GO!」過場畫面

呢個資料夾已經由原網站獨立抽出，無 React、npm 或其他 framework 依賴。保留成個資料夾結構，放入另一個網站就可以使用。

## 用法

喺頁面 `<head>` 加入 CSS：

```html
<link rel="stylesheet" href="/transition-screen/transition-screen.css" />
```

喺 `</body>` 前加入 JavaScript：

```html
<script src="/transition-screen/transition-screen.js"></script>
```

需要播放過場時：

```js
LangoTransitionScreen.play(() => {
  // 圖片完全顯示後先執行，例如切換 SPA 畫面。
  showNextPage();
});
```

如果係跳去另一條網址：

```js
LangoTransitionScreen.play(() => {
  window.location.href = "/next-page";
});
```

`play()` 會回傳 Promise，所以亦可以：

```js
await LangoTransitionScreen.play();
console.log("過場播放完畢");
```

## 選項

```js
LangoTransitionScreen.play({
  fit: "cover",       // cover 或 contain
  duration: 2600,      // 全段動畫毫秒數
  coveredAt: 420,      // 幾多毫秒後執行 onCovered
  onCovered() {
    showNextPage();
  },
});
```

預設會跟從使用者系統嘅「減少動態效果」設定；如要強制播放，可傳入 `respectReducedMotion: false`。

## 檔案

- `assets/uncletommy-transitionscreen.png`：1376 × 768 原裝過場圖
- `transition-screen.css`：全屏及淡入／縮放／淡出效果
- `transition-screen.js`：自動建立 overlay 同提供 `play()` API
- `index.html`：可以直接開啟嘅示範頁
