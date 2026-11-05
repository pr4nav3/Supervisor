/* Shared mock-up behaviour: a theme switch and the play orbs. */
(function () {
  var root = document.documentElement;
  var theme = document.getElementById("theme");
  if (theme) {
    theme.addEventListener("click", function () {
      var dark = root.getAttribute("data-theme") === "dark";
      if (dark) root.removeAttribute("data-theme");
      else root.setAttribute("data-theme", "dark");
      theme.textContent = dark ? "Dark" : "Light";
    });
  }

  var audio = null;
  var row = null;
  function stop() {
    if (audio) audio.pause();
    if (row) row.classList.remove("is-speaking");
    audio = null;
    row = null;
  }
  document.querySelectorAll("button[data-clip]").forEach(function (button) {
    button.addEventListener("click", function () {
      var mine = button.closest(".voice") || button.parentNode;
      if (row === mine) return stop();
      stop();
      audio = new Audio(button.dataset.clip);
      row = mine;
      row.classList.add("is-speaking");
      var done = function () { if (row === mine) stop(); };
      audio.addEventListener("ended", done);
      audio.addEventListener("error", done);
      audio.play().catch(done);
    });
  });
})();
