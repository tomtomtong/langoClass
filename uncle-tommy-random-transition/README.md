# 隨機 Uncle Tommy 過場

呢個先係會隨機彈出 4 款 Uncle Tommy pose 嘅紫／粉色 portal 過場。無 React、npm 或其他 framework 依賴。

## 放入另一個網站

保留成個資料夾結構，然後加入：

```html
<link rel="stylesheet" href="/uncle-tommy-transition/uncle-tommy-transition.css" />
```

```html
<script src="/uncle-tommy-transition/uncle-tommy-transition.js"></script>
```

需要播放時：

```js
UncleTommyTransition.play();
```

如果想喺過場中段切換 SPA 畫面：

```js
UncleTommyTransition.play(() => {
  showNextScreen();
});
```

每次會由 4 款 pose 隨機抽一款，並自動避免連續兩次相同。

## 可選設定

```js
UncleTommyTransition.play({
  duration: 1180,
  coveredAt: 920,
  onCovered(pose) {
    console.log("今次係 pose", pose);
    showNextScreen();
  },
});
```

測試時可用 `pose: 1` 至 `pose: 4` 指定某款；正式使用時唔傳 `pose` 就會隨機。

## 檔案

- `assets/user_uncletommy_1.png` 至 `_4.png`：4 款透明人物圖
- `uncle-tommy-transition.css`：portal、閃光同人物跳出動畫
- `uncle-tommy-transition.js`：隨機 pose 同 `play()` API
- `index.html`：獨立 demo
