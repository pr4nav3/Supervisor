/* The live site's script. Edited by hand; plans/landing-mockups is history, not the source. */
(function () {
  var reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  var root = document.documentElement, $ = function (id) { return document.getElementById(id); };
  /* the theme: the button says what it switches to, and the choice is remembered */
  function isDark() { return root.getAttribute("data-theme") === "dark"; }
  function labelTheme() { $("theme").textContent = isDark() ? "Light" : "Dark"; }
  labelTheme();
  $("theme").addEventListener("click", function () {
    if (isDark()) root.removeAttribute("data-theme"); else root.setAttribute("data-theme", "dark");
    labelTheme();
    try { localStorage.setItem("supervisor-theme", isDark() ? "dark" : "light"); } catch (e) {}
  });
  function setWords(el, text) {
    el.classList.remove("developing");
    el.innerHTML = text.split(" ").map(function (w, i) { return '<span class="w" style="--i:' + i + '">' + w + "</span>"; }).join(" ");
    void el.offsetWidth;
    if (!reduce) el.classList.add("developing");
  }
  function drawWave(el, key) {
    var n = 40, out = "", s = key.length * 31 + 7;
    for (var i = 0; i < n; i++) { s = (s * 9301 + 49297) % 233280; var r = s / 233280; var h = 18 + Math.round(70 * Math.abs(Math.sin(i / n * Math.PI)) * (0.45 + 0.55 * r)); out += '<i style="--h:' + h + ';--i:' + i + '"></i>'; }
    el.innerHTML = out;
  }
  var CLIPS = {
    genz: "assets/voice/derek-genz-bro-lock-in.mp3", stern: "assets/voice/derek-stern-not-the-work.mp3", phone: "assets/voice/elise-gentle-phone-check-after.mp3",
    caught: "assets/voice/elise-genz-caught-in-4k.mp3", session: "assets/voice/derek-gentle-session-good-work.mp3",
    gentle2: "assets/voice/derek-gentle-come-on-back.mp3", mom2: "assets/voice/elise-mom-grounded.mp3", stern2: "assets/voice/elise-stern-wasting-time.mp3"
  };
  var audio = null, speaking = [];
  function stop() {
    if (audio) audio.pause();
    speaking.forEach(function (r) { r.classList.remove("is-speaking"); r.querySelectorAll(".words .w").forEach(function (w) { w.classList.remove("on"); }); });
    audio = null; speaking = [];
  }
  /* captions: the words of the line that is playing light up as the clip runs, spread evenly over its length */
  function caption(a, row) {
    var words = row.querySelectorAll(".words .w");
    (function tick() {
      if (audio !== a) return;
      if (a.duration) { var k = Math.ceil((a.currentTime + 0.1) / a.duration * words.length); words.forEach(function (w, i) { w.classList.toggle("on", i < k); }); }
      if (!a.ended) setTimeout(tick, 40); /* a timer, not a frame: it keeps time in a background tab too */
    })();
  }
  function play(key, rows) {
    if (!CLIPS[key]) return;
    if (speaking.length && speaking[0] === rows[0]) return stop();
    stop();
    audio = new Audio(CLIPS[key]); speaking = rows; rows.forEach(function (r) { r.classList.add("is-speaking"); });
    if (!reduce) caption(audio, rows[0]);
    var done = function () { if (speaking[0] === rows[0]) stop(); };
    audio.addEventListener("ended", done); audio.addEventListener("error", done);
    audio.play().catch(done);
  }

  /* the eye on the promise card looks where the pointer is, within its socket */
  var eyes = Array.prototype.slice.call(document.querySelectorAll(".eye"));
  /* the lid comes back by itself, whether or not the browser reports the animation's end */
  function wink(eye) { eye.classList.remove("wink"); void eye.offsetWidth; eye.classList.add("wink"); clearTimeout(eye._wink); eye._wink = setTimeout(function () { eye.classList.remove("wink"); }, 400); }
  eyes.forEach(function (eye) {
    eye.addEventListener("click", function () { wink(eye); });
  });
  /* looking where the pointer is isn't motion for its own sake, so it stays on under "reduce motion" too */
  var px = 0, py = 0, lookFrame = 0;
  addEventListener("pointermove", function (e) { px = e.clientX; py = e.clientY; if (!lookFrame) lookFrame = requestAnimationFrame(function () { lookFrame = 0; lookAt(px, py); }); }, { passive: true });
  if ("IntersectionObserver" in window) new IntersectionObserver(function (es) { es.forEach(function (e) { e.target._seen = e.isIntersecting; }); }).observe(eyes[0]);
  else eyes[0]._seen = true;
  function lookAt(x, y) {
    eyes.forEach(function (eye) {
      if (!eye._seen) return;
      var r = eye.getBoundingClientRect(); if (!r.width) return;
      var dx = x - (r.left + r.width / 2), dy = y - (r.top + r.height / 2);
      var d = Math.hypot(dx, dy) || 1, m = Math.min(d / 40, 1) * 18;
      eye.querySelector(".look").style.transform = "translate(" + (dx / d * m) + "px," + (dy / d * m) + "px)";
    });
  }
  /* ---- the fan: the front card says its line, then goes to the back of the hand ---- */
  var FANL = { Gentle: "Come on back, you were doing well.", Mom: "Close it, or you're grounded. Don't test me.", "Gen Z": "Bro, lock in.", Stern: "You're wasting your own time. Back to it." };
  var fcards = Array.prototype.slice.call(document.querySelectorAll(".fcard")), fanOrder = [0, 1, 2, 3], fanTimer = null;
  fcards.forEach(function (c, i) {
    drawWave(c.querySelector(".wave"), c.dataset.tone); c.classList.add("in");
    setWords(c.querySelector(".quote"), "\u201c" + FANL[c.dataset.tone] + "\u201d");
    /* a click is the only thing that makes a card speak: a back card comes to the front and
       speaks, the front card speaks again */
    c.addEventListener("click", function () {
      if (fanOrder[0] !== i) fanTo(i);
      play(c.dataset.clip, [c]);
    });
    c.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); c.click(); } });
  });
  function layoutFan() { fanOrder.forEach(function (idx, pos) { var c = fcards[idx]; c.classList.remove("r0", "r1", "r2", "r3"); c.classList.add("r" + pos); }); }
  function sayFront() { var c = fcards[fanOrder[0]]; setWords(c.querySelector(".quote"), "\u201c" + FANL[c.dataset.tone] + "\u201d"); }
  /* the front card drops out of the hand through the slot at its base; the others step forward
     while it slips back in behind them, so it changes layer only while out of sight */
  function fanNext() {
    var front = fcards[fanOrder[0]];
    fanOrder.push(fanOrder.shift());
    /* one continuous motion: the others step forward as the front card drops, which keeps its spot until it is out of sight */
    fanOrder.forEach(function (idx, pos) { var c = fcards[idx]; if (c !== front) { c.classList.remove("r0", "r1", "r2", "r3"); c.classList.add("r" + pos); } });
    front.classList.add("drop"); sayFront();
    setTimeout(function () {
      front.classList.add("snap", "below"); front.classList.remove("drop"); layoutFan(); void front.offsetWidth; front.classList.remove("snap", "below");
    }, 360);
  }
  function fanTo(i) { clearInterval(fanTimer); while (fanOrder[0] !== i) { fanOrder.push(fanOrder.shift()); } layoutFan(); sayFront(); runFan(); }
  function runFan() { clearInterval(fanTimer); if (!reduce) fanTimer = setInterval(function () { if (!audio) fanNext(); }, 3800); }
  /* a hidden tab gets no frames, so the hand waits for it to come back */
  document.addEventListener("visibilitychange", function () { if (document.hidden) clearInterval(fanTimer); else runFan(); });
  layoutFan(); sayFront(); runFan();

  /* ---- 2 · the demo ---- */
  var secs = 29 * 60 + 58;
  setInterval(function () {
    secs = secs > 0 ? secs - 1 : 45 * 60;
    var t = Math.floor(secs / 60) + ":" + String(secs % 60).padStart(2, "0") + " left";
    $("clock").textContent = t; $("clock2").textContent = t;
    $("c-bar").style.width = Math.round((1 - secs / (45 * 60)) * 100) + "%";
  }, 1000);
  var TABS = { yt: { title: "You opened YouTube.", who: "Derek said", line: "Bro, lock in.", clip: "genz" },
               rd: { title: "You opened Reddit.", who: "Derek said", line: "That isn't the work. Close it.", clip: "stern" } };
  var ORDER = ["session", "caught", "phone", "done"];
  var tabs = Array.prototype.slice.call(document.querySelectorAll(".tab")), views = Array.prototype.slice.call(document.querySelectorAll(".view"));
  var card = $("card"), corner = $("corner"), faces = { caught: $("f-caught"), done: $("f-done") };
  var state = "session", pending = null, userTab = null;
  function showTab(key) {
    tabs.forEach(function (t) { t.classList.toggle("front", t.dataset.tab === key); });
    views.forEach(function (v) { v.classList.toggle("on", v.dataset.view === key); });
  }
  /* the framed card is as tall as the face it shows; measured with every transition off */
  function face(which) {
    Object.keys(faces).forEach(function (k) { faces[k].hidden = k !== which; });
    var keepC = corner.style.transition, keepK = card.style.transition;
    corner.style.transition = "none"; card.style.transition = "none"; card.style.height = "auto";
    var h = faces[which].offsetHeight;
    void corner.offsetWidth; corner.style.transition = keepC; card.style.transition = keepK;
    card.style.height = h + "px";
  }
  function placeCorner() {
    if (!corner.classList.contains("centered")) { corner.style.transform = ""; return; }
    var scr = $("screen").getBoundingClientRect();
    var keep = corner.style.transition;
    corner.style.transition = "none"; corner.style.transform = "";
    var r = corner.getBoundingClientRect();
    void corner.offsetWidth; corner.style.transition = keep;
    var dx = (scr.left + scr.width / 2) - (r.left + r.width / 2);
    var dy = (scr.top + scr.height / 2) - (r.top + r.height / 2);
    corner.style.transform = "translate(" + Math.round(dx) + "px," + Math.round(dy) + "px)";
  }
  function currentFace() { return state === "done" ? "done" : "caught"; }
  addEventListener("resize", function () { placeCorner(); if (state !== "session") face(currentFace()); });
  corner.addEventListener("transitionend", function (e) { if (e.propertyName === "width" && corner.classList.contains("centered")) placeCorner(); });
  function apply(next, opts) {
    opts = opts || {};
    clearTimeout(pending); pending = null;
    state = next;
    var tab = opts.tab || (next === "caught" ? "yt" : "docs");
    showTab(tab);
    $("cam").classList.toggle("on", next === "phone");
    /* the screen steps back a little whenever the card is speaking to you */
    $("screen").classList.toggle("dim", next !== "session");
    corner.classList.toggle("centered", next !== "session");
    corner.classList.toggle("framed", next !== "session");
    $("c-actions").hidden = next === "done";
    $("allow").hidden = next === "phone";
    if (next === "session") { stop(); }
    if (next === "caught") {
      var t = TABS[tab];
      $("kicker").textContent = "Distraction"; $("c-title").textContent = t.title; $("c-who").textContent = t.who;
      $("c-voice").classList.remove("muted");
      setWords($("c-line"), "“" + t.line + "”");
      card.className = "card on-color caught"; face("caught");
      if (opts.speak) play(t.clip, [$("c-voice")]); else stop();
    }
    if (next === "phone") {
      $("kicker").textContent = "Phone in view"; $("c-title").textContent = "Your phone is out."; $("c-who").textContent = "Elise said";
      $("c-voice").classList.remove("muted");
      setWords($("c-line"), "“Put the phone down for a bit, you can check it after.”");
      card.className = "card on-color phone"; face("caught"); stop();
    }
    if (next === "done") {
      card.className = "card on-color done"; face("done"); stop();
      faces.done.classList.remove("drawn"); void faces.done.offsetWidth;
      requestAnimationFrame(function () { faces.done.classList.add("drawn"); });
    }
    placeCorner();
    document.querySelectorAll(".slide").forEach(function (s) {
      var on = s.dataset.slide === next;
      s.classList.toggle("out", !on && ORDER.indexOf(s.dataset.slide) < ORDER.indexOf(next));
      s.classList.toggle("on", on);
    });
  }
  tabs.forEach(function (tab) {
    tab.addEventListener("click", function () {
      var key = tab.dataset.tab; userTab = key;
      if (key === "docs") return apply("session");
      showTab(key); clearTimeout(pending);
      pending = setTimeout(function () { apply("caught", { tab: key, speak: true }); }, reduce ? 0 : 650);
    });
  });
  $("back").addEventListener("click", function () { userTab = null; apply(scrollState()); });
  $("allow").addEventListener("click", function () { userTab = null; apply(scrollState()); });
  $("c-orb").addEventListener("click", function () {
    if (state === "phone") return play("phone", [$("c-voice")]);
    var key = tabs.filter(function (t) { return t.classList.contains("front"); })[0].dataset.tab;
    if (TABS[key]) play(TABS[key].clip, [$("c-voice")]);
  });
  var scene = $("scene");
  function scrollState() {
    var top = scene.offsetTop, len = scene.offsetHeight - innerHeight;
    var p = Math.max(0, Math.min(0.9999, (scrollY - top) / len));
    return ORDER[Math.floor(p * ORDER.length)];
  }
  function onScroll() {
    var next = scrollState();
    if (next !== state) { userTab = null; apply(next); }
    arrivals();
  }
  addEventListener("scroll", onScroll, { passive: true });

  /* ---- 3 · the voice: the recording fills, the voice is built, the four ways to talk arrive; then again ---- */
  var recbox = $("recbox"), tape = $("tape"), recT = null, recBars = 40;
  /* each bar is new as it arrives: a random height, loudest in the middle of the take */
  function addBar(i) { var h = 18 + Math.round(70 * Math.abs(Math.sin((i + 1) / recBars * Math.PI)) * (0.4 + 0.6 * Math.random())); var b = document.createElement("i"); b.style.setProperty("--h", h); tape.appendChild(b); }
  function recReset() { clearTimeout(recT); recbox.className = "pane recbox"; tape.innerHTML = ""; $("rec-t").textContent = "0:00"; $("rec-state").textContent = "Ready to record"; }
  function recRun() {
    recReset(); recbox.classList.add("live"); $("rec-state").textContent = "Recording";
    var i = 0, step = 150; /* twenty seconds, told in six */
    (function tick() {
      if (i < recBars) { addBar(i); i++; $("rec-t").textContent = "0:" + String(Math.round(i / recBars * 20)).padStart(2, "0"); recT = setTimeout(tick, step); return; }
      recbox.classList.remove("live"); recbox.classList.add("building"); $("rec-state").textContent = "Building the voice";
      recT = setTimeout(function () { recbox.classList.remove("building"); recbox.classList.add("ready"); $("rec-state").textContent = "Ready to speak"; recT = setTimeout(recRun, 4200); }, 1400);
    })();
  }
  if (reduce) { recbox.classList.add("ready"); for (var rb = 0; rb < recBars; rb++) addBar(rb); $("rec-t").textContent = "0:20"; $("rec-state").textContent = "Ready to speak"; }
  document.querySelectorAll(".vrow .words").forEach(function (el) { setWords(el, el.textContent); el.classList.remove("developing"); });
  document.querySelectorAll(".vrow").forEach(function (r) {
    r.addEventListener("click", function () { play(r.dataset.clip, [r]); });
    r.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); r.click(); } });
  });

  /* ---- 5 · get it ---- */
  var isMac = /Mac/.test(navigator.platform || navigator.userAgent) && navigator.maxTouchPoints < 2;
  function pickOS(os) {
    document.querySelectorAll(".os .vcard").forEach(function (c) { c.classList.toggle("on", c.dataset.os === os); });
    $("way-mac").hidden = os !== "mac"; $("way-win").hidden = os !== "win";
  }
  pickOS(isMac ? "mac" : "win");
  document.querySelectorAll(".os .vcard").forEach(function (c) { c.addEventListener("click", function () { pickOS(c.dataset.os); }); });
  /* each install line has its own Copy */
  document.querySelectorAll("[data-copy]").forEach(function (b) {
    b.addEventListener("click", function () {
      var text = $(b.dataset.copy).textContent;
      (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(function () { b.textContent = "Copied"; setTimeout(function () { b.textContent = "Copy"; }, 1600); }, function () { b.textContent = "Select and copy"; });
    });
  });

  /* the stacked cards: contents rise once as a card arrives; a card loses its shadow once the
     next one has covered it; the voice starts talking when its card is in */
  var sheets = Array.prototype.slice.call(document.querySelectorAll(".deal")), first = document.querySelector(".first");
  /* room under the stack so the page ends with the last row parked at its sticky top */
  /* the hand leans to the right; if the lean would reach past the first screen's edge, the whole
     hand slides left by that much, so no card is ever cut off */
  var fanBox = $("fan");
  function fitFan() {
    if (!fanBox || innerWidth <= 920) { if (fanBox) fanBox.style.transform = ""; return; }
    fanBox.style.transform = "";
    var edge = innerWidth - 12, right = 0;
    fcards.forEach(function (c) { right = Math.max(right, c.getBoundingClientRect().right); });
    if (right > edge) fanBox.style.transform = "translateX(" + Math.round(edge - right) + "px)";
  }
  fitFan(); addEventListener("resize", fitFan); if (document.fonts) document.fonts.ready.then(fitFan);
  function tail() {
    var last = sheets[sheets.length - 1], foot = document.querySelector("footer").offsetHeight;
    /* each row parks centred in the window (with the footer's height counted in, so the last
       row and the credit line read as one centred group); the page ends there */
    /* never under the bar: 72px of bar, 18px of soft edge, 14px of air */
    var top = function (el) { return Math.max(104, Math.round((innerHeight - el.offsetHeight - foot) / 2)); };
    sheets.forEach(function (el) { el.style.setProperty("--top", top(el) + "px"); });
    /* the footer sits right under the last row, and the page keeps as much room under it as
       there is above the row */
    $("stack").style.setProperty("--tail", "0px");
    /* whatever is left under the group once the last row parks at its top; when the row is
       clamped to the bar that is less than the room above it, and the page must end there, not
       push the row up under the bar */
    document.querySelector("footer").style.marginBottom = Math.max(24, innerHeight - top(last) - last.offsetHeight - foot) + "px";
  }
  tail(); addEventListener("resize", tail); document.querySelectorAll(".os .vcard").forEach(function (b) { b.addEventListener("click", function () { setTimeout(tail, 0); }); });
  /* a card is "in" while any of it is on screen, so its arrival replays on the way back up */
  /* the bar's grid lines up with the page's grid whatever the scroll position */
  var bar = document.querySelector("header");
  var h1 = document.querySelector(".hero h1");
  function alignBar() { bar.style.setProperty("--sy", (-(scrollY % 18)) + "px"); bar.classList.toggle("tagged", h1.getBoundingClientRect().bottom < 72); }
  addEventListener("scroll", alignBar, { passive: true }); alignBar();
  function arrivals() {
    sheets.forEach(function (el, i) {
      var r = el.getBoundingClientRect(), was = el.classList.contains("in");
      var now = was ? r.bottom > 0 && r.top < innerHeight : r.top < innerHeight * 0.66 && r.bottom > 0;
      if (now !== was) {
        el.classList.toggle("in", now);
        if (el.id === "voice-screen") { if (now && !reduce) recRun(); else recReset(); }
      }
      /* covered once the next row has slid over it, or once the end of the stack has pushed it
         up past its parking spot (a tall row under a short last one) */
      var next = sheets[i + 1], park = parseFloat(el.style.getPropertyValue("--top")) || 0;
      el.classList.toggle("covered", !!next && (next.getBoundingClientRect().top <= r.top + r.height / 2 || (park && r.top < park - 2)));
    });
    var hero = first.querySelector(".hero").getBoundingClientRect();
    first.classList.toggle("in", hero.bottom > 0);
  }
  onScroll();
})();
