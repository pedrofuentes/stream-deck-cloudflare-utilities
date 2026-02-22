/**
 * FilterableSelect — Searchable dropdown component for Stream Deck Property Inspector.
 *
 * Adapted from the GitHub Utilities implementation for the Cloudflare Utilities plugin.
 * Unlike the GitHub version (which uses sendToPlugin/sdpi-datasource for data loading),
 * this version uses callback-based patterns since Cloudflare PIs fetch API data directly.
 *
 * Features:
 *   - Search/filter input (auto-shown when items exceed threshold)
 *   - Keyboard navigation (Arrow keys, Enter, Escape)
 *   - Viewport-aware dropdown positioning (flips up when near bottom)
 *   - Matches Stream Deck PI dark theme
 *   - Refresh button with spin animation
 *   - Dispatches 'change' CustomEvent on container for external listeners
 *   - Result count footer when filtering
 *
 * Usage:
 *   const fs = new FilterableSelect({
 *     container: document.getElementById('myContainer'),
 *     setting: 'workerName',
 *     placeholder: '-- Select Worker --',
 *     searchPlaceholder: 'Search workers…',
 *     threshold: 8,
 *     initialValue: actionSettings.workerName || '',
 *     onRefresh: function() { loadWorkers(); },
 *     onChange: function(value, label) { ... },
 *   });
 *
 *   // After loading data:
 *   fs.setItems([{ value: 'my-worker', label: 'my-worker' }, ...]);
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */
(function () {
  "use strict";

  // ── Default threshold ───────────────────────────────────────────
  var DEFAULT_THRESHOLD = 8;

  // ── CSS (injected once into <head>) ─────────────────────────────
  var STYLES = [
    /* Container wraps trigger row; dropdown is portalled to body */
    ".fs-container {",
    "  position: relative;",
    "  width: 100%;",
    "}",

    /* Trigger row: combobox button + optional refresh */
    ".fs-trigger-row {",
    "  display: flex;",
    "  gap: 4px;",
    "  align-items: stretch;",
    "}",

    /* Combobox trigger button */
    ".fs-trigger {",
    "  flex: 1;",
    "  display: flex;",
    "  align-items: center;",
    "  justify-content: space-between;",
    "  background: var(--bg-input, #3d3d3d);",
    "  border: 1px solid var(--border, transparent);",
    "  border-radius: 3px;",
    "  color: var(--text, #d8d8d8);",
    "  padding: 4px 8px;",
    "  font-size: 12px;",
    "  font-family: var(--font, inherit);",
    "  cursor: pointer;",
    "  min-height: 26px;",
    "  text-align: left;",
    "  line-height: 1.3;",
    "  transition: border-color 0.15s;",
    "  box-sizing: border-box;",
    "  -webkit-appearance: none;",
    "  appearance: none;",
    "}",
    ".fs-trigger:hover {",
    "  border-color: #666;",
    "}",
    ".fs-trigger:focus {",
    "  outline: none;",
    "  border-color: var(--accent, #0078d4);",
    "}",
    ".fs-trigger .fs-label {",
    "  flex: 1;",
    "  overflow: hidden;",
    "  text-overflow: ellipsis;",
    "  white-space: nowrap;",
    "}",
    ".fs-trigger .fs-arrow {",
    "  margin-left: 6px;",
    "  font-size: 9px;",
    "  color: #999;",
    "  flex-shrink: 0;",
    "  transition: transform 0.2s;",
    "}",
    ".fs-trigger.open .fs-arrow {",
    "  transform: rotate(180deg);",
    "}",
    ".fs-trigger .fs-placeholder {",
    "  color: var(--text-muted, #888);",
    "}",

    /* Refresh button */
    ".fs-refresh {",
    "  background: var(--bg-input, #3d3d3d);",
    "  border: 1px solid var(--border, transparent);",
    "  border-radius: 3px;",
    "  color: #999;",
    "  cursor: pointer;",
    "  padding: 0 5px;",
    "  font-size: 14px;",
    "  line-height: 1;",
    "  transition: background 0.15s, color 0.15s;",
    "  flex-shrink: 0;",
    "  display: flex;",
    "  align-items: center;",
    "}",
    ".fs-refresh:hover {",
    "  color: #e0e0e0;",
    "  border-color: #666;",
    "}",
    ".fs-refresh.spinning {",
    "  animation: fs-spin 0.6s linear infinite;",
    "  pointer-events: none;",
    "}",
    "@keyframes fs-spin {",
    "  from { transform: rotate(0deg); }",
    "  to   { transform: rotate(360deg); }",
    "}",

    /* Dropdown panel — portalled to body, positioned with fixed */
    ".fs-dropdown {",
    "  position: fixed;",
    "  z-index: 9999;",
    "  background: #252525;",
    "  border: 1px solid #555;",
    "  border-radius: 6px;",
    "  box-shadow: 0 8px 24px rgba(0,0,0,0.5);",
    "  display: none;",
    "  overflow: hidden;",
    "}",
    ".fs-dropdown.open {",
    "  display: flex;",
    "  flex-direction: column;",
    "}",
    ".fs-dropdown.flip-up {",
    "  flex-direction: column-reverse;",
    "}",
    ".fs-dropdown.flip-up .fs-search {",
    "  border-bottom: none;",
    "  border-top: 1px solid #444;",
    "}",
    ".fs-dropdown.flip-up .fs-count {",
    "  border-top: none;",
    "  border-bottom: 1px solid #333;",
    "}",

    /* Search input at top of dropdown */
    ".fs-search {",
    "  display: block;",
    "  width: 100%;",
    "  box-sizing: border-box;",
    "  background: #1a1a1a;",
    "  border: none;",
    "  border-bottom: 1px solid #444;",
    "  color: #e0e0e0;",
    "  padding: 8px 10px;",
    "  font-size: 12px;",
    "  font-family: inherit;",
    "  outline: none;",
    "}",
    ".fs-search::placeholder {",
    "  color: #666;",
    "}",
    ".fs-search.hidden {",
    "  display: none;",
    "}",

    /* Scrollable option list */
    ".fs-list {",
    "  max-height: 180px;",
    "  overflow-y: auto;",
    "  overflow-x: hidden;",
    "  scrollbar-width: thin;",
    "  scrollbar-color: #555 #252525;",
    "}",
    ".fs-list::-webkit-scrollbar {",
    "  width: 6px;",
    "}",
    ".fs-list::-webkit-scrollbar-track {",
    "  background: #252525;",
    "}",
    ".fs-list::-webkit-scrollbar-thumb {",
    "  background: #555;",
    "  border-radius: 3px;",
    "}",

    /* Individual option */
    ".fs-option {",
    "  padding: 6px 10px;",
    "  cursor: pointer;",
    "  font-size: 12px;",
    "  color: #d0d0d0;",
    "  white-space: nowrap;",
    "  overflow: hidden;",
    "  text-overflow: ellipsis;",
    "  transition: background 0.1s;",
    "}",
    ".fs-option:hover,",
    ".fs-option.highlighted {",
    "  background: #383838;",
    "  color: #f0f0f0;",
    "}",
    ".fs-option.selected {",
    "  background: #264f78;",
    "  color: #58a6ff;",
    "}",
    ".fs-option.selected:hover,",
    ".fs-option.selected.highlighted {",
    "  background: #2d5a8a;",
    "}",

    /* Empty state */
    ".fs-empty {",
    "  padding: 12px 10px;",
    "  text-align: center;",
    "  color: #666;",
    "  font-size: 11px;",
    "}",

    /* Result count footer */
    ".fs-count {",
    "  padding: 4px 10px;",
    "  font-size: 10px;",
    "  color: #666;",
    "  border-top: 1px solid #333;",
    "  text-align: right;",
    "}",
  ].join("\n");

  var stylesInjected = false;
  function injectStyles() {
    if (stylesInjected) return;
    var style = document.createElement("style");
    style.textContent = STYLES;
    document.head.appendChild(style);
    stylesInjected = true;
  }

  // ── FilterableSelect Class ──────────────────────────────────────

  /**
   * Creates a filterable/searchable dropdown.
   *
   * @param {Object}      options
   * @param {HTMLElement}  options.container       - DOM element to mount into
   * @param {string}       options.setting         - Setting key name (used for dispatched events)
   * @param {string}       [options.placeholder='Select…']       - Trigger placeholder
   * @param {string}       [options.searchPlaceholder='Type to filter…'] - Search placeholder
   * @param {number}       [options.threshold=8]   - Show search when selectable items > N
   * @param {string}       [options.initialValue]  - Initial selected value
   * @param {function}     [options.onRefresh]     - Called when refresh button is clicked
   * @param {function}     [options.onSelect]      - Called on every selection: (value, label) => void
   * @param {function}     [options.onChange]       - Called only when value changes: (value, label) => void
   */
  function FilterableSelect(options) {
    injectStyles();

    this.setting = options.setting;
    this.placeholder = options.placeholder || "Select…";
    this.searchPlaceholder = options.searchPlaceholder || "Type to filter…";
    this.threshold =
      options.threshold != null ? options.threshold : DEFAULT_THRESHOLD;
    this.onRefreshCb = options.onRefresh || null;
    this.onSelectCb = options.onSelect || null;
    this.onChangeCb = options.onChange || null;

    this.items = [];
    this.filteredItems = [];
    this.selectedValue = "";
    this.selectedLabel = "";
    this.isOpen = false;
    this.highlightedIndex = -1;

    this._container = options.container;
    this._wrapper = null;
    this._trigger = null;
    this._triggerLabel = null;
    this._dropdown = null;
    this._searchInput = null;
    this._list = null;
    this._emptyMsg = null;
    this._countLabel = null;
    this._refreshBtn = null;

    this._build();
    this._bindEvents();

    // Set initial value if provided
    if (options.initialValue) {
      this.selectedValue = String(options.initialValue);
      this.selectedLabel = this.selectedValue;
      this._updateTriggerDisplay();
    }
  }

  // ── DOM Construction ────────────────────────────────────────────

  FilterableSelect.prototype._build = function () {
    this._wrapper = document.createElement("div");
    this._wrapper.className = "fs-container";

    // Trigger row
    var triggerRow = document.createElement("div");
    triggerRow.className = "fs-trigger-row";

    this._trigger = document.createElement("button");
    this._trigger.className = "fs-trigger";
    this._trigger.type = "button";
    this._trigger.setAttribute("role", "combobox");
    this._trigger.setAttribute("aria-haspopup", "listbox");
    this._trigger.setAttribute("aria-expanded", "false");

    this._triggerLabel = document.createElement("span");
    this._triggerLabel.className = "fs-label fs-placeholder";
    this._triggerLabel.textContent = this.placeholder;

    var arrow = document.createElement("span");
    arrow.className = "fs-arrow";
    arrow.textContent = "▾";

    this._trigger.appendChild(this._triggerLabel);
    this._trigger.appendChild(arrow);
    triggerRow.appendChild(this._trigger);

    // Refresh button
    this._refreshBtn = document.createElement("button");
    this._refreshBtn.className = "fs-refresh";
    this._refreshBtn.type = "button";
    this._refreshBtn.title = "Refresh";
    this._refreshBtn.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6"/><path d="M21.34 13a10 10 0 1 1-2.83-7.83L21.5 8"/></svg>';
    triggerRow.appendChild(this._refreshBtn);

    this._wrapper.appendChild(triggerRow);
    this._container.appendChild(this._wrapper);

    // Dropdown (portalled to body for overflow safety)
    this._dropdown = document.createElement("div");
    this._dropdown.className = "fs-dropdown";
    this._dropdown.setAttribute("role", "listbox");

    this._searchInput = document.createElement("input");
    this._searchInput.className = "fs-search hidden";
    this._searchInput.type = "text";
    this._searchInput.placeholder = this.searchPlaceholder;
    this._searchInput.setAttribute("autocomplete", "off");
    this._searchInput.setAttribute("spellcheck", "false");
    this._dropdown.appendChild(this._searchInput);

    this._list = document.createElement("div");
    this._list.className = "fs-list";
    this._dropdown.appendChild(this._list);

    this._emptyMsg = document.createElement("div");
    this._emptyMsg.className = "fs-empty";
    this._emptyMsg.textContent = "No matches found";
    this._emptyMsg.style.display = "none";
    this._dropdown.appendChild(this._emptyMsg);

    this._countLabel = document.createElement("div");
    this._countLabel.className = "fs-count";
    this._countLabel.style.display = "none";
    this._dropdown.appendChild(this._countLabel);

    document.body.appendChild(this._dropdown);
  };

  // ── Event Binding ───────────────────────────────────────────────

  FilterableSelect.prototype._bindEvents = function () {
    var self = this;

    // Toggle dropdown on trigger click
    this._trigger.addEventListener("click", function (e) {
      e.stopPropagation();
      self.toggle();
    });

    // Filter input
    this._searchInput.addEventListener("input", function () {
      self._applyFilter();
    });
    this._searchInput.addEventListener("keydown", function (e) {
      self._handleKeydown(e);
    });

    // Also allow keyboard on trigger when dropdown is closed
    this._trigger.addEventListener("keydown", function (e) {
      if (
        !self.isOpen &&
        (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ")
      ) {
        e.preventDefault();
        self.open();
      }
    });

    // Refresh button
    this._refreshBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      self.refresh();
    });

    // Close on outside click
    document.addEventListener("click", function (e) {
      if (
        self.isOpen &&
        !self._wrapper.contains(e.target) &&
        !self._dropdown.contains(e.target)
      ) {
        self.close();
      }
    });
  };

  // ── Data ──────────────────────────────────────────────────────

  /**
   * Trigger a refresh. Shows spin animation and calls the onRefresh callback.
   */
  FilterableSelect.prototype.refresh = function () {
    if (this._refreshBtn) {
      this._refreshBtn.classList.add("spinning");
      var btn = this._refreshBtn;
      // Auto-remove spin if setItems isn't called within 10s
      this._spinTimeout = setTimeout(function () {
        btn.classList.remove("spinning");
      }, 10000);
    }
    if (this.onRefreshCb) this.onRefreshCb();
  };

  /**
   * Set the dropdown items. Call this after loading data.
   *
   * @param {Array<{value: string, label: string, disabled?: boolean}>} items
   */
  FilterableSelect.prototype.setItems = function (items) {
    this.items = (items || []).filter(function (i) {
      return i && i.value !== undefined;
    });

    // Update selected label if we now have the data
    if (this.selectedValue) {
      var match = this._findItem(this.selectedValue);
      if (match) {
        this.selectedLabel = match.label || match.value;
        this._updateTriggerDisplay();
      }
    }

    // Show/hide search based on selectable item count vs threshold
    var selectableCount = this.items.filter(function (i) {
      return !i.disabled;
    }).length;

    if (selectableCount > this.threshold) {
      this._searchInput.classList.remove("hidden");
    } else {
      this._searchInput.classList.add("hidden");
    }

    // Stop spin animation
    if (this._refreshBtn) {
      this._refreshBtn.classList.remove("spinning");
    }
    if (this._spinTimeout) {
      clearTimeout(this._spinTimeout);
      this._spinTimeout = null;
    }

    this._applyFilter();
  };

  FilterableSelect.prototype._findItem = function (value) {
    for (var i = 0; i < this.items.length; i++) {
      if (String(this.items[i].value) === String(value)) return this.items[i];
    }
    return null;
  };

  // ── Filtering ───────────────────────────────────────────────────

  FilterableSelect.prototype._applyFilter = function () {
    var query = (this._searchInput.value || "").toLowerCase().trim();

    if (!query) {
      this.filteredItems = this.items.slice();
    } else {
      this.filteredItems = this.items.filter(function (item) {
        var label = (item.label || "").toLowerCase();
        var value = (item.value || "").toLowerCase();
        return label.indexOf(query) !== -1 || value.indexOf(query) !== -1;
      });
    }

    this.highlightedIndex = -1;
    this._renderList();
  };

  FilterableSelect.prototype._renderList = function () {
    this._list.innerHTML = "";
    var self = this;

    if (this.filteredItems.length === 0) {
      this._emptyMsg.style.display = "block";
      this._countLabel.style.display = "none";
      return;
    }

    this._emptyMsg.style.display = "none";

    for (var i = 0; i < this.filteredItems.length; i++) {
      (function (item, index) {
        var el = document.createElement("div");
        el.className = "fs-option";
        el.setAttribute("role", "option");
        el.dataset.value = item.value;
        el.dataset.index = String(index);
        el.textContent = item.label || item.value;

        if (item.disabled) {
          el.classList.add("disabled");
          el.setAttribute("aria-disabled", "true");
        }
        if (
          String(item.value) === String(self.selectedValue) &&
          item.value !== ""
        ) {
          el.classList.add("selected");
          el.setAttribute("aria-selected", "true");
        }
        if (index === self.highlightedIndex) {
          el.classList.add("highlighted");
        }

        el.addEventListener("click", function (e) {
          e.stopPropagation();
          if (!item.disabled) {
            self._selectItem(item);
          }
        });

        self._list.appendChild(el);
      })(this.filteredItems[i], i);
    }

    // Show result count when filtering
    var total = this.items.filter(function (i) {
      return !i.disabled;
    }).length;
    var showing = this.filteredItems.filter(function (i) {
      return !i.disabled;
    }).length;

    if (this._searchInput.value && showing !== total) {
      this._countLabel.textContent = showing + " of " + total;
      this._countLabel.style.display = "block";
    } else {
      this._countLabel.style.display = "none";
    }
  };

  // ── Selection ───────────────────────────────────────────────────

  FilterableSelect.prototype._selectItem = function (item) {
    var oldValue = this.selectedValue;
    this.selectedValue = String(item.value);
    this.selectedLabel = item.label || item.value;

    this._updateTriggerDisplay();
    this.close();

    if (this.onSelectCb) this.onSelectCb(item.value, item.label);
    if (oldValue !== String(item.value) && this.onChangeCb) {
      this.onChangeCb(item.value, item.label);
    }

    // Dispatch change event on container for external listeners
    var event = new CustomEvent("change", {
      detail: { value: item.value, label: item.label },
      bubbles: true,
    });
    this._container.dispatchEvent(event);
  };

  FilterableSelect.prototype._updateTriggerDisplay = function () {
    if (this.selectedLabel) {
      this._triggerLabel.textContent = this.selectedLabel;
      this._triggerLabel.classList.remove("fs-placeholder");
    } else {
      this._triggerLabel.textContent = this.placeholder;
      this._triggerLabel.classList.add("fs-placeholder");
    }
  };

  // ── Open / Close ────────────────────────────────────────────────

  FilterableSelect.prototype.toggle = function () {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  };

  FilterableSelect.prototype.open = function () {
    if (this.isOpen) return;
    this.isOpen = true;

    var rect = this._trigger.getBoundingClientRect();
    var viewportH = window.innerHeight;
    var gap = 2;
    var spaceBelow = viewportH - rect.bottom - gap;
    var spaceAbove = rect.top - gap;

    // Reset any previous positioning
    this._dropdown.style.top = "";
    this._dropdown.style.bottom = "";
    this._dropdown.style.left = rect.left + "px";
    this._dropdown.style.width = rect.width + "px";
    this._dropdown.classList.remove("flip-up");

    // Measure how tall the dropdown wants to be (render hidden to get natural height)
    this._dropdown.style.visibility = "hidden";
    this._dropdown.style.maxHeight = "none";
    this._list.style.maxHeight = "none";
    this._dropdown.classList.add("open");
    this._searchInput.value = "";
    this._applyFilter();

    var naturalHeight = this._dropdown.offsetHeight;
    var minUsable = 120;

    // Decide direction: prefer below, flip above if not enough space
    var openAbove =
      spaceBelow < Math.min(naturalHeight, minUsable) &&
      spaceAbove > spaceBelow;
    var availableSpace = openAbove ? spaceAbove : spaceBelow;

    // Constrain list max-height to fit in available space
    // Account for search input (~35px), count footer (~24px), borders (~4px)
    var chrome = 65;
    var listMax = Math.max(availableSpace - chrome, 60);
    this._list.style.maxHeight = listMax + "px";

    if (openAbove) {
      this._dropdown.style.bottom = viewportH - rect.top + gap + "px";
      this._dropdown.classList.add("flip-up");
    } else {
      this._dropdown.style.top = rect.bottom + gap + "px";
    }

    // Constrain overall dropdown height
    this._dropdown.style.maxHeight = availableSpace + "px";
    this._dropdown.style.visibility = "";

    this._trigger.classList.add("open");
    this._trigger.setAttribute("aria-expanded", "true");

    // Focus search if visible
    if (!this._searchInput.classList.contains("hidden")) {
      this._searchInput.focus();
    }

    // Scroll selected item into view
    var self = this;
    requestAnimationFrame(function () {
      var selected = self._list.querySelector(".fs-option.selected");
      if (selected) {
        selected.scrollIntoView({ block: "nearest" });
      }
    });
  };

  FilterableSelect.prototype.close = function () {
    if (!this.isOpen) return;
    this.isOpen = false;
    this._dropdown.classList.remove("open");
    this._dropdown.classList.remove("flip-up");
    this._trigger.classList.remove("open");
    this._trigger.setAttribute("aria-expanded", "false");
    this.highlightedIndex = -1;
    // Reset dynamic sizing
    this._list.style.maxHeight = "";
    this._dropdown.style.maxHeight = "";
  };

  // ── Keyboard Navigation ─────────────────────────────────────────

  FilterableSelect.prototype._handleKeydown = function (e) {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (this.highlightedIndex < this.filteredItems.length - 1) {
          this.highlightedIndex++;
          this._updateHighlight();
        }
        break;

      case "ArrowUp":
        e.preventDefault();
        if (this.highlightedIndex > 0) {
          this.highlightedIndex--;
          this._updateHighlight();
        }
        break;

      case "Enter":
        e.preventDefault();
        if (
          this.highlightedIndex >= 0 &&
          this.highlightedIndex < this.filteredItems.length
        ) {
          var item = this.filteredItems[this.highlightedIndex];
          if (!item.disabled) {
            this._selectItem(item);
          }
        }
        break;

      case "Escape":
        e.preventDefault();
        this.close();
        this._trigger.focus();
        break;
    }
  };

  FilterableSelect.prototype._updateHighlight = function () {
    var options = this._list.querySelectorAll(".fs-option");
    for (var i = 0; i < options.length; i++) {
      if (i === this.highlightedIndex) {
        options[i].classList.add("highlighted");
      } else {
        options[i].classList.remove("highlighted");
      }
    }
    // Scroll highlighted into view
    if (this.highlightedIndex >= 0 && options[this.highlightedIndex]) {
      options[this.highlightedIndex].scrollIntoView({ block: "nearest" });
    }
  };

  // ── Public API ──────────────────────────────────────────────────

  Object.defineProperty(FilterableSelect.prototype, "value", {
    get: function () {
      return this.selectedValue;
    },
    set: function (val) {
      this.selectedValue = String(val || "");
      var match = this._findItem(this.selectedValue);
      this.selectedLabel = match
        ? match.label || match.value
        : this.selectedValue;
      this._updateTriggerDisplay();
    },
  });

  /**
   * Destroy the component and clean up DOM.
   */
  FilterableSelect.prototype.destroy = function () {
    if (this._spinTimeout) {
      clearTimeout(this._spinTimeout);
    }
    if (this._dropdown && this._dropdown.parentNode) {
      this._dropdown.parentNode.removeChild(this._dropdown);
    }
    if (this._wrapper && this._wrapper.parentNode) {
      this._wrapper.parentNode.removeChild(this._wrapper);
    }
  };

  // ── Export ───────────────────────────────────────────────────────
  window.FilterableSelect = FilterableSelect;
})();
