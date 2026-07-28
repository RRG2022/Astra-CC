const fs = require('fs');
let c = fs.readFileSync('I:/Astra/backend/index.js', 'utf8');
c = c.replace(/}\);\n}\);\n\n\/\/ Proxy to generate a response from Ollama/, "});\n\n// Proxy to generate a response from Ollama");
fs.writeFileSync('I:/Astra/backend/index.js', c);
