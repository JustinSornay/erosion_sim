const fs = require("fs");
const path = require("path");
const dir = path.resolve(__dirname, "../../generated/talus");
const statusPath = path.join(dir, "status.json");
const completePath = path.join(dir, "COMPLETE");
if (fs.existsSync(completePath)) { const text = fs.readFileSync(completePath, "utf8"); console.log("TALUS: COMPLETE"); console.log(text.split("\n").slice(3).join("\n")); process.exit(0); }
if (!fs.existsSync(statusPath)) { console.log("TALUS: NOT STARTED"); process.exit(0); }
const status = JSON.parse(fs.readFileSync(statusPath, "utf8"));
if (status.state === "failed") { console.log("TALUS: FAILED"); console.log(`Error: ${status.error}`); process.exit(0); }
console.log(`TALUS: ${status.state.toUpperCase()}`); console.log(`Phase: ${status.phase}`); console.log(`Progress: ${status.completed || 0} / ${status.total || 0} (${Number(status.percent || 0).toFixed(1)}%)`); console.log(`Current: ${status.currentVariant || ""}`); console.log(`Elapsed: ${Math.round(status.elapsedSeconds || 0)}s`); console.log(`ETA: ${Math.round(status.etaSeconds || 0)}s`);
