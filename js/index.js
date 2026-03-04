// ─────────────────────────────────────────
//  TEXOFILO — Index Page Logic
// ─────────────────────────────────────────

const input = document.getElementById("path-input");
const btn   = document.getElementById("go-btn");

function navigate() {
  let val = (input.value || "").trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9\-_]/g, "")
    .slice(0, 64);

  if (!val) {
    input.style.outline = "2px solid var(--red)";
    input.focus();
    input.placeholder = "Enter a path first…";
    setTimeout(() => {
      input.style.outline = "";
      input.placeholder   = "your-secret-page";
    }, 2200);
    return;
  }

  btn.disabled = true;
  btn.textContent = "Going…";
  window.location.href = "pad.html?p=" + encodeURIComponent(val);
}

btn.addEventListener("click", navigate);

input.addEventListener("keydown", e => {
  if (e.key === "Enter") navigate();
});

input.addEventListener("input", () => {
  input.style.outline = "";
  // Sanitize live: show only valid chars
  const clean = input.value.replace(/[^a-zA-Z0-9\-_ ]/g, "");
  if (clean !== input.value) input.value = clean;
});

input.focus();
