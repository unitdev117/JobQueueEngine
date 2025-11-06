// Very simple namespace + functions; fetch from local server.
window.QueueUI = (function () {
  const ui = {};

  ui.els = {
    pickedPaths: document.getElementById("picked-paths"),
    workerCount: document.getElementById("worker-count"),
    counts: {
      pending: document.getElementById("count-pending"),
      failed: document.getElementById("count-failed"),
      processing: document.getElementById("count-processing"),
      completed: document.getElementById("count-completed"),
      dead: document.getElementById("count-dead"),
    },
    list: document.getElementById("list-container"),
    listTitle: document.getElementById("list-title"),
    listClose: document.getElementById("close-list"),
    listItems: document.getElementById("jobs-list"),
  };

  ui.refreshMs = 30000;
  ui.timer = null;
  ui.renderPicked = function () {
    const secs = Math.round(ui.refreshMs / 1000);
    ui.els.pickedPaths.textContent = "Auto-refreshing every " + secs + "s";
  };

  ui.refresh = async function () {
    try {
      const r = await fetch("/api/status", { cache: "no-store" });
      const s = await r.json();
      ui.els.counts.pending.textContent = s.pending;
      ui.els.counts.failed.textContent = s.failed;
      ui.els.counts.processing.textContent = s.processing;
      ui.els.counts.completed.textContent = s.completed;
      ui.els.counts.dead.textContent = s.dead;
      ui.els.workerCount.textContent = String(s.workers);
      if (s.refresh_ms && s.refresh_ms !== ui.refreshMs) {
        ui.refreshMs = s.refresh_ms;
        if (ui.timer) clearInterval(ui.timer);
        ui.timer = setInterval(ui.refresh, ui.refreshMs);
        ui.renderPicked();
      }
    } catch (e) {
      console.error("status error", e);
    }
  };

  ui.listByState = async function (state) {
    try {
      const r = await fetch("/api/list?state=" + encodeURIComponent(state), {
        cache: "no-store",
      });
      const data = await r.json();
      return Array.isArray(data.ids) ? data.ids : [];
    } catch (e) {
      return [];
    }
  };

  ui.init = function () {
    ui.renderPicked();
    ui.refresh();
    // Hook up list close
    ui.els.listClose.onclick = function () {
      ui.els.list.classList.add("hidden");
    };
    // Hook up status card clicks
    const cards = document.querySelectorAll(".status-card");
    for (let i = 0; i < cards.length; i++) {
      const b = cards[i];
      b.onclick = async function () {
        const state = b.getAttribute("data-state");
        const jobs = await ui.listByState(state);
        ui.els.listTitle.textContent = "Jobs (state=" + state + ")";
        ui.els.listItems.innerHTML = "";
        if (!jobs || jobs.length === 0) {
          const li = document.createElement("li");
          li.textContent = "<none>";
          ui.els.listItems.appendChild(li);
        } else {
          for (let j = 0; j < jobs.length; j++) {
            const li = document.createElement("li");
            li.textContent = jobs[j];
            ui.els.listItems.appendChild(li);
          }
        }
        ui.els.list.classList.remove("hidden");
      };
    }
    // start with default, will be adjusted after first status
    ui.timer = setInterval(ui.refresh, ui.refreshMs);
  };

  return ui;
})();

window.QueueUI.init();
