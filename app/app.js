/* Chiefs Flashcards -- app.js
 * No build step, no framework, no backend. Vanilla DOM + hash routing.
 */
(function () {
  "use strict";

  var state = {
    roster: null,          // full parsed roster.json document
    players: [],           // roster.players, as loaded
    filterName: "",
    filterGroup: "All",
    lastFilteredIds: [],   // ids in the order last shown in the grid
    padDigits: "",
  };

  var viewEl = null;

  // ------------------------------------------------------------- bootstrap

  function fetchRoster() {
    return fetch("./roster.json", { cache: "no-store" })
      .then(function (resp) {
        if (!resp.ok) { throw new Error("HTTP " + resp.status); }
        return resp.json();
      });
  }

  function loadRosterFallback() {
    if (typeof window.__ROSTER__ === "object" && window.__ROSTER__ !== null) {
      return window.__ROSTER__;
    }
    return null;
  }

  function boot() {
    viewEl = document.getElementById("view");
    wireHeader();

    fetchRoster().then(onRosterLoaded).catch(function (err) {
      console.warn("fetch(./roster.json) failed, trying window.__ROSTER__ fallback:", err);
      var fallback = loadRosterFallback();
      if (fallback) {
        onRosterLoaded(fallback);
      } else {
        renderFatalError();
      }
    });
  }

  function onRosterLoaded(doc) {
    state.roster = doc;
    state.players = Array.isArray(doc.players) ? doc.players : [];
    window.addEventListener("hashchange", route);
    route();
  }

  function renderFatalError() {
    viewEl.innerHTML = "";
    var panel = document.createElement("div");
    panel.className = "error-panel";
    panel.innerHTML =
      "<p><strong>We could not load the roster.</strong></p>" +
      "<p>If you opened this page directly as a file, your browser is " +
      "blocking local data loading. Please run <code>./serve.sh</code> " +
      "from a terminal in this project folder, then reload this page.</p>";
    viewEl.appendChild(panel);
  }

  // ---------------------------------------------------------------- header

  function wireHeader() {
    var nameInput = document.getElementById("nameFilter");
    nameInput.addEventListener("input", function () {
      state.filterName = nameInput.value || "";
      if (getRoute().name === "grid") { renderCurrentView(); }
    });

    var chipRow = document.getElementById("groupChips");
    chipRow.addEventListener("click", function (evt) {
      var btn = evt.target.closest(".chip");
      if (!btn) { return; }
      state.filterGroup = btn.getAttribute("data-group");
      var chips = chipRow.querySelectorAll(".chip");
      for (var i = 0; i < chips.length; i++) {
        chips[i].setAttribute("aria-pressed", chips[i] === btn ? "true" : "false");
      }
      if (getRoute().name === "grid") { renderCurrentView(); }
    });

    var padButton = document.getElementById("padButton");
    padButton.addEventListener("click", function () {
      window.location.hash = "#/pad";
    });
  }

  // -------------------------------------------------------------- routing

  function getRoute() {
    var hash = window.location.hash || "#/grid";
    var parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
    if (parts[0] === "player" && parts[1]) {
      return { name: "player", id: parts[1] };
    }
    if (parts[0] === "pad") {
      return { name: "pad" };
    }
    return { name: "grid" };
  }

  function route() {
    renderCurrentView();
  }

  /* Position-group filters only make sense while browsing the roster, so
     they are hidden (and taken out of the tab order / AT tree) on the
     player and number-pad views. */
  function syncChrome(routeName) {
    var chipRow = document.getElementById("groupChips");
    if (chipRow) { chipRow.hidden = routeName !== "grid"; }
  }

  function renderCurrentView() {
    var r = getRoute();
    syncChrome(r.name);
    if (r.name === "player") {
      renderPlayerView(r.id);
    } else if (r.name === "pad") {
      renderPadView();
    } else {
      renderGridView();
    }
  }

  // ------------------------------------------------------------ data util

  var RESERVE_GROUPS = ["injuredReserveOrOut", "suspended", "practiceSquad"];

  function matchesGroup(player, group) {
    if (group === "All") { return true; }
    if (group === "Reserve") { return RESERVE_GROUPS.indexOf(player.roster_group) !== -1; }
    return player.position_group === group;
  }

  function matchesName(player, needle) {
    if (!needle) { return true; }
    var haystack = ((player.full_name || "") + " " + (player.short_name || "")).toLowerCase();
    return haystack.indexOf(needle.toLowerCase()) !== -1;
  }

  function getFilteredPlayers() {
    return state.players.filter(function (p) {
      return matchesGroup(p, state.filterGroup) && matchesName(p, state.filterName);
    });
  }

  function getPlayerById(id) {
    for (var i = 0; i < state.players.length; i++) {
      if (String(state.players[i].id) === String(id)) { return state.players[i]; }
    }
    return null;
  }

  function initialsFor(player) {
    var f = (player.first_name || "").trim();
    var l = (player.last_name || "").trim();
    var out = (f ? f[0] : "") + (l ? l[0] : "");
    return out.toUpperCase() || "?";
  }

  function escapeHtml(value) {
    var div = document.createElement("div");
    div.textContent = value === null || value === undefined ? "" : String(value);
    return div.innerHTML;
  }

  function createHeadshotEl(player, altText) {
    var wrap = document.createElement("div");
    wrap.className = "headshot-wrap";

    /* Tones the watermark without dimming the player, who is appended
       after it. */
    var scrim = document.createElement("div");
    scrim.className = "scrim";
    wrap.appendChild(scrim);

    var img = document.createElement("img");
    img.loading = "lazy";
    img.alt = altText || player.headshot_alt || player.full_name || "Player headshot";
    img.src = player.headshot_url || "./assets/silhouette.svg";

    var initialsEl = document.createElement("span");
    initialsEl.className = "initials";
    initialsEl.textContent = initialsFor(player);

    img.onerror = function () {
      img.onerror = null;
      img.src = "./assets/silhouette.svg";
      wrap.classList.add("headshot-fallback");
    };

    if (!player.headshot_url) {
      wrap.classList.add("headshot-fallback");
    }

    wrap.appendChild(img);
    wrap.appendChild(initialsEl);
    return wrap;
  }

  /* "Kenneth Walker III" sets as KENNETH WALKER with a gold III beneath it.
     Three players on the roster carry a suffix. */
  var NAME_SUFFIX = /\s+(Jr\.?|Sr\.?|I{2,3}|IV|VI?)$/;

  function fillPlayerName(el, fullName) {
    var name = fullName || "Unknown Player";
    var m = name.match(NAME_SUFFIX);
    if (!m) { el.textContent = name; return; }
    el.appendChild(document.createTextNode(name.slice(0, m.index)));
    var suffix = document.createElement("em");
    suffix.textContent = m[1];
    el.appendChild(suffix);
  }

  /* Jersey number and position ride ON the headshot, not in a row beneath
     it. Appended after the <img> so they paint on top of it. */
  function appendCardBadges(wrap, player, useFullPosition) {
    if (player.jersey) {
      var num = document.createElement("span");
      num.className = "jersey-num";
      num.textContent = player.jersey;
      wrap.appendChild(num);
    }
    var pos = useFullPosition
      ? (player.position_name || player.position_abbrev)
      : player.position_abbrev;
    if (pos) {
      var badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = pos;
      wrap.appendChild(badge);
    }
  }

  // Top rail: arrowhead, team wordmark, and a position/number serial.
  function buildCardRail(player) {
    var rail = document.createElement("div");
    rail.className = "card-rail";

    var mark = document.createElement("img");
    mark.className = "card-rail__mark";
    mark.src = "./assets/card-bg.png";
    mark.alt = "";
    rail.appendChild(mark);

    var team = document.createElement("span");
    team.className = "card-rail__team";
    team.appendChild(document.createTextNode("Kansas City "));
    var city = document.createElement("span");
    city.textContent = "Chiefs";
    team.appendChild(city);
    rail.appendChild(team);

    var serial = document.createElement("span");
    serial.className = "card-rail__serial";
    var num = player.jersey ? String(player.jersey) : "";
    if (num.length === 1) { num = "0" + num; }
    serial.textContent = [player.position_abbrev, num]
      .filter(function (v) { return v; }).join(" \u00B7 ");
    rail.appendChild(serial);

    return rail;
  }

  // ---------------------------------------------------------------- grid

  function renderGridView() {
    var players = getFilteredPlayers();
    state.lastFilteredIds = players.map(function (p) { return p.id; });

    viewEl.innerHTML = "";

    if (players.length === 0) {
      var empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "No players match your search.";
      viewEl.appendChild(empty);
      return;
    }

    var grid = document.createElement("div");
    grid.className = "grid";

    players.forEach(function (player) {
      grid.appendChild(buildTile(player));
    });

    viewEl.appendChild(grid);
  }

  function buildTile(player) {
    var tile = document.createElement("button");
    tile.type = "button";
    tile.className = "card-tile";
    tile.setAttribute("role", "button");
    tile.setAttribute("tabindex", "0");
    tile.setAttribute(
      "aria-label",
      (player.full_name || "Player") + ", number " +
      (player.jersey || "unknown") + ", " + (player.position_abbrev || "")
    );

    var frame = document.createElement("div");
    frame.className = "card-tile__frame";

    var headshot = createHeadshotEl(player);
    appendCardBadges(headshot, player, false);
    frame.appendChild(headshot);

    var plate = document.createElement("div");
    plate.className = "card-plate";
    var name = document.createElement("p");
    name.className = "card-tile__name";
    fillPlayerName(name, player.full_name);
    plate.appendChild(name);
    frame.appendChild(plate);

    tile.appendChild(frame);

    tile.addEventListener("click", function () {
      window.location.hash = "#/player/" + encodeURIComponent(player.id);
    });

    return tile;
  }

  // -------------------------------------------------------------- player

  function renderPlayerView(id) {
    var player = getPlayerById(id);
    viewEl.innerHTML = "";

    var wrap = document.createElement("div");
    wrap.className = "player-view";

    var back = document.createElement("a");
    back.className = "back-link";
    back.href = "#/grid";
    back.textContent = "← Back to roster";
    wrap.appendChild(back);

    if (!player) {
      var missing = document.createElement("div");
      missing.className = "error-panel";
      missing.textContent = "That player could not be found.";
      wrap.appendChild(missing);
      viewEl.appendChild(wrap);
      return;
    }

    var list = getFilteredPlayers();
    var ids = list.map(function (p) { return p.id; });
    var currentIndex = ids.indexOf(player.id);
    if (currentIndex === -1) {
      ids = [player.id];
      currentIndex = 0;
    }
    state.lastFilteredIds = ids;

    var nav = document.createElement("div");
    nav.className = "card-nav";

    var prevBtn = document.createElement("button");
    prevBtn.type = "button";
    prevBtn.className = "nav-btn";
    prevBtn.textContent = "‹ Prev";
    prevBtn.disabled = currentIndex <= 0;

    var counter = document.createElement("span");
    counter.textContent = (currentIndex + 1) + " of " + ids.length;

    var nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.className = "nav-btn";
    nextBtn.textContent = "Next ›";
    nextBtn.disabled = currentIndex >= ids.length - 1;

    prevBtn.addEventListener("click", function () { goToIndex(ids, currentIndex - 1); });
    nextBtn.addEventListener("click", function () { goToIndex(ids, currentIndex + 1); });

    nav.appendChild(prevBtn);
    nav.appendChild(counter);
    nav.appendChild(nextBtn);
    wrap.appendChild(nav);

    var scene = document.createElement("div");
    scene.className = "flip-scene";

    var card = document.createElement("button");
    card.type = "button";
    card.className = "flip-card";
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");
    card.setAttribute("aria-pressed", "false");
    card.setAttribute("aria-label", "Flip card for " + (player.full_name || "player") + " to see profile notes");

    card.appendChild(buildCardFront(player));
    var cardBack = buildCardBack(player);
    card.appendChild(cardBack);

    // EDIT (SPRO-134 fixup): the back face's links are real DOM children of
    // the card even while the front face is showing -- backface-visibility
    // and (under prefers-reduced-motion) opacity/visibility hide them
    // visually but do not remove them from the tab order. Keep them out of
    // the tab order and hidden from AT until the card is actually flipped.
    var backLinks = cardBack.querySelectorAll(".card-links a");

    function setBackLinksFocusable(focusable) {
      for (var i = 0; i < backLinks.length; i++) {
        if (focusable) {
          backLinks[i].setAttribute("tabindex", "0");
          backLinks[i].removeAttribute("aria-hidden");
        } else {
          backLinks[i].setAttribute("tabindex", "-1");
          backLinks[i].setAttribute("aria-hidden", "true");
        }
      }
    }
    setBackLinksFocusable(false);

    function toggleFlip() {
      var flipped = card.classList.toggle("is-flipped");
      card.setAttribute("aria-pressed", flipped ? "true" : "false");
      setBackLinksFocusable(flipped);
    }

    card.addEventListener("click", toggleFlip);
    card.addEventListener("keydown", function (evt) {
      // EDIT (SPRO-134 fixup): only the card itself should trigger flip/nav
      // on Enter/Space/arrows. Without this guard, keydown events bubbling
      // up from a focused back-face link (e.g. Enter to activate it) hit
      // this handler too, which preventDefault()s the link's activation and
      // flips the card out from under the user's focus.
      if (evt.target !== card) { return; }
      if (evt.key === "Enter" || evt.key === " " || evt.key === "Spacebar") {
        evt.preventDefault();
        toggleFlip();
      } else if (evt.key === "ArrowLeft") {
        goToIndex(ids, currentIndex - 1);
      } else if (evt.key === "ArrowRight") {
        goToIndex(ids, currentIndex + 1);
      }
    });

    /* Tilt lives on a wrapper so it composes with -- rather than fights --
       the rotateY(180deg) the card itself uses to flip. */
    var tilt = document.createElement("div");
    tilt.className = "flip-tilt";
    tilt.appendChild(card);
    scene.appendChild(tilt);
    wrap.appendChild(scene);

    attachRefractor(scene, tilt);
    viewEl.appendChild(wrap);

    wireSwipe(scene, function () { goToIndex(ids, currentIndex - 1); },
      function () { goToIndex(ids, currentIndex + 1); });

    document.addEventListener("keydown", documentArrowHandler);
    function documentArrowHandler(evt) {
      if (document.activeElement === card) { return; } // handled above already
      if (evt.key === "ArrowLeft") { goToIndex(ids, currentIndex - 1); }
      if (evt.key === "ArrowRight") { goToIndex(ids, currentIndex + 1); }
    }
    // Clean up the document-level listener when navigating away.
    window.addEventListener("hashchange", function cleanup() {
      document.removeEventListener("keydown", documentArrowHandler);
      window.removeEventListener("hashchange", cleanup);
    });

    card.focus();
  }

  function goToIndex(ids, index) {
    if (index < 0 || index >= ids.length) { return; }
    window.location.hash = "#/player/" + encodeURIComponent(ids[index]);
  }

  function wireSwipe(el, onSwipeLeft, onSwipeRight) {
    var startX = null;
    var startY = null;
    el.addEventListener("touchstart", function (evt) {
      var t = evt.changedTouches[0];
      startX = t.clientX;
      startY = t.clientY;
    }, { passive: true });
    el.addEventListener("touchend", function (evt) {
      if (startX === null) { return; }
      var t = evt.changedTouches[0];
      var dx = t.clientX - startX;
      var dy = t.clientY - startY;
      startX = null;
      startY = null;
      if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) { return; }
      if (dx < 0) { onSwipeLeft(); } else { onSwipeRight(); }
    }, { passive: true });
  }

  // ------------------------------------------------------- card faces

  /* Refractor: the card tilts toward the pointer and a prismatic highlight
     tracks it. Both are driven by CSS custom properties so the paint work
     stays on the compositor. Disabled outright under reduced motion. */
  function attachRefractor(scene, tilt) {
    var calm = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (calm.matches) { return; }

    var sheens = tilt.querySelectorAll(".sheen");

    function move(e) {
      var r = tilt.getBoundingClientRect();
      if (!r.width || !r.height) { return; }
      var x = (e.clientX - r.left) / r.width;
      var y = (e.clientY - r.top) / r.height;
      tilt.classList.add("is-live");
      tilt.style.setProperty("--ry", ((x - 0.5) * 14).toFixed(2) + "deg");
      tilt.style.setProperty("--rx", ((y - 0.5) * -11).toFixed(2) + "deg");
      for (var i = 0; i < sheens.length; i++) {
        sheens[i].style.setProperty("--mx", (x * 100).toFixed(1) + "%");
        sheens[i].style.setProperty("--my", (y * 100).toFixed(1) + "%");
        sheens[i].style.setProperty("--sheen", "1");
      }
    }

    function rest() {
      tilt.classList.remove("is-live");
      tilt.style.setProperty("--rx", "0deg");
      tilt.style.setProperty("--ry", "0deg");
      for (var i = 0; i < sheens.length; i++) {
        sheens[i].style.setProperty("--sheen", "0");
      }
    }

    scene.addEventListener("pointermove", move);
    scene.addEventListener("pointerleave", rest);
    scene.addEventListener("pointercancel", rest);
  }

  function buildCardFront(player) {
    var front = document.createElement("div");
    front.className = "flip-card__face flip-card__face--front";

    var scroll = document.createElement("div");
    scroll.className = "flip-card__scroll";

    var sheen = document.createElement("div");
    sheen.className = "sheen";
    scroll.appendChild(sheen);

    scroll.appendChild(buildCardRail(player));

    var headshot = createHeadshotEl(player);
    appendCardBadges(headshot, player, true);
    scroll.appendChild(headshot);

    var plate = document.createElement("div");
    plate.className = "card-plate";
    var name = document.createElement("h2");
    name.className = "player-name";
    fillPlayerName(name, player.full_name);
    plate.appendChild(name);
    scroll.appendChild(plate);

    var list = document.createElement("ul");
    list.className = "detail-list";

    /* Position is omitted here on purpose -- the tab on the photo already
       carries it in full. */
    appendDetail(list, "Years in league", formatExperience(player));
    appendDetail(list, "College", player.college);
    appendDetail(list, "Height / Weight", formatHeightWeight(player));
    appendDetail(list, "Age", player.age);

    scroll.appendChild(list);

    // Draft is provenance, not a physical attribute -- own strip.
    var draft = document.createElement("div");
    draft.className = "draft-strip";
    var draftLabel = document.createElement("span");
    draftLabel.className = "label";
    draftLabel.textContent = "Draft";
    var draftValue = document.createElement("span");
    draftValue.className = "value";
    draftValue.textContent = formatDraft(player);
    draft.appendChild(draftLabel);
    draft.appendChild(draftValue);
    scroll.appendChild(draft);

    front.appendChild(scroll);

    return front;
  }

  function buildCardBack(player) {
    var back = document.createElement("div");
    back.className = "flip-card__face flip-card__face--back";

    var scroll = document.createElement("div");
    scroll.className = "flip-card__scroll";

    var notesHeading = document.createElement("p");
    notesHeading.className = "notes-heading";
    notesHeading.textContent = "Auto-generated profile notes.";
    scroll.appendChild(notesHeading);

    var strengths = document.createElement("p");
    strengths.className = "notes-block";
    strengths.innerHTML = "<strong>Strengths:</strong> " + escapeHtml(player.strengths || "Not available.");
    scroll.appendChild(strengths);

    var weaknesses = document.createElement("p");
    weaknesses.className = "notes-block";
    weaknesses.innerHTML = "<strong>Areas to watch:</strong> " + escapeHtml(player.weaknesses || "Not available.");
    scroll.appendChild(weaknesses);

    var links = buildCardLinks(player);
    if (links) { scroll.appendChild(links); }

    back.appendChild(scroll);

    return back;
  }

  // EDIT 5 (SPRO-134): back-face links -- Chiefs.com profile (slug derived
  // from full_name; roster.json has no slug field) and an X/Twitter search
  // link (roster.json has no social handles, so this is a labeled search,
  // not a fabricated profile URL). Built with DOM APIs (createElement +
  // .href/.textContent), never innerHTML, since these values ultimately
  // derive from player data.
  function playerSlug(player) {
    var name = ((player && player.full_name) || "").trim();
    if (!name) { return ""; }
    var normalized = name.normalize ? name.normalize("NFD") : name;
    normalized = normalized.replace(/[\u0300-\u036f]/g, ""); // strip diacritics
    var slug = normalized
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return slug;
  }

  function buildCardLinks(player) {
    var fullName = (player.full_name || "").trim();
    if (!fullName) { return null; }

    var container = document.createElement("div");
    container.className = "card-links";

    var slug = playerSlug(player);
    if (slug) {
      var profileLink = document.createElement("a");
      profileLink.href = "https://www.chiefs.com/team/players-roster/" + slug + "/";
      profileLink.textContent = "Chiefs.com profile";
      profileLink.target = "_blank";
      profileLink.rel = "noopener noreferrer";
      profileLink.addEventListener("click", function (evt) { evt.stopPropagation(); });
      container.appendChild(profileLink);
    }

    var socialsLink = document.createElement("a");
    socialsLink.href = "https://x.com/search?q=" + encodeURIComponent(fullName + " Chiefs");
    socialsLink.textContent = "Search socials";
    socialsLink.target = "_blank";
    socialsLink.rel = "noopener noreferrer";
    socialsLink.addEventListener("click", function (evt) { evt.stopPropagation(); });
    container.appendChild(socialsLink);

    return container;
  }

  function appendDetail(list, label, value) {
    var li = document.createElement("li");
    var labelEl = document.createElement("span");
    labelEl.className = "label";
    labelEl.textContent = label;
    var valueEl = document.createElement("span");
    valueEl.className = "value";
    valueEl.textContent = (value === null || value === undefined || value === "") ? "Unknown" : String(value);
    li.appendChild(labelEl);
    li.appendChild(valueEl);
    list.appendChild(li);
  }

  function formatExperience(player) {
    if (player.display_experience) { return player.display_experience; }
    if (player.experience_years === 0) { return "Rookie"; }
    if (typeof player.experience_years === "number") {
      return player.experience_years + (player.experience_years === 1 ? " season" : " seasons");
    }
    return null;
  }

  function formatHeightWeight(player) {
    var h = player.display_height;
    var w = player.display_weight;
    if (h && w) { return h + " / " + w; }
    return h || w || null;
  }

  function formatDraft(player) {
    var draft = player.draft || {};
    if (draft.display) { return draft.display; }
    if (draft.is_undrafted === true) { return "Undrafted"; }
    return null;
  }

  // ------------------------------------------------------------ number pad

  function renderPadView() {
    state.padDigits = "";
    viewEl.innerHTML = "";

    var wrap = document.createElement("div");
    wrap.className = "pad-view";

    var back = document.createElement("a");
    back.className = "back-link";
    back.href = "#/grid";
    back.textContent = "← Back to roster";
    wrap.appendChild(back);

    var heading = document.createElement("h2");
    heading.textContent = "Find by jersey number";
    wrap.appendChild(heading);

    var display = document.createElement("div");
    display.className = "pad-display";
    display.setAttribute("aria-live", "polite");
    display.textContent = "#";
    wrap.appendChild(display);

    var padGrid = document.createElement("div");
    padGrid.className = "pad-grid";

    var resultsEl = document.createElement("div");
    resultsEl.className = "pad-results";

    function updateDisplay() {
      display.textContent = "#" + state.padDigits;
    }

    function renderPlayerButton(container, p) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pad-result-item";
      btn.textContent = "#" + p.jersey + " " + p.full_name + " -- " + (p.position_abbrev || "");
      btn.addEventListener("click", function () {
        window.location.hash = "#/player/" + encodeURIComponent(p.id);
      });
      container.appendChild(btn);
    }

    function updateLivePreview() {
      // Live, non-navigating preview of candidates matching the digits typed
      // so far (as a number prefix). Pressing "Go" performs the exact match.
      resultsEl.innerHTML = "";
      if (!state.padDigits) { return; }
      var candidates = state.players.filter(function (p) {
        return p.jersey_number !== null && String(p.jersey_number).indexOf(state.padDigits) === 0;
      });
      if (candidates.length === 0) { return; }
      var heading2 = document.createElement("p");
      heading2.textContent = "Possible matches:";
      resultsEl.appendChild(heading2);
      candidates.forEach(function (p) { renderPlayerButton(resultsEl, p); });
    }

    function showResults() {
      resultsEl.innerHTML = "";
      if (!state.padDigits) { return; }
      var num = parseInt(state.padDigits, 10);
      var matches = state.players.filter(function (p) { return p.jersey_number === num; });

      if (matches.length === 0) {
        var none = document.createElement("p");
        none.textContent = "No player wearing #" + state.padDigits + " on this roster.";
        resultsEl.appendChild(none);
        return;
      }

      if (matches.length === 1) {
        window.location.hash = "#/player/" + encodeURIComponent(matches[0].id);
        return;
      }

      var heading2 = document.createElement("p");
      heading2.textContent = matches.length + " players wear #" + state.padDigits + ". Choose one:";
      resultsEl.appendChild(heading2);
      matches.forEach(function (p) { renderPlayerButton(resultsEl, p); });
    }

    function addDigit(d) {
      if (state.padDigits.length >= 2) { return; }
      state.padDigits += d;
      updateDisplay();
      updateLivePreview();
    }

    var keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "go"];
    keys.forEach(function (key) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pad-key";
      if (key === "clear") {
        btn.textContent = "Clear";
        btn.addEventListener("click", function () {
          state.padDigits = "";
          updateDisplay();
          resultsEl.innerHTML = "";
        });
        btn.setAttribute("aria-label", "Clear jersey number entry");
      } else if (key === "go") {
        btn.textContent = "Go";
        btn.classList.add("pad-key--go");
        btn.addEventListener("click", showResults);
      } else {
        btn.textContent = key;
        btn.addEventListener("click", function () { addDigit(key); });
      }
      padGrid.appendChild(btn);
    });

    wrap.appendChild(padGrid);
    wrap.appendChild(resultsEl);
    viewEl.appendChild(wrap);
  }

  // ------------------------------------------------------------- startup

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
