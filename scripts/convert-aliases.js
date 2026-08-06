const fs = require('fs');
const path = require('path');
const srcDir = path.join(process.cwd(), 'src');

function walk(dir) {
  const files = fs.readdirSync(dir);
  for (const f of files) {
    const full = path.join(dir, f);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      if (['node_modules','dist'].includes(f)) continue;
      walk(full);
    } else if (stat.isFile() && full.endsWith('.ts')) {
      transform(full);
    }
  }
}

function transform(file) {
  let s = fs.readFileSync(file, 'utf8');
  const re = /from\s+(['"])@\/(.*?)\1/g;
  let changed = false;
  s = s.replace(re, (m, q, target) => {
    const targetAbs = path.join(srcDir, target);
    let rel = path.relative(path.dirname(file), targetAbs);
    rel = rel.split(path.sep).join('/');
    if (!rel.startsWith('.')) rel = './' + rel;
    changed = true;
    return `from ${q}${rel}${q}`;
  });

  // also handle dynamic import("@/foo") and require('@/foo')
  const re2 = /import\(\s*(['"])@\/(.*?)\1\s*\)/g;
  s = s.replace(re2, (m, q, target) => {
    const targetAbs = path.join(srcDir, target);
    let rel = path.relative(path.dirname(file), targetAbs);
    rel = rel.split(path.sep).join('/');
    if (!rel.startsWith('.')) rel = './' + rel;
    changed = true;
    return `import(${q}${rel}${q})`;
  });

  const re3 = /require\(\s*(['"])@\/(.*?)\1\s*\)/g;
  s = s.replace(re3, (m, q, target) => {
    const targetAbs = path.join(srcDir, target);
    let rel = path.relative(path.dirname(file), targetAbs);
    rel = rel.split(path.sep).join('/');
    if (!rel.startsWith('.')) rel = './' + rel;
    changed = true;
    return `require(${q}${rel}${q})`;
  });

  if (changed) {
    fs.writeFileSync(file, s, 'utf8');
    console.log('Updated', file);
  }
}

walk(srcDir);
console.log('Done');
