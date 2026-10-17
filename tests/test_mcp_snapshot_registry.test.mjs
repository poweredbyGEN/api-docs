import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY = 'src/gen_mcp_server/contracts/catalog-record/schema-paths.tsv';
const names = prefix => Array.from({length:10}, (_, i) => `gen_${prefix}_${String(i).padStart(2,'0')}`);
const tsv = list => 'record_kind\trecord\trow_type\tpointer\tdescription\ttitle\n' + list.map(n => `tool\t${n}\ttool_field\t\tA canonical served tool.\tTool`).join('\n') + '\ntool\tgen_nested_decoy\ttool_field\t/properties/x\tNested\tNested\n';
function fixture(t, registry = tsv(names('fixture'))) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'gen10512-'));
  t.after(() => rmSync(dir, {recursive:true,force:true}));
  const repo = path.join(dir,'mcp'); mkdirSync(repo);
  const put = (file,text) => {const p=path.join(repo,file);mkdirSync(path.dirname(p),{recursive:true});writeFileSync(p,text);};
  const git = (...args) => execFileSync('git',['-C',repo,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git('init','-q');git('config','user.name','Contract Test');git('config','user.email','test@example.invalid');
  put('src/gen_mcp_server/server.py','@mcp.tool()\ndef gen_decoy(): pass\n');
  put('src/gen_mcp_server/contracts/vidsheet-alias-replacements.json',JSON.stringify({aliases:{gen_fixture_00:{actions:['write']},gen_retired:{actions:['write']}}}));
  if(registry !== null)put(REGISTRY,registry);
  git('add','src');git('commit','-qm','fixture A');const sha=git('rev-parse','HEAD');
  const log=path.join(dir,'calls.jsonl');const preload=path.join(dir,'fetch.mjs');
  writeFileSync(preload,`import {appendFileSync} from 'node:fs';globalThis.fetch=async(url,options)=>{const body=JSON.parse(options.body);appendFileSync(process.env.CALL_LOG,JSON.stringify({url,method:options.method,rpc:body.method})+'\\n');if(process.env.ALLOW_LIVE!=='1')throw new Error('offline attempted network');return {ok:true,text:async()=>JSON.stringify(body.method==='tools/list'?{result:{tools:[{name:'gen_live'}]}}:{result:{}})};};`);
  const run=(ref=sha,{live=false,out=path.join(dir,'output.json')}={})=>{
    writeFileSync(log,'');const args=['--import',preload,path.join(ROOT,'scripts/update-mcp-tools-snapshot.mjs'),'--aliases-repo',repo,'--ref',ref,'--out',out];if(!live)args.push('--offline');
    const r=spawnSync(process.execPath,args,{encoding:'utf8',timeout:10000,env:{...process.env,GEN_MCP_PAT:'PRIVATE_PAT_SENTINEL',CALL_LOG:log,ALLOW_LIVE:live?'1':'0'}});
    assert.equal(r.error,undefined);return {...r,out,calls:readFileSync(log,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)};
  };
  return {dir,repo,put,git,sha,run};
}
// GEN-10512: ordinary regression cases preserve the independent frozen assertions.

test('T1 canonical roots win over decorator and retired aliases', t=>{
  const f=fixture(t),r=f.run();assert.equal(r.status,0,r.stderr);const d=JSON.parse(readFileSync(r.out));
  assert.deepEqual(d.served,names('fixture'));assert.equal(d.retired.gen_fixture_00,undefined);assert.equal(d.retired.gen_retired,'gen_vidsheet_action');
  assert.ok(d.source.includes(REGISTRY));assert.ok(d.source.includes(f.sha.slice(0,7)));assert.deepEqual(r.calls,[]);
});
for(const [kind,body] of [['no header','bad'],['missing record','record_kind\trow_type\tpointer\n'],['empty',tsv([])],['nine',tsv(names('fixture').slice(0,9))]])test(`T2 reject ${kind} before write`, t=>{
 const f=fixture(t,body),out=path.join(f.dir,'sentinel');writeFileSync(out,'KEEP');const r=f.run(f.sha,{out});assert.equal(r.status,1);assert.equal(readFileSync(out,'utf8'),'KEEP');assert.deepEqual(r.calls,[]);
});
test('T3 absent pinned registry cannot borrow dirty checkout',t=>{
 const f=fixture(t,null);f.put(REGISTRY,tsv(names('dirty')));const out=path.join(f.dir,'sentinel');writeFileSync(out,'KEEP');const r=f.run(f.sha,{out});assert.equal(r.status,1);assert.equal(readFileSync(out,'utf8'),'KEEP');assert.deepEqual(r.calls,[]);
 f.git('add',REGISTRY);f.git('commit','-qm','repair registry');const repaired=f.run(f.git('rev-parse','HEAD'),{out});assert.equal(repaired.status,0,repaired.stderr);assert.deepEqual(JSON.parse(readFileSync(out)).served,names('dirty'));assert.deepEqual(repaired.calls,[]);
});
test('T4 explicit revisions remain stable and separate',t=>{
 const f=fixture(t);f.put(REGISTRY,tsv(names('second')));f.git('add',REGISTRY);f.git('commit','-qm','fixture B');const b=f.git('rev-parse','HEAD');
 const results=[f.sha,f.sha,b].map((ref,i)=>{const r=f.run(ref,{out:path.join(f.dir,`out${i}`)});assert.equal(r.status,0,r.stderr);assert.deepEqual(r.calls,[]);const d=JSON.parse(readFileSync(r.out));delete d.generated_at;return d;});
 assert.deepEqual(results[0],results[1]);assert.deepEqual(results[0].served,names('fixture'));assert.deepEqual(results[2].served,names('second'));assert.ok(results[0].source.includes(f.sha.slice(0,7)));assert.ok(results[2].source.includes(b.slice(0,7)));assert.equal(f.git('rev-parse','HEAD'),b);
});
test('T5 live mode preserves two-call transport and excludes PAT',t=>{
 const f=fixture(t),r=f.run(f.sha,{live:true});assert.equal(r.status,0,r.stderr);const raw=readFileSync(r.out,'utf8'),d=JSON.parse(raw);assert.deepEqual(d.served,['gen_live']);assert.deepEqual(r.calls.map(c=>[c.method,c.rpc]),[['POST','initialize'],['POST','tools/list']]);assert.equal(raw.includes('PRIVATE_PAT_SENTINEL'),false);
});
test('T5 offline with PAT never makes a network request',t=>{const f=fixture(t),r=f.run();assert.equal(r.status,0,r.stderr);assert.deepEqual(r.calls,[]);assert.equal(readFileSync(r.out,'utf8').includes('PRIVATE_PAT_SENTINEL'),false);});
test('T6 current compatibility module replaces decoy server maps at pinned refs',t=>{
 const f=fixture(t),compat='src/gen_mcp_server/server_parts/registry.py';
 f.put('src/gen_mcp_server/server.py','@mcp.tool()\ndef gen_decoy(): pass\n_COMPAT_EXTRA_VIEWS = {\n    "gen_old_read": "row",\n}\n');
 f.git('add','src');f.git('commit','-qm','legacy compatibility L');const legacy=f.git('rev-parse','HEAD');
 f.put(compat,'_COMPAT_EXTRA_VIEWS = {\n    "gen_current_read": "row",\n    "gen_fixture_00": "row",\n}\n_COMPAT_RENAMED_FNS = {\n}\n');
 f.git('add','src');f.git('commit','-qm','current compatibility A');const a=f.git('rev-parse','HEAD');
 f.put(compat,'_COMPAT_EXTRA_VIEWS = {\n    "gen_next_read": "row",\n}\n_COMPAT_RENAMED_FNS = {\n}\n');f.git('add',compat);f.git('commit','-qm','current compatibility B');const b=f.git('rev-parse','HEAD');
 for(const[ref,name,other]of[[a,'gen_current_read','gen_next_read'],[b,'gen_next_read','gen_current_read'],[legacy,'gen_old_read','gen_next_read']]){
  const r=f.run(ref);assert.equal(r.status,0,r.stderr);const d=JSON.parse(readFileSync(r.out));assert.equal(d.retired[name],'gen_discover');assert.equal(d.retired[other],undefined);if(ref!==legacy)assert.equal(d.retired.gen_old_read,undefined);else assert.equal(d.retired.gen_current_read,undefined);assert.equal(d.retired.gen_fixture_00,undefined);assert.deepEqual(d.served,names('fixture'));assert.deepEqual(r.calls,[]);assert.ok(d.source.includes(ref.slice(0,7)));
 }
});
// GEN-10512: independent strict regressions for the product-review findings.

test('T2 truncated tool roots are not empty-pointer roots',t=>{
 const header=tsv([]).split('\n')[0];const malformed=header+'\n'+names('short').map(n=>`tool\t${n}\ttool_field`).join('\n')+'\n';
 const f=fixture(t,malformed),out=path.join(f.dir,'sentinel');writeFileSync(out,'KEEP');const r=f.run(f.sha,{out});assert.equal(r.status,1);assert.equal(readFileSync(out,'utf8'),'KEEP');assert.deepEqual(r.calls,[]);
});
test('T7 absent pinned aliases cannot borrow working-tree aliases',t=>{
 const f=fixture(t),alias='src/gen_mcp_server/contracts/vidsheet-alias-replacements.json';f.git('rm',alias);f.git('commit','-qm','no aliases in pinned commit');const ref=f.git('rev-parse','HEAD');f.put(alias,JSON.stringify({aliases:{gen_dirty_alias:{actions:['write']}}}));
 const out=path.join(f.dir,'sentinel');writeFileSync(out,'KEEP');const r=f.run(ref,{out});assert.equal(r.status,1);assert.equal(readFileSync(out,'utf8'),'KEEP');assert.deepEqual(r.calls,[]);
});

// GEN-10512: actual producer width applies to roots, not short nested records.
function wideRegistry(rootWidth=64) {
 const header=Array.from({length:64},(_,i)=>`column_${i}`);
 for(const [i,n] of [[0,'record_kind'],[1,'record'],[2,'row_type'],[3,'pointer'],[32,'description'],[63,'title']])header[i]=n;
 const roots=names('wide').map(n=>{const c=Array(64).fill('');c[0]='tool';c[1]=n;c[2]='tool_field';c[32]='Canonical description';c[63]='Canonical title';return c.slice(0,rootWidth).join('\t');});
 const nested=['tool','gen_nested_decoy','tool_field','/properties/value','','','',''];
 const schema=['tool','gen_schema_decoy','schema_node','','','','',''];
 return [header.join('\t'),...roots,nested.join('\t'),schema.join('\t')].join('\n')+'\n';
}
test('T8 actual wide roots coexist with short nested and schema rows',t=>{
 const f=fixture(t,wideRegistry()),r=f.run();assert.equal(r.status,0,r.stderr);
 const d=JSON.parse(readFileSync(r.out));assert.deepEqual(d.served,names('wide'));assert.deepEqual(r.calls,[]);
});
for(const width of [8,33])test(`T2 served root missing display cells at width ${width} refuses before write`,t=>{
 const f=fixture(t,wideRegistry(width)),out=path.join(f.dir,'sentinel');writeFileSync(out,'KEEP');
 const r=f.run(f.sha,{out});assert.equal(r.status,1);assert.equal(readFileSync(out,'utf8'),'KEEP');assert.deepEqual(r.calls,[]);
});
