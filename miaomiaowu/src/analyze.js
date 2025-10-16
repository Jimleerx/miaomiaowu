const fs = require('fs');
const path = require('path');

// Get all .ts and .tsx files
function getAllFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      getAllFiles(filePath, fileList);
    } else if (file.endsWith('.ts') || file.endsWith('.tsx')) {
      fileList.push(filePath);
    }
  });
  return fileList;
}

const srcDir = process.cwd();
const allFiles = getAllFiles(srcDir);

// Build import map
const importMap = {};
const fileStats = {};

allFiles.forEach(file => {
  const relativePath = path.relative(srcDir, file);
  fileStats[relativePath] = {
    path: file,
    imports: new Set(),
    isImported: false,
  };
});

// Parse imports from all files
allFiles.forEach(file => {
  const content = fs.readFileSync(file, 'utf-8');
  const relativePath = path.relative(srcDir, file);
  
  // Find all import statements
  const importRegex = /from\s+['"](@\/[^'"]+)['"]/g;
  let match;
  
  while ((match = importRegex.exec(content)) !== null) {
    const importPath = match[1];
    const resolvedPath = importPath.replace('@', srcDir);
    
    // Try to resolve to actual file
    let actualFile = null;
    if (fs.existsSync(resolvedPath + '.ts')) {
      actualFile = resolvedPath + '.ts';
    } else if (fs.existsSync(resolvedPath + '.tsx')) {
      actualFile = resolvedPath + '.tsx';
    } else if (fs.existsSync(resolvedPath)) {
      actualFile = resolvedPath;
    } else if (fs.existsSync(path.join(resolvedPath, 'index.ts'))) {
      actualFile = path.join(resolvedPath, 'index.ts');
    } else if (fs.existsSync(path.join(resolvedPath, 'index.tsx'))) {
      actualFile = path.join(resolvedPath, 'index.tsx');
    }
    
    if (actualFile) {
      const actualRelative = path.relative(srcDir, actualFile).replace(/\/g, '/');
      if (fileStats[actualRelative]) {
        fileStats[actualRelative].isImported = true;
      }
    }
  }
});

// List unused files
const entryFiles = new Set(['main.tsx', 'routes/__root.tsx', 'routeTree.gen.ts', 'vite-env.d.ts', 'tanstack-table.d.ts']);
const unusedFiles = [];

Object.entries(fileStats).forEach(([relativePath, stats]) => {
  if (!stats.isImported && !entryFiles.has(relativePath) && !relativePath.startsWith('routes/') && !relativePath.includes('.d.ts')) {
    unusedFiles.push(relativePath);
  }
});

console.log('Unused files:');
unusedFiles.sort().forEach(file => console.log(`  ${file}`));
console.log(`\nTotal: ${unusedFiles.length} unused files`);
