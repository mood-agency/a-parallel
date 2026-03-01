const fs = require('fs');
const path = require('path');
const base = 'C:/Users/argen/Documents/GitHub/a-parallel/packages/domain-map/src/__tests__';
fs.mkdirSync(base, { recursive: true });

const parserTest = require(path.join(base, '../..', '_gen_parser.json'));
fs.writeFileSync(path.join(base, 'parser.test.ts'), parserTest.content);
console.log('Written parser.test.ts:', parserTest.content.length);

const mermaidTest = require(path.join(base, '../..', '_gen_mermaid.json'));
fs.writeFileSync(path.join(base, 'mermaid.test.ts'), mermaidTest.content);
console.log('Written mermaid.test.ts:', mermaidTest.content.length);
