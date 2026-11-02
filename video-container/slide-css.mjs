// Slide CSS from the Uncle Tommy lecture videos (Uncle toomy vrm: tools/build.mjs SCENE_CSS + tools/cafe-kit.mjs css).
export const SCENE_CSS = `
  #root { position: absolute; inset: 0; font-family: "Nunito", sans-serif; color: #1f1a24; }
  .content { position: absolute; inset: 0; }
  b { font-weight: 800; }
  .pu { color: #6a3a93; }
  .q { color: #4b2a6b; font-weight: 700; }
  .title { position: absolute; left: 150px; top: 112px; font-size: 76px; font-weight: 900; letter-spacing: -0.01em; line-height: 1.05; }
  .body { position: absolute; left: 150px; top: 250px; width: 1250px; display: flex; flex-direction: column; gap: 40px; }
  .sub { font-size: 44px; font-weight: 600; line-height: 1.3; }
  .li { display: flex; align-items: flex-start; gap: 26px; font-size: 40px; font-weight: 600; line-height: 1.32; }
  .lt { flex: 1; }
  .mk { flex: 0 0 auto; width: 30px; height: 30px; margin-top: 12px; position: relative; }
  .mk-ring { border-radius: 50%; border: 9px solid #a7307f; }
  .mk-diamond::before { content: ""; position: absolute; inset: 5px; border: 4px solid #b9b9c3; transform: rotate(45deg); }
  .mk-plus::before, .mk-plus::after { content: ""; position: absolute; background: #f2b92f; border-radius: 4px; }
  .mk-plus::before { left: 10px; top: 0; width: 10px; height: 30px; }
  .mk-plus::after { left: 0; top: 10px; width: 30px; height: 10px; }
  .mk-dot { border-radius: 50%; width: 22px; height: 22px; margin-top: 16px; }
  .mk-dot.ma { background: #a7307f; } .mk-dot.te { background: #2f9c96; }
  .row { display: flex; align-items: center; gap: 22px; font-size: 42px; font-weight: 600; flex-wrap: wrap; }
  .row .lt { flex: 0 1 auto; }
  .eq { font-size: 46px; font-weight: 900; color: #8a8494; }
  .chip { display: inline-flex; align-items: center; justify-content: center; min-width: 74px; height: 74px; padding: 0 14px; border-radius: 20px; color: #fff; font-weight: 900; font-size: 44px; }
  .chip.wide { padding: 0 26px; }
  .chip.big { width: 120px; height: 120px; font-size: 76px; border-radius: 30px; flex: 0 0 auto; }
  .chip.sm { min-width: 50px; height: 50px; font-size: 30px; border-radius: 14px; margin: 0 4px; vertical-align: middle; padding: 0 8px; }
  .c-p { background: #a7307f; } .c-e1 { background: #6a3a93; } .c-e2 { background: #2f9c96; } .c-l { background: #f2b92f; color: #3b2a00; }
  .c-pu { background: #6a3a93; } .c-ma { background: #a7307f; }
  .tile.c-l .tl, .tile.c-l .tw { color: #3b2a00; }
  .card { border-radius: 30px; padding: 30px 40px; background: #fff; border: 4px solid #e6dcef; box-shadow: 0 10px 30px rgba(80, 40, 120, 0.08); font-size: 40px; line-height: 1.35; }
  .tag { font-size: 29px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; color: #8b6aa9; margin-bottom: 8px; }
  .motion { background: #f8f2fd; border-color: #dcc7f0; }
  .motion-text { font-size: 54px; font-weight: 900; color: #4b2a6b; }
  .hl { background-image: linear-gradient(#ffe08a, #ffe08a); background-repeat: no-repeat; background-position: 0 85%; background-size: 0% 100%; border-radius: 8px; padding: 0 6px; }
  .sides { display: flex; gap: 40px; }
  .side { flex: 1; }
  .s-ma { border-color: #e9b7d6; background: #fdf4f9; } .s-ma .tag, .s-ma .ch { color: #a7307f; }
  .s-te { border-color: #a9dcd8; background: #f1fbfa; } .s-te .tag, .s-te .ch { color: #23807b; }
  .why { display: inline-block; background: #f2b92f; color: #3b2a00; font-weight: 900; padding: 0 16px; border-radius: 12px; }
  .pill { position: relative; display: inline-block; padding: 8px 28px; border-radius: 999px; background: #f1eff5; font-weight: 800; }
  .p-ma { background: #a7307f; color: #fff; } .p-pu { background: #6a3a93; color: #fff; }
  .strike { position: absolute; left: 12px; right: 12px; top: 50%; height: 7px; margin-top: -3px; background: #e0405e; border-radius: 4px; transform-origin: left center; }
  .ex { background: #fffaf0; border-color: #f6dc95; }
  .ex .tag { color: #b98a10; }
  .tiles { display: flex; gap: 34px; }
  .tile { width: 270px; height: 300px; border-radius: 36px; display: flex; flex-direction: column; align-items: center; justify-content: center; color: #fff; box-shadow: 0 14px 30px rgba(80, 40, 120, 0.15); }
  .tl { font-size: 150px; font-weight: 900; line-height: 1; }
  .tw { font-size: 38px; font-weight: 800; margin-top: 14px; }
  .part { display: flex; gap: 36px; align-items: flex-start; }
  .pb { flex: 1; display: flex; flex-direction: column; gap: 6px; }
  .ph { font-size: 50px; font-weight: 900; line-height: 1.1; }
  .pd { font-size: 38px; font-weight: 600; color: #3a3442; }
  .pq { font-size: 36px; line-height: 1.32; margin-top: 6px; padding-left: 22px; border-left: 6px solid #e6dcef; }
  .full { display: flex; flex-direction: column; gap: 26px; }
  .fr { display: flex; gap: 28px; align-items: flex-start; font-size: 36px; line-height: 1.3; font-weight: 600; }
  .fr .chip { flex: 0 0 auto; height: 64px; min-width: 64px; font-size: 38px; }
  .ft { flex: 1; padding-top: 6px; }
  .recap { font-size: 42px; font-weight: 700; display: flex; align-items: center; gap: 16px; color: #8a8494; }
  .recap > b { color: #6a3a93; margin-right: 6px; }
  .rw { display: inline-block; color: #fff; padding: 4px 20px; border-radius: 14px; font-weight: 900; }
  .t-p { background: #a7307f; } .t-e1 { background: #6a3a93; } .t-e2 { background: #2f9c96; } .t-l { background: #f2b92f; color: #3b2a00; }
  .col { flex: 1; display: flex; flex-direction: column; gap: 22px; padding: 34px 44px 40px; }
  .ch { font-size: 44px; font-weight: 900; margin-bottom: 6px; }
  /* layout A (big Uncle Tommy on the right) */
  .left { position: absolute; left: 150px; top: 0; bottom: 0; width: 900px; display: flex; flex-direction: column; justify-content: center; gap: 30px; padding-bottom: 60px; }
  .eyebrow { font-size: 38px; font-weight: 800; color: #6a3a93; }
  .big { font-size: 92px; font-weight: 900; line-height: 1.05; letter-spacing: -0.015em; }
  .note { font-size: 36px; line-height: 1.35; font-weight: 600; background: #fff8e2; border-left: 10px solid #f2b92f; border-radius: 18px; padding: 24px 30px; }
  .bye { align-self: flex-start; font-size: 50px; font-weight: 900; background: #f2b92f; color: #3b2a00; padding: 10px 34px; border-radius: 999px; margin-top: 6px; }
  #outro-g { gap: 24px; }
  #outro-g .big { font-size: 96px; }
  #outro-g .li { font-size: 38px; }
`;

