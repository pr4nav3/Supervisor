/* Supervisor site. No dependencies, no network calls beyond this folder. */
(function () {
  "use strict";

  var root = document.documentElement;
  root.classList.add("site-ready");

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---- theme ---- */
  var themeButton = document.getElementById("theme-toggle");
  var systemDark = window.matchMedia("(prefers-color-scheme: dark)");

  function currentTheme() {
    return root.getAttribute("data-theme") === "dark" ? "dark" : "light";
  }

  function labelTheme() {
    var next = currentTheme() === "dark" ? "light" : "dark";
    themeButton.setAttribute("aria-label", "Switch to the " + next + " theme");
  }

  function setTheme(theme, remember) {
    root.setAttribute("data-theme", theme === "dark" ? "dark" : "light");
    if (remember) {
      try {
        localStorage.setItem("supervisor-theme", theme);
      } catch (error) {
        /* storage blocked: the choice lasts this visit */
      }
    }
    labelTheme();
  }

  labelTheme();
  themeButton.addEventListener("click", function () {
    setTheme(currentTheme() === "dark" ? "light" : "dark", true);
  });
  systemDark.addEventListener("change", function (event) {
    var chosen = null;
    try {
      chosen = localStorage.getItem("supervisor-theme");
    } catch (error) {
      /* ignore */
    }
    if (chosen !== "dark" && chosen !== "light") setTheme(event.matches ? "dark" : "light", false);
  });

  /* ---- which computer, which button ----
     Release links go here the day there is a build; until then the button leads to the
     download section, which says so. A phone cannot install either, so it gets a mailed link. */
  var RELEASES = { mac: null, win: null };
  var ua = navigator.userAgent;
  var isPhone = /Android|iPhone|iPad|iPod/i.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua));
  var isMac = !isPhone && /Mac/.test(navigator.platform || ua);
  var isWin = !isPhone && /Win/.test(navigator.platform || ua);

  var heroDownload = document.getElementById("hero-download");
  if (isMac) heroDownload.textContent = "Download for macOS";
  else if (isWin) heroDownload.textContent = "Download for Windows";
  var link = isMac ? RELEASES.mac : isWin ? RELEASES.win : null;
  if (link) heroDownload.href = link;

  if (isPhone) {
    root.classList.add("is-phone");
    var mail =
      "mailto:?subject=" +
      encodeURIComponent("Supervisor") +
      "&body=" +
      encodeURIComponent("Open this on the computer you work on:\n" + location.href.split("#")[0]);
    document.getElementById("hero-mail").href = mail;
    document.getElementById("mail-link").href = mail;
  }

  /* ---- the lines ----
     Two of the app's own starter clips. One plays at a time; the orb shows bars while it does. */
  var CLIPS = {
    genz: { src: "assets/voice/elise-genz-respectfully.mp3", who: "Elise", line: "Respectfully, get back to it." },
    stern: { src: "assets/voice/derek-stern-not-the-work.mp3", who: "Derek", line: "That isn't the work. Close it." }
  };
  var ROWS = { genz: "row-genz", stern: "row-stern", hero: "hero-voice" };
  var audio = null;
  var speakingRow = null;

  function stopLine() {
    if (audio) {
      audio.pause();
      audio = null;
    }
    if (speakingRow) {
      speakingRow.classList.remove("is-speaking");
      speakingRow = null;
    }
  }

  function playLine(key, rowId) {
    var clip = CLIPS[key];
    var row = document.getElementById(rowId);
    if (!clip || !row) return;
    if (speakingRow === row) {
      stopLine();
      return;
    }
    stopLine();
    audio = new Audio(clip.src);
    speakingRow = row;
    row.classList.add("is-speaking");
    var done = function () {
      if (speakingRow === row) stopLine();
    };
    audio.addEventListener("ended", done);
    audio.addEventListener("error", done);
    audio.play().catch(done);
  }

  /* ---- the page catches you ----
     "Or open YouTube instead" swaps the timer card for the reminder card and plays a line:
     Elise first, Derek if you try it again. Back to my task puts the timer back. */
  var stage = document.getElementById("stage");
  var reminder = document.getElementById("reminder");
  var catchMe = document.getElementById("catch-me");
  var heroKey = "genz";

  function catchVisitor() {
    var clip = CLIPS[heroKey];
    document.getElementById("hero-who").textContent = clip.who + " said";
    document.getElementById("hero-line").textContent = "“" + clip.line + "”";
    reminder.hidden = false;
    stage.classList.add("is-caught");
    playLine(heroKey, "hero-voice");
    catchMe.textContent = "Try it again";
    heroKey = heroKey === "genz" ? "stern" : "genz";
    if (window.innerWidth <= 900) reminder.scrollIntoView({ block: "nearest", behavior: reduceMotion ? "auto" : "smooth" });
  }

  catchMe.addEventListener("click", catchVisitor);
  document.getElementById("back-to-task").addEventListener("click", function () {
    stopLine();
    stage.classList.remove("is-caught");
    window.setTimeout(function () {
      if (!stage.classList.contains("is-caught")) reminder.hidden = true;
    }, 180);
  });

  Array.prototype.forEach.call(document.querySelectorAll("button[data-play]"), function (button) {
    button.addEventListener("click", function () {
      var key = button.dataset.play === "hero" ? (heroKey === "genz" ? "stern" : "genz") : button.dataset.play;
      playLine(key, ROWS[button.dataset.play]);
    });
  });

  /* ---- reveal on scroll ---- */
  var revealables = document.querySelectorAll(".reveal");
  if (reduceMotion || !("IntersectionObserver" in window)) {
    Array.prototype.forEach.call(revealables, function (el) {
      el.classList.add("in");
    });
  } else {
    var revealer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          var siblings = Array.prototype.slice.call(entry.target.parentNode.children);
          entry.target.style.transitionDelay = Math.min(siblings.indexOf(entry.target), 3) * 60 + "ms";
          entry.target.classList.add("in");
          revealer.unobserve(entry.target);
        });
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.08 }
    );
    Array.prototype.forEach.call(revealables, function (el) {
      revealer.observe(el);
    });
  }

  /* ---- the nav follows the section on screen ---- */
  var navLinks = Array.prototype.slice.call(document.querySelectorAll(".site-nav a"));
  var sections = navLinks
    .map(function (a) {
      return document.querySelector(a.getAttribute("href"));
    })
    .filter(Boolean);
  var header = document.querySelector(".site-header");
  var queued = false;

  function syncNav() {
    queued = false;
    var line = header.getBoundingClientRect().height + 80;
    var winner = null;
    sections.forEach(function (section) {
      if (section.getBoundingClientRect().top <= line) winner = section.id;
    });
    if (window.innerHeight + window.scrollY >= document.body.scrollHeight - 2) winner = sections[sections.length - 1].id;
    navLinks.forEach(function (a) {
      var on = winner !== null && a.getAttribute("href") === "#" + winner;
      a.classList.toggle("current", on);
      if (on) a.setAttribute("aria-current", "true");
      else a.removeAttribute("aria-current");
    });
  }

  function queueSync() {
    if (queued) return;
    queued = true;
    window.requestAnimationFrame(syncNav);
  }

  window.addEventListener("scroll", queueSync, { passive: true });
  window.addEventListener("resize", queueSync);
  syncNav();
})();
