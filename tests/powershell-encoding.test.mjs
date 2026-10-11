import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const scripts = ['verify-release.ps1', 'build-windows.ps1', 'run.ps1',
  'smoke-portable-isolated.ps1', 'verify-setup-disposable-vm.ps1'];

test('PowerShell entrypoints are compatible with Windows PowerShell 5.1 source decoding', async()=>{
  for (const filename of scripts) {
    const content = await readFile(fileURLToPath(new URL('../'+filename, import.meta.url)));
    const hasUtf8Bom = content.length >= 3 &&
      content[0] === 0xef && content[1] === 0xbb && content[2] === 0xbf;
    const asciiOnly = content.every(byte => byte <= 0x7f);
    assert.ok(hasUtf8Bom || asciiOnly,
      filename+' must include a UTF-8 BOM or use 7-bit ASCII for Windows PowerShell 5.1');
  }
});


test('Windows EXE release builder uses PowerShell 5.1-safe platform detection', async()=>{
  const script = await readFile(fileURLToPath(new URL('../build-windows.ps1', import.meta.url)), 'utf8');
  assert.doesNotMatch(script, /\$IsWindows\b/,
    'Windows PowerShell 5.1 does not define the PowerShell 7-only $IsWindows variable');
  assert.match(script, /\$env:OS\s+-ne\s+'Windows_NT'/,
    'the Windows guard must work with the legacy PowerShell 5.1 host');
});


test('release verification never advertises stale EXE checksums after a failed earlier phase',async()=>{
  const source=await readFile(fileURLToPath(new URL('../verify-release.ps1',import.meta.url)),'utf8');
  assert.match(source,/\$buildSucceeded\s*=\s*\$false/);
  assert.match(source,/\$buildSucceeded\s*=\s*\$true/);
  assert.match(source,/\$buildSucceeded\s+-and\s+\(Test-Path/);
  assert.match(source,/earlier build/);
});
