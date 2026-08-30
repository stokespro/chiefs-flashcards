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
    filterPosition: "All",
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

  /* The header now carries navigation only -- the search field and position
     chips moved into the roster body, where they are built by
     getRosterFilters(). */
  function wireHeader() {
    var rosterButton = document.getElementById("rosterButton");
    rosterButton.addEventListener("click", function () {
      window.location.hash = "#/grid";
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
    /* Navigating from a scrolled roster used to land mid-card. */
    window.scrollTo(0, 0);
  }

  function renderCurrentView() {
    var r = getRoute();
    if (r.name === "player") {
      renderPlayerView(r.id);
    } else if (r.name === "pad") {
      renderPadView();
    } else {
      renderGridView();
    }
  }

  // ------------------------------------------------------------ data util


  function matchesPosition(player, position) {
    if (position === "All") { return true; }
    return player.position_abbrev === position;
  }

  function matchesGroup(player, group) {
    if (group === "All") { return true; }
    return player.position_group === group;
  }

  function matchesName(player, needle) {
    if (!needle) { return true; }
    var haystack = ((player.full_name || "") + " " + (player.short_name || "")).toLowerCase();
    return haystack.indexOf(needle.toLowerCase()) !== -1;
  }

  function getFilteredPlayers() {
    return state.players.filter(function (p) {
      return matchesGroup(p, state.filterGroup)
        && matchesPosition(p, state.filterPosition)
        && matchesName(p, state.filterName);
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

  /* Deep link to the Biography section of the club profile. Cross-origin
     pages can only be scrolled via a URL fragment -- there is no way to
     drive another site's scroll position from here -- so this depends on
     chiefs.com actually exposing an element with this id. Verify in devtools
     and change this one constant if the id differs; a wrong fragment is
     harmless (the page just opens at the top). */
  var BIO_HASH = "#biography";

  function buildRailActions(player) {
    var actions = document.createElement("div");
    actions.className = "card-rail__actions";

    var fullName = (player.full_name || "").trim();
    var slug = playerSlug(player);

    if (slug) {
      var bio = document.createElement("a");
      bio.className = "rail-btn";
      bio.href = "https://www.chiefs.com/team/players-roster/" + slug + "/" + BIO_HASH;
      bio.textContent = "Bio";
      bio.target = "_blank";
      bio.rel = "noopener noreferrer";
      bio.setAttribute("aria-label", "Read " + (fullName || "player") + "'s biography on Chiefs.com");
      actions.appendChild(bio);
    }

    if (fullName) {
      var x = document.createElement("a");
      x.className = "rail-btn rail-btn--x";
      x.href = "https://x.com/search?q=" + encodeURIComponent(fullName + " Chiefs");
      // Inline SVG rather than a glyph: the X mark has no Unicode codepoint,
      // and "\u2715" (a multiplication cross) only approximated it.
      x.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
        '<path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817' +
        'L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52' +
        'h1.833L7.084 4.126H5.117z"></path></svg>';
      x.target = "_blank";
      x.rel = "noopener noreferrer";
      x.setAttribute("aria-label", "Search X for " + fullName);
      actions.appendChild(x);
    }

    return actions;
  }

  // Top rail: arrowhead, team wordmark, and the Bio / X actions.
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

    rail.appendChild(buildRailActions(player));

    return rail;
  }

  // ---------------------------------------------------------------- grid

  var GROUPS = ["All", "Offense", "Defense", "Special Teams"];

  /* Depth-chart order, not alphabetical -- QB before C reads correctly to
     anyone who follows football. Anything unrecognised sorts to the end. */
  var POSITION_ORDER = ["QB", "RB", "FB", "WR", "TE", "OT", "G", "C", "OL",
                        "DE", "DT", "NT", "LB", "ILB", "OLB", "CB", "S", "FS",
                        "SS", "PK", "K", "P", "LS"];

  /* A sub-row only earns its vertical space when it meaningfully narrows the
     list. Special Teams is three players across three positions -- four chips
     to filter three cards is worse than no chips at all. */
  var SUB_FILTER_MIN_PLAYERS = 6;
  var SUB_FILTER_MIN_POSITIONS = 2;

  function positionsInGroup(group) {
    if (group === "All") { return []; }
    var counts = {};
    state.players.forEach(function (p) {
      if (!matchesGroup(p, group)) { return; }
      var pos = p.position_abbrev;
      if (!pos) { return; }
      counts[pos] = (counts[pos] || 0) + 1;
    });

    var total = 0;
    var list = Object.keys(counts).map(function (pos) {
      total += counts[pos];
      return { pos: pos, count: counts[pos] };
    });

    if (total < SUB_FILTER_MIN_PLAYERS || list.length < SUB_FILTER_MIN_POSITIONS) {
      return [];
    }

    list.sort(function (a, b) {
      var ai = POSITION_ORDER.indexOf(a.pos);
      var bi = POSITION_ORDER.indexOf(b.pos);
      if (ai === -1) { ai = POSITION_ORDER.length; }
      if (bi === -1) { bi = POSITION_ORDER.length; }
      if (ai !== bi) { return ai - bi; }
      return a.pos.localeCompare(b.pos);
    });
    return list;
  }

  /* The filter bar is built once and cached. Typing in the search field
     re-renders the roster, so if the bar were rebuilt each pass the focused
     input would be destroyed mid-keystroke and lose both focus and caret.
     Navigating away detaches this node but does not discard it -- the same
     element (and its listeners) is re-appended on return, which is also how
     the current filters survive a round trip to a player card. */
  var rosterFiltersEl = null;

  function getRosterFilters() {
    if (rosterFiltersEl) { return rosterFiltersEl; }

    var bar = document.createElement("div");
    bar.className = "roster-filters";

    var label = document.createElement("label");
    label.className = "visually-hidden";
    label.setAttribute("for", "nameFilter");
    label.textContent = "Filter players by name";
    bar.appendChild(label);

    var input = document.createElement("input");
    input.type = "search";
    input.id = "nameFilter";
    input.className = "roster-search";
    input.placeholder = "Find a player by name...";
    input.autocomplete = "off";
    input.value = state.filterName || "";
    input.addEventListener("input", function () {
      state.filterName = input.value || "";
      renderGridView();
    });
    bar.appendChild(input);

    var chipRow = document.createElement("div");
    chipRow.className = "chip-row";
    chipRow.setAttribute("role", "group");
    chipRow.setAttribute("aria-label", "Filter by position group");

    GROUPS.forEach(function (group) {
      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.setAttribute("data-group", group);
      chip.setAttribute("aria-pressed", state.filterGroup === group ? "true" : "false");
      chip.textContent = group;
      chipRow.appendChild(chip);
    });

    var subRow = document.createElement("div");
    subRow.className = "chip-row chip-row--sub";
    subRow.setAttribute("role", "group");
    subRow.setAttribute("aria-label", "Filter by position");

    function renderSubRow() {
      subRow.innerHTML = "";
      var positions = positionsInGroup(state.filterGroup);
      subRow.hidden = positions.length === 0;
      if (subRow.hidden) { return; }

      var all = document.createElement("button");
      all.type = "button";
      all.className = "chip chip--sub";
      all.setAttribute("data-position", "All");
      all.setAttribute("aria-pressed", state.filterPosition === "All" ? "true" : "false");
      all.textContent = "All " + state.filterGroup;
      subRow.appendChild(all);

      positions.forEach(function (entry) {
        var chip = document.createElement("button");
        chip.type = "button";
        chip.className = "chip chip--sub";
        chip.setAttribute("data-position", entry.pos);
        chip.setAttribute("aria-pressed", state.filterPosition === entry.pos ? "true" : "false");
        chip.textContent = entry.pos;
        var count = document.createElement("span");
        count.className = "chip__count";
        count.textContent = entry.count;
        chip.appendChild(count);
        subRow.appendChild(chip);
      });
    }

    chipRow.addEventListener("click", function (evt) {
      var btn = evt.target.closest(".chip");
      if (!btn) { return; }
      state.filterGroup = btn.getAttribute("data-group");
      // A position from the old group would match nothing in the new one.
      state.filterPosition = "All";
      var chips = chipRow.querySelectorAll(".chip");
      for (var i = 0; i < chips.length; i++) {
        chips[i].setAttribute("aria-pressed", chips[i] === btn ? "true" : "false");
      }
      renderSubRow();
      renderGridView();
    });

    subRow.addEventListener("click", function (evt) {
      var btn = evt.target.closest(".chip");
      if (!btn) { return; }
      state.filterPosition = btn.getAttribute("data-position");
      var chips = subRow.querySelectorAll(".chip");
      for (var i = 0; i < chips.length; i++) {
        chips[i].setAttribute("aria-pressed", chips[i] === btn ? "true" : "false");
      }
      renderGridView();
    });

    bar.appendChild(chipRow);
    bar.appendChild(subRow);
    renderSubRow();

    rosterFiltersEl = bar;
    return bar;
  }

  function renderGridView() {
    var players = getFilteredPlayers();
    state.lastFilteredIds = players.map(function (p) { return p.id; });

    // Rebuild the scaffold only when it is not already mounted; otherwise
    // swap the results alone and leave the filter bar (and focus) intact.
    var results = document.getElementById("rosterResults");
    if (!results || !viewEl.contains(results)) {
      viewEl.innerHTML = "";
      viewEl.appendChild(getRosterFilters());
      results = document.createElement("div");
      results.id = "rosterResults";
      viewEl.appendChild(results);
    }

    results.innerHTML = "";

    if (players.length === 0) {
      var empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "No players match your search.";
      results.appendChild(empty);
      return;
    }

    var grid = document.createElement("div");
    grid.className = "grid";

    players.forEach(function (player) {
      grid.appendChild(buildTile(player));
    });

    results.appendChild(grid);
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


    var scene = document.createElement("div");
    scene.className = "card-scene";

    /* A plain div, not a <button>: the card no longer toggles anything, and
       it now contains its own links (Bio / X), which cannot legally nest
       inside a button. */
    var card = document.createElement("div");
    card.className = "player-card";
    card.appendChild(buildCardFront(player));

    // Tilt lives on its own wrapper so the transform is independent of the
    // card's own layout.
    var tilt = document.createElement("div");
    tilt.className = "card-tilt";
    tilt.appendChild(card);
    scene.appendChild(tilt);
    wrap.appendChild(scene);

    attachRefractor(scene, tilt);
    viewEl.appendChild(wrap);

    wireSwipe(scene, function () { goToIndex(ids, currentIndex - 1); },
      function () { goToIndex(ids, currentIndex + 1); });

    document.addEventListener("keydown", documentArrowHandler);
    function documentArrowHandler(evt) {
      // Don't hijack arrows while the user is typing in the roster search.
      var tag = (document.activeElement && document.activeElement.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA") { return; }
      if (evt.key === "ArrowLeft") { goToIndex(ids, currentIndex - 1); }
      if (evt.key === "ArrowRight") { goToIndex(ids, currentIndex + 1); }
    }
    // Clean up the document-level listener when navigating away.
    window.addEventListener("hashchange", function cleanup() {
      document.removeEventListener("keydown", documentArrowHandler);
      window.removeEventListener("hashchange", cleanup);
    });
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
    front.className = "player-card__face";

    var scroll = document.createElement("div");
    scroll.className = "player-card__body";

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
