import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const html=readFileSync(path.join(root,'site/v3.1/index.html'),'utf8');
const script=readFileSync(path.join(root,'site/v3.1/fb-export.mjs'),'utf8');

test('three independently selectable price levels',()=>{
  for(const level of ['Ladang','Borong','Runcit'])
    assert.match(html,new RegExp('class="fb-post-level-check" type="checkbox" value="'+level+'"'));
  assert.doesNotMatch(html,/id="fb-post-level"/,'legacy single-level selector must not return');
  assert.match(script,/querySelectorAll\('\.fb-post-level-check:checked'\)/);
  assert.match(script,/if\(!v\.levels\.length\)throw Error/);
});

test('each selected level has its own price groups, poster path and audit rows',()=>{
  assert.match(script,/new Map\(v\.levels\.map\(level=>\[level,buildGroups\(rows,v\.date,level\)\]\)\)/);
  assert.match(script,/for\(const level of v\.levels\)/);
  assert.match(script,/L_Ladang/);
  assert.match(script,/B_Borong/);
  assert.match(script,/R_Runcit/);
  assert.match(script,/zip\(files\)/);
  assert.match(script,/for\(const level of options\.levels\)/);
});

test('preview, language, state and button integration remain available',()=>{
  for(const id of ['fb-post-preview','fb-post-single','fb-post-zip','fb-post-copy',
    'fb-post-state','fb-post-language','fb-post-mode','fb-post-date'])
    assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(script,/checkbox\.addEventListener\('change',refresh\)/);
});
