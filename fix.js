const fs = require('fs');
let c = fs.readFileSync('I:/Astra/backend/index.js', 'utf8');
c = c.replace(/const \{ exec \} = require\('child_process'\);/g, "const { exec: execCmd } = require('child_process');");
c = c.replace(/exec\('npx eslint/g, "execCmd('npx eslint");
fs.writeFileSync('I:/Astra/backend/index.js', c);
