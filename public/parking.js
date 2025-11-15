if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js");
}

document.addEventListener("DOMContentLoaded", () => {
  function parseParams() {
    const url = new URL(window.location.href);
    return {
      garage: url.searchParams.get("garage"),
      floor: url.searchParams.get("floor"),
      stair: url.searchParams.get("stair")
    };
  }

  function saveSpot(spot) {
    let spots;
    try {
      spots = JSON.parse(localStorage.getItem("spots") || "[]");
    } catch {
      spots = [];
    }

    spots.unshift({
      ...spot,
      timestamp: Date.now()
    });

    localStorage.setItem("spots", JSON.stringify(spots));
  }

  function getSpots() {
    try {
      return JSON.parse(localStorage.getItem("spots") || "[]");
    } catch {
      return [];
    }
  }

  const params = parseParams();

  if (params.floor) {
    saveSpot(params);
  }

  const spots = getSpots();
  const statusEl = document.getElementById("status");

  if (!statusEl) return;

  if (spots.length === 0) {
    statusEl.innerText = "No parking saved yet. Tap a Garage Helper tag.";
  } else {
    const latest = spots[0];
    statusEl.innerText =
      `Current: ${latest.garage}, Floor ${latest.floor}, Stair ${latest.stair}`;
  }
});
