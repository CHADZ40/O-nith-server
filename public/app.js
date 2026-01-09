const fileInput = document.getElementById("file");
const btn = document.getElementById("btn");
const clear = document.getElementById("clear");
const nameEl = document.getElementById("name");
const metaEl = document.getElementById("meta");
const statusEl = document.getElementById("status");
const drop = document.getElementById("drop");

let selected = null;

function fmt(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}
function setStatus(msg) { statusEl.textContent = msg || ""; }

function reset() {
  selected = null;
  fileInput.value = "";
  nameEl.textContent = "No file selected";
  metaEl.textContent = "Choose any file to convert.";
  btn.disabled = true;
  clear.disabled = true;
  setStatus("");
}
fileInput.addEventListener("change", () => {
  const f = fileInput.files?.[0];
  if (!f) return;
  selected = f;
  nameEl.textContent = f.name;
  metaEl.textContent = `${f.type || "unknown type"} • ${fmt(f.size)}`;
  btn.disabled = false;
  clear.disabled = false;
  setStatus("Ready to convert 💖");
});
clear.addEventListener("click", reset);

drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.style.borderColor = "#ff86b2aa"; });
drop.addEventListener("dragleave", () => { drop.style.borderColor = ""; });
drop.addEventListener("drop", (e) => {
  e.preventDefault(); drop.style.borderColor = "";
  const f = e.dataTransfer.files?.[0];
  if (!f) return;
  selected = f;
  nameEl.textContent = f.name;
  metaEl.textContent = `${f.type || "unknown type"} • ${fmt(f.size)}`;
  btn.disabled = false;
  clear.disabled = false;
  setStatus("Ready to convert 💞");
});

btn.addEventListener("click", async () => {
  if (!selected) return;

  btn.disabled = true;
  setStatus("Converting… please wait 💌");

  try {
    const form = new FormData();
    form.append("file", selected);

    const res = await fetch("/api/convert", { method: "POST", body: form });
    if (!res.ok) throw new Error(await res.text());

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    const base = selected.name.replace(/\.[^.]+$/, "") || "converted";
    a.href = url;
    a.download = `${base}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    setStatus("Done! Your PDF downloaded 💖 (Website for o nith)");
  } catch (e) {
    console.error(e);
    setStatus("Failed. Check LibreOffice install + server logs 💔");
  } finally {
    btn.disabled = false;
  }
});

reset();