export const KIT_CSS = `
  .body { gap: 32px; }
  #intro-title { font-size: 80px; }
  .list, .blk, .chat { display: flex; flex-direction: column; }
  .list { gap: 14px; } .blk { gap: 12px; } .chat { gap: 14px; }
  .say { display: flex; align-items: center; gap: 22px; font-size: 34px; line-height: 1.3; font-weight: 700; }
  .who { flex: 0 0 150px; height: 58px; border-radius: 16px; display: inline-flex; align-items: center; justify-content: center; color: #fff; font-weight: 900; font-size: 30px; background: #6a3a93; }
  .say.guest .who { background: #2f9c96; }
  .say.lab .who { background: #f2b92f; color: #3b2a00; }
  .bub { flex: 0 1 auto; padding: 9px 28px; border-radius: 24px; background: #f8f2fd; color: #4b2a6b; border: 3px solid #e6dcef; }
  .say.guest .bub { background: #f1fbfa; color: #1d5f5b; border-color: #a9dcd8; }
  .say.lab .bub { background: #fffaf0; color: #5a4200; border-color: #f6dc95; }
  .bub i { font-weight: 600; color: #5a5366; }
  .use { font-size: 30px; font-weight: 800; color: #8a8494; }
  .stack { position: relative; height: 560px; }
  .stack > .chat { position: absolute; left: 0; right: 0; top: 0; }
  .words { display: flex; gap: 22px; }
  .word { flex: 1; display: flex; flex-direction: column; align-items: center; text-align: center; gap: 12px; padding: 28px 16px 30px; border-radius: 30px; background: #fff; border: 4px solid #e6dcef; box-shadow: 0 10px 30px rgba(80, 40, 120, 0.08); }
  .num { display: inline-flex; align-items: center; justify-content: center; width: 62px; height: 62px; border-radius: 50%; color: #fff; font-weight: 900; font-size: 34px; flex: 0 0 auto; }
  .num.c-l { color: #3b2a00; }
  .word .w { font-size: 36px; font-weight: 900; color: #4b2a6b; line-height: 1.1; }
  .word .d { font-size: 29px; font-weight: 600; color: #5a5366; line-height: 1.3; }
  .pjr { display: flex; align-items: center; gap: 26px; font-size: 34px; font-weight: 600; }
  .qp { flex: 0 0 auto; width: 650px; padding: 10px 28px; border-radius: 22px; background: #f8f2fd; border: 3px solid #e6dcef; color: #4b2a6b; font-weight: 800; }
  .arr { font-size: 40px; font-weight: 900; color: #a7307f; }
  .job { flex: 1; color: #3a3442; }
  .step { display: flex; align-items: center; gap: 24px; font-size: 34px; font-weight: 700; }
  .sn { flex: 0 0 140px; font-size: 40px; font-weight: 900; color: #1f1a24; }
  .step .bub { flex: 1; }
  .row .pill { font-size: 34px; }
  .row .chip { height: 64px; font-size: 36px; padding: 0 22px; border-radius: 18px; }
  .sides.three .card { font-size: 36px; white-space: nowrap; }
  #outro-g { gap: 18px; }
  #outro-g .li { font-size: 36px; }
  .pill.p-te { background: #2f9c96; color: #fff; } .pill.p-go { background: #f2b92f; color: #3b2a00; }
  .card .row { font-size: 36px; }
  .col.tight { gap: 14px; padding: 26px 36px 30px; }
  .col.tight .li { font-size: 34px; }
  .sides.three .card { flex: 1; }
  .left .row { gap: 14px; }
  .left .row .pill { font-size: 32px; }
`;
