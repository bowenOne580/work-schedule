const fs = require("node:fs");
const path = require("node:path");
const spec = require("../src/agent/openapi");

fs.writeFileSync(path.join(__dirname, "..", "doc", "agent-api.openapi.json"), JSON.stringify(spec, null, 2) + "\n");
console.log("Updated doc/agent-api.openapi.json");
