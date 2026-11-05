/* Belaris Website Checkup front end. Talks only to this WordPress site's REST API. */
(function () {
  "use strict";
  var root = document.getElementById("belaris-checkup");
  if (!root || !window.BELARIS_CHECKUP) return;
  var CFG = window.BELARIS_CHECKUP;
  var $ = function (id) { return document.getElementById("bc-" + id); };
  var VIEWS = ["v-start", "v-quiz", "v-gate", "v-results"];
  var state = { id: null, url: "", questions: [], step: 0, answers: {}, scan: "idle", stage: "", poll: null };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function host(u) { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return u; } }

  function show(view, focusId) {
    VIEWS.forEach(function (v) { $(v).hidden = v !== view; });
    if (focusId) $(focusId).focus({ preventScroll: true });
    var top = root.getBoundingClientRect().top + window.pageYOffset - 24;
    if (window.pageYOffset > top) window.scrollTo(0, Math.max(0, top));
  }

  function api(path, body) {
    var opts = body
      ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" }
      : { credentials: "same-origin" };
    return fetch(CFG.rest + path, opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) {
          var err = new Error(data.error || data.message || "Something went wrong. Please try again.");
          err.data = data; err.status = res.status; throw err;
        }
        return data;
      });
    }, function () { throw new Error("We couldn't connect. Check your internet connection and try again."); });
  }

  /* ---- scan status ---- */
  function renderScanbar() {
    var bar = $("scanbar");
    bar.hidden = state.scan === "idle";
    bar.className = "bc-scanbar" + (state.scan === "done" ? " bc-done" : state.scan === "error" ? " bc-err" : "");
    var site = esc(host(state.url));
    $("scan-text").innerHTML = state.scan === "done" ? "Finished checking <b>" + site + "</b>."
      : state.scan === "error" ? esc(state.stage) + ' <button class="bc-btn-link" type="button" id="bc-fix-url">Change the address</button>'
      : "Checking <b>" + site + "</b>: " + esc(state.stage || "starting") + "…";
    var fix = $("fix-url");
    if (fix) fix.onclick = function () { reset(); show("v-start", "url"); };
  }
  function poll() {
    clearTimeout(state.poll);
    if (!state.id || state.scan === "done" || state.scan === "error") return;
    state.poll = setTimeout(function () {
      api("scan/" + state.id).then(function (s) {
        state.scan = s.status === "done" ? "done" : s.status === "error" ? "error" : "running";
        state.stage = s.status === "error" ? s.error : s.stage;
        renderScanbar(); notify();
      }, function (e) {
        if (e.status === 404) { state.scan = "error"; state.stage = e.message; renderScanbar(); notify(); }
      }).then(poll);
    }, 2000);
  }
  var waiters = [];
  function notify() {
    if (state.scan === "done" || state.scan === "error") { waiters.forEach(function (w) { w(); }); waiters = []; }
  }
  function scanFinished() {
    return new Promise(function (resolve) {
      if (state.scan === "done" || state.scan === "error") resolve(); else waiters.push(resolve);
    });
  }

  /* ---- 1. start ---- */
  $("start-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var err = $("url-error"); err.hidden = true; $("url").removeAttribute("aria-invalid");
    if (!$("url").value.trim()) { err.textContent = "Enter your website address."; err.hidden = false; $("url").setAttribute("aria-invalid", "true"); $("url").focus(); return; }
    var btn = $("start-btn"); btn.disabled = true; btn.textContent = "Starting…";
    api("scan", { url: $("url").value, business: $("business").value, town: $("town").value }).then(function (r) {
      state.id = r.id; state.url = r.url; state.questions = r.questions; state.step = 0; state.answers = {};
      state.scan = "running"; state.stage = "starting";
      renderScanbar(); poll(); renderQuestion(); show("v-quiz", "q-title");
    }, function (ex) {
      err.textContent = ex.message; err.hidden = false; $("url").setAttribute("aria-invalid", "true"); $("url").focus();
    }).then(function () { btn.disabled = false; btn.textContent = "Check my website"; });
  });

  /* ---- 2. questions ---- */
  function renderQuestion() {
    var q = state.questions[state.step], n = state.step + 1, total = state.questions.length;
    $("q-count").textContent = "Question " + n + " of " + total;
    $("q-bar").style.width = (n / total * 100) + "%";
    $("q-title").textContent = q.q;
    $("q-help").textContent = q.help;
    $("q-error").hidden = true;
    var chosen = state.answers[q.id];
    $("q-options").innerHTML = q.options.map(function (o, i) {
      return '<label class="bc-opt' + (chosen === i ? " bc-checked" : "") + '" for="bc-opt-' + i + '"><input type="radio" name="bc-answer" id="bc-opt-' + i +
        '" value="' + i + '"' + (chosen === i ? " checked" : "") + "><span>" + esc(o.label) + "</span></label>";
    }).join("");
    $("q-next").textContent = n === total ? "Continue" : "Next";
  }
  $("q-options").addEventListener("change", function (e) {
    if (e.target.name !== "bc-answer") return;
    state.answers[state.questions[state.step].id] = Number(e.target.value);
    $("q-error").hidden = true;
    Array.prototype.forEach.call($("q-options").querySelectorAll(".bc-opt"), function (l) {
      l.classList.toggle("bc-checked", l.querySelector("input").checked);
    });
  });
  $("q-options").addEventListener("focusin", function (e) { if (e.target.parentNode.classList) e.target.parentNode.classList.add("bc-focus"); });
  $("q-options").addEventListener("focusout", function (e) { if (e.target.parentNode.classList) e.target.parentNode.classList.remove("bc-focus"); });
  $("q-form").addEventListener("submit", function (e) {
    e.preventDefault();
    if (state.answers[state.questions[state.step].id] === undefined) {
      $("q-error").hidden = false; var f = $("q-options").querySelector("input"); if (f) f.focus(); return;
    }
    if (state.step < state.questions.length - 1) { state.step++; renderQuestion(); $("q-title").focus(); }
    else show("v-gate", "gate-title");
  });
  $("q-back").addEventListener("click", function () {
    if (state.step === 0) { show("v-start", "start-title"); return; }
    state.step--; renderQuestion(); $("q-title").focus();
  });

  /* ---- 3. email ---- */
  $("gate-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var err = $("gate-error"); err.hidden = true; $("email").removeAttribute("aria-invalid");
    var email = $("email").value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      err.textContent = "Enter a valid email address so we can send your report."; err.hidden = false;
      $("email").setAttribute("aria-invalid", "true"); $("email").focus(); return;
    }
    var btn = $("gate-btn"); btn.disabled = true;
    btn.textContent = state.scan === "done" ? "Preparing your report…" : "Finishing your scan…";
    // Wait for the scan to finish first so the WordPress request stays short.
    scanFinished().then(function () {
      if (state.scan === "error") throw new Error(state.stage);
      btn.textContent = "Preparing your report…";
      return api("report", { id: state.id, answers: state.answers, website_confirm: $("website-confirm").value,
        lead: { name: $("name").value, email: email, consent: $("consent").checked } });
    }).then(function (r) {
      clearTimeout(state.poll); state.scan = "idle"; renderScanbar();
      renderResults(r); show("v-results", "r-title");
    }, function (ex) {
      err.textContent = ex.message; err.hidden = false;
      if (ex.data && ex.data.field === "email") { $("email").setAttribute("aria-invalid", "true"); $("email").focus(); }
    }).then(function () { btn.disabled = false; btn.textContent = "See my score"; });
  });

  /* ---- 4. results ---- */
  var TONE = { good: "bc-s-good", fair: "bc-s-fair", bad: "bc-s-bad" };
  var LABEL = { good: "Good", fair: "Fair", bad: "Needs work" };
  var SRC = { scan: "Checked automatically", google: "From your Google listing", owner: "From your answer" };
  function renderResults(r) {
    $("r-title").textContent = r.band.title;
    $("band").textContent = r.band.label; $("band").className = "bc-pill " + TONE[r.band.tone];
    $("band-summary").textContent = r.band.summary;
    $("r-site").textContent = "Checked " + host(r.scanned.url || state.url) + (r.scanned.platform ? " · built with " + r.scanned.platform : "");
    $("ring").setAttribute("aria-label", "Score: " + r.score + " out of 100");
    $("score-num").textContent = r.score;
    var C = 2 * Math.PI * 52, ring = $("ring-val");
    ring.style.strokeDashoffset = C;
    requestAnimationFrame(function () { requestAnimationFrame(function () { ring.style.strokeDashoffset = C * (1 - r.score / 100); }); });

    $("steps").innerHTML = r.steps.map(function (s) {
      return '<li><div class="bc-step-body"><p class="bc-step-title">' + esc(s.title) + "</p>" +
        '<div class="bc-meta"><span class="bc-chip">' + esc(s.topic) + '</span><span class="bc-chip">' + esc(s.effort) + "</span></div>" +
        "<p>" + esc(s.why) + '</p><p class="bc-first"><strong>First step:</strong> ' + esc(s.step) + "</p></div></li>";
    }).join("");

    var a = r.accessibility;
    $("a11y-panel").hidden = !a;
    if (a) {
      $("a11y-sub").textContent = a.issues.length ? "What people with disabilities may run into on your homepage." : "No problems found by our automated check.";
      var imp = { critical: ["Serious", "bc-s-bad"], serious: ["Serious", "bc-s-bad"], moderate: ["Moderate", "bc-s-fair"], minor: ["Minor", "bc-s-fair"] };
      $("a11y-issues").innerHTML = a.issues.map(function (i) {
        var t = imp[i.impact] || ["Check", "bc-s-fair"];
        return '<li><span class="bc-pill ' + t[1] + '">' + t[0] + "</span><span>" + esc(i.text) + '</span><span class="bc-fix">Fix: ' + esc(i.fix) + "</span></li>";
      }).join("");
    }

    $("breakdown").innerHTML = r.items.map(function (i) {
      var ev = (i.answer ? ['You said: "' + i.answer + '"'] : []).concat(i.evidence || []);
      return '<li><div class="bc-bk-head"><span class="bc-name">' + esc(i.topic) + '</span><span class="bc-pill ' + TONE[i.status] + '">' + LABEL[i.status] + "</span></div>" +
        '<span class="bc-bk-src">' + (SRC[i.source] || "") + "</span>" +
        (ev.length ? '<ul class="bc-ev">' + ev.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>" : "") + "</li>";
    }).join("");
    if (CFG.bookingUrl) $("book").href = CFG.bookingUrl; else $("book").hidden = true;
  }

  function reset() {
    clearTimeout(state.poll); waiters = [];
    state.id = null; state.url = ""; state.questions = []; state.step = 0; state.answers = {}; state.scan = "idle"; state.stage = "";
    renderScanbar();
  }
  $("restart").addEventListener("click", function () { reset(); $("url").value = ""; show("v-start", "url"); });
})();
