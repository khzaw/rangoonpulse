      (function () {
        const tzNode = document.getElementById("browser-tz");
        const tsNodes = Array.from(document.querySelectorAll("[data-utc]"));
        const rows = Array.from(document.querySelectorAll("[data-rec-row]"));
        const buttons = Array.from(document.querySelectorAll("[data-filter-action]"));
        const searchInput = document.getElementById("searchInput");
        const noteFilter = document.getElementById("noteFilter");
        const resultCount = document.getElementById("resultCount");
        const emptyState = document.getElementById("emptyState");
        let activeAction = "all";

        try {
          if (tzNode && window.Intl && Intl.DateTimeFormat) {
            tzNode.textContent = Intl.DateTimeFormat().resolvedOptions().timeZone || "browser local";
          }
        } catch (e) {}

        for (const tsNode of tsNodes) {
          const raw = tsNode.getAttribute("data-utc");
          if (!raw) continue;
          const d = new Date(raw);
          if (Number.isNaN(d.getTime())) continue;
          tsNode.textContent = d.toLocaleString(undefined, {
            year: "numeric",
            month: "short",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            timeZoneName: "short"
          });
          tsNode.title = "UTC: " + raw;
        }

        function applyFilters() {
          const query = (searchInput && searchInput.value || "").trim().toLowerCase();
          const noteValue = noteFilter ? noteFilter.value : "all";
          let visible = 0;

          for (const row of rows) {
            const action = row.dataset.action || "";
            const notes = row.dataset.notes || "";
            const search = row.dataset.search || "";
            const actionMatch = activeAction === "all" || action === activeAction;
            const noteMatch = noteValue === "all" || notes.split(",").includes(noteValue);
            const searchMatch = !query || search.includes(query);
            const show = actionMatch && noteMatch && searchMatch;
            row.hidden = !show;
            if (show) visible += 1;
          }

          if (resultCount) {
            resultCount.textContent = visible + " visible row" + (visible === 1 ? "" : "s");
          }
          if (emptyState) {
            emptyState.hidden = visible !== 0;
          }
        }

        for (const button of buttons) {
          button.addEventListener("click", function () {
            activeAction = button.dataset.filterAction || "all";
            for (const peer of buttons) {
              peer.classList.toggle("active", peer === button);
            }
            applyFilters();
          });
        }

        if (searchInput) searchInput.addEventListener("input", applyFilters);
        if (noteFilter) noteFilter.addEventListener("change", applyFilters);
        applyFilters();
      })();
    
