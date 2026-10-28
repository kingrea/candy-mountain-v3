import { test } from 'vitest';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudeProcess, type ClaudeEvent } from './process';
import { CLAUDE_AUTHENTICATION_ERROR, CLAUDE_PROVIDER_ERROR, prepareClaudeLaunch } from './auth';
import { cliCommand } from './test-support/cli';
const fixture = fileURLToPath(new URL('./test-support/claude-fixture.mjs', import.meta.url));
const options = { command: process.execPath, commandPrefix: [fixture], startupTimeoutMs: 1000, cancelTimeoutMs: 1000 };
const PROJECT_CONFIG_SUPPRESSING_FLAGS = ['--bare','--dangerously-skip-permissions','--allow-dangerously-skip-permissions','--permission-mode','--restricted','--safe-mode','--allowedTools','--allowed-tools','--disallowedTools','--disallowed-tools','--tools','--setting-sources','--settings','--strict-mcp-config','--mcp-config','--disable-slash-commands','--system-prompt','--append-system-prompt','--agent','--agents','--plugin-dir','--no-session-persistence'];
test('checkout, session identity, retained child cancellation, subsequent prompt', async () => {
 const cwd=await mkdtemp(join(tmpdir(),'claude-acp-')); const events:ClaudeEvent[]=[];
 const session=new ClaudeProcess(randomUUID(),{...options,onEvent:(e)=>{events.push(e);}});
 try {
  await session.start(cwd);
  assert.equal((await session.prompt([{type:'text',text:'hello'}])).result,'hello');
  const init=events.find(e=>e.type==='system')!;
  assert.equal(init.cwd,cwd);assert.equal(init.session_id,session.sessionId);
  assert.ok(init.args.includes('--session-id'));
  for(const forbidden of PROJECT_CONFIG_SUPPRESSING_FLAGS) assert.ok(!init.args.includes(forbidden),forbidden);
  const pending=session.prompt([{type:'text',text:'wait'}]);await session.cancel();
  assert.equal((await pending).cancelled,true);assert.equal(session.running,true);
  assert.equal((await session.prompt([{type:'text',text:'again'}])).result,'again');
 } finally {session.close();await rm(cwd,{recursive:true,force:true});}
});
test('resume passes exact upstream identity',async()=>{
 const id=randomUUID();let init:ClaudeEvent|undefined;
 const session=new ClaudeProcess(id,{...options,onEvent:e=>{if(e.type==='system')init=e;}});
 try{await session.start(tmpdir(),true);await session.prompt([{type:'text',text:'resume'}]);assert.equal(init?.session_id,id);assert.ok(init?.args.includes('--resume'));}finally{session.close();}
});
for(const mode of ['exit','malformed','hang']) test(`startup ${mode} fails promptly`,async()=>{
 const session=new ClaudeProcess(randomUUID(),{...options,startupTimeoutMs:100,env:{...process.env,FIXTURE_MODE:mode}});
 try{await assert.rejects(session.start(tmpdir()));}finally{session.close();}
});
test('a CLI that refuses to start says why in the start failure',async()=>{
 const session=new ClaudeProcess(randomUUID(),{...options,onDiagnostic:()=>{},env:{...process.env,FIXTURE_MODE:'refuse-start'}});
 try{await assert.rejects(session.start(tmpdir()),/^Error: Claude (child exited \(code 1, signal null\)|output stream closed): Error: sandbox required but unavailable: .*refusing to start without a working sandbox\.$/s);}finally{session.close();}
});
for(const account of ['none','none-legacy']) test(`startup on an unauthenticated config directory (${account}) fails with actionable login guidance`,async()=>{
 const session=new ClaudeProcess(randomUUID(),{...options,env:{...process.env,FIXTURE_ACCOUNT:account}});
 try{await assert.rejects(session.start(tmpdir()),error=>error instanceof Error&&error.message===CLAUDE_AUTHENTICATION_ERROR);assert.equal(session.running,false);}finally{session.close();}
});
for(const account of ['stored','token','token-legacy','absent']) test(`startup accepts the ${account} subscription account shape`,async()=>{
 const session=new ClaudeProcess(randomUUID(),{...options,env:{...process.env,FIXTURE_ACCOUNT:account}});
 try{await session.start(tmpdir());assert.equal((await session.prompt([{type:'text',text:'ok'}])).result,'ok');}finally{session.close();}
});
test('startup on a non-subscription API provider fails before any turn',async()=>{
 const session=new ClaudeProcess(randomUUID(),{...options,env:{...process.env,FIXTURE_ACCOUNT:'bedrock'}});
 try{await assert.rejects(session.start(tmpdir()),error=>error instanceof Error&&error.message===CLAUDE_PROVIDER_ERROR);}finally{session.close();}
});
test('a login that expires mid-turn rejects with the same actionable guidance',async()=>{
 const session=new ClaudeProcess(randomUUID(),options);
 try{await session.start(tmpdir());await assert.rejects(session.prompt([{type:'text',text:'expired'}]),error=>error instanceof Error&&error.message===CLAUDE_AUTHENTICATION_ERROR);}finally{session.close();}
});
for(const text of ['crash','bad','deny','unknown-result']) test(`turn ${text} fails without hanging`,async()=>{
 const session=new ClaudeProcess(randomUUID(),options);
 try{await session.start(tmpdir());await assert.rejects(session.prompt([{type:'text',text}]));}finally{session.close();}
});
test('missing binary fails startup',async()=>{
 const session=new ClaudeProcess(randomUUID(),{command:'/nonexistent/claude'});await assert.rejects(session.start(tmpdir()),/Unable to start/);
});

test('standalone executable exchanges SDK framed ACP requests and resumes',async()=>{
 const {spawn}=await import('node:child_process');
 const {Readable,Writable}=await import('node:stream');
 const {writeFile,chmod}=await import('node:fs/promises');
 const {ClientSideConnection,ndJsonStream,PROTOCOL_VERSION}=await import('@agentclientprotocol/sdk');
 const cwd=await mkdtemp(join(tmpdir(),'claude-acp-wire-'));
 const quote=(value:string)=>"'"+value.replaceAll("'","'\\''")+"'";
 await writeFile(join(cwd,'claude'),`#!/bin/sh\nexec ${quote(process.execPath)} ${quote(fixture)} "$@"\n`);await chmod(join(cwd,'claude'),0o755);
 const run=async(resume?:string)=>{
  const cli=cliCommand(['--config-dir',join(cwd,'claude-config')]);const child=spawn(cli.command,cli.args,{env:{...process.env,PATH:`${cwd}:${process.env.PATH}`},stdio:'pipe'});
  let diagnostics='';child.stderr.on('data',c=>diagnostics+=c);
  const client=new ClientSideConnection(()=>({sessionUpdate:async()=>{},requestPermission:async()=>({outcome:{outcome:'cancelled' as const}})}),ndJsonStream(Writable.toWeb(child.stdin),Readable.toWeb(child.stdout)));
  try{
   const initialized=await client.initialize({protocolVersion:PROTOCOL_VERSION,clientCapabilities:{}});assert.equal(initialized.protocolVersion,PROTOCOL_VERSION);
   const sessionId=resume??(await client.newSession({cwd,mcpServers:[]})).sessionId;
   if(resume)await client.loadSession({cwd,mcpServers:[],sessionId});
   assert.equal((await client.prompt({sessionId,prompt:[{type:'text',text:'wire'}]})).stopReason,'end_turn');
   const pending=client.prompt({sessionId,prompt:[{type:'text',text:'wait'}]});await client.cancel({sessionId});assert.equal((await pending).stopReason,'cancelled');
   assert.equal((await client.prompt({sessionId,prompt:[{type:'text',text:'again'}]})).stopReason,'end_turn');
   await assert.rejects(client.newSession({cwd,mcpServers:[]}));
   assert.equal(diagnostics,'');return sessionId;
  }finally{child.stdin.end();await new Promise<void>(resolve=>child.once('exit',()=>resolve()));}
 };
 try{await run(await run());}finally{await rm(cwd,{recursive:true,force:true});}
});

test('launch isolates config, preserves OAuth token presence and removes API auth overrides',async()=>{
 const root=await mkdtemp(join(tmpdir(),'claude-owner-config-'));const syntheticToken='synthetic-test-token';
 try {
  const launch=await prepareClaudeLaunch({configDir:join(root,'claude'),env:{PATH:process.env.PATH,CLAUDE_CONFIG_DIR:'/shared/default',CLAUDE_CODE_OAUTH_TOKEN:syntheticToken,ANTHROPIC_API_KEY:'synthetic-api-key',ANTHROPIC_AUTH_TOKEN:'synthetic-auth-token',CLAUDE_CODE_USE_BEDROCK:'1'}});
  assert.equal(launch.configDir,join(root,'claude'));assert.equal(launch.env.CLAUDE_CONFIG_DIR,launch.configDir);assert.equal(launch.env.CLAUDE_CODE_OAUTH_TOKEN,syntheticToken);
  assert.equal((await stat(launch.configDir)).mode&0o777,0o700);
  assert.equal(launch.env.ANTHROPIC_API_KEY,undefined);assert.equal(launch.env.ANTHROPIC_AUTH_TOKEN,undefined);assert.equal(launch.env.CLAUDE_CODE_USE_BEDROCK,undefined);
  const events:ClaudeEvent[]=[];const session=new ClaudeProcess(randomUUID(),{...options,env:launch.env,onEvent:event=>{events.push(event);}});
  try{await session.start(root);await session.prompt([{type:'text',text:'identity'}]);}finally{session.close();}
  const init=events.find(event=>event.type==='system');assert.equal(init?.configDir,launch.configDir);assert.equal(init?.oauthTokenPresent,true);assert.equal(init?.apiKeyPresent,false);assert.equal(init?.authTokenPresent,false);assert.equal(init?.bedrockPresent,false);
 } finally {await rm(root,{recursive:true,force:true});}
});


test('fragmented UTF-8 child stream delivers ordered incremental activity without duplicates',async()=>{
 const {ClaudeEventTranslator}=await import('./translator');
 const updates:any[]=[];const translator=new ClaudeEventTranslator(u=>{updates.push(u);},tmpdir());
 const session=new ClaudeProcess(randomUUID(),{...options,onEvent:e=>translator.accept(e)});
 try{await session.start(tmpdir());await session.prompt([{type:'text',text:'fragmented'}]);assert.deepEqual(updates.map(u=>u.content?.text),['hello 🌏']);}finally{session.close();}
});


test('mixed image prompt reaches controlled child unchanged',async()=>{
 const {convertPrompt}=await import('./translator');let received:unknown;
 const session=new ClaudeProcess(randomUUID(),{...options,onEvent:e=>{if(e.type==='system')received=e.userContent;}});
 const content=convertPrompt([{type:'text',text:'look'},{type:'image',mimeType:'image/png',data:'aGVsbG8='},{type:'text',text:'please'}]);
 try{await session.start(tmpdir());await session.prompt(content);assert.deepEqual(received,content);}finally{session.close();}
});


test('launch preserves project configuration and adds only stream-json flags',async()=>{
 const root=await mkdtemp(join(tmpdir(),'claude-config-flags-'));let init:ClaudeEvent|undefined;
 try{
  const launch=await prepareClaudeLaunch({configDir:join(root,'claude'),env:{PATH:process.env.PATH}});
  const session=new ClaudeProcess(randomUUID(),{...options,env:launch.env,onEvent:event=>{if(event.type==='system')init=event;}});
  try{await session.start(root);await session.prompt([{type:'text',text:'flags'}]);}finally{session.close();}
  const args:string[]=init!.args;
  assert.equal(init?.configDir,launch.configDir);
  for(const forbidden of PROJECT_CONFIG_SUPPRESSING_FLAGS) assert.ok(!args.includes(forbidden),forbidden);
  assert.deepEqual(args.filter(argument=>argument.startsWith('--')),['--print','--verbose','--input-format','--output-format','--include-partial-messages','--permission-prompt-tool','--session-id']);
 }finally{await rm(root,{recursive:true,force:true});}
});


test('an unauthenticated config directory fails session creation over the wire, not at prompt time',async()=>{
 const {spawn}=await import('node:child_process');
 const {Readable,Writable}=await import('node:stream');
 const {writeFile,chmod}=await import('node:fs/promises');
 const {ClientSideConnection,ndJsonStream,PROTOCOL_VERSION}=await import('@agentclientprotocol/sdk');
 const cwd=await mkdtemp(join(tmpdir(),'claude-acp-unauth-'));
 const quote=(value:string)=>"'"+value.replaceAll("'","'\\''")+"'";
 await writeFile(join(cwd,'claude'),`#!/bin/sh\nexec ${quote(process.execPath)} ${quote(fixture)} "$@"\n`);await chmod(join(cwd,'claude'),0o755);
 const cli=cliCommand(['--config-dir',join(cwd,'claude-config')]);const child=spawn(cli.command,cli.args,{env:{...process.env,PATH:`${cwd}:${process.env.PATH}`,FIXTURE_ACCOUNT:'none'},stdio:'pipe'});
 let permissionRequests=0;
 const client=new ClientSideConnection(()=>({sessionUpdate:async()=>{},requestPermission:async()=>{permissionRequests+=1;return {outcome:{outcome:'cancelled' as const}};}}),ndJsonStream(Writable.toWeb(child.stdin),Readable.toWeb(child.stdout)));
 try{
  await client.initialize({protocolVersion:PROTOCOL_VERSION,clientCapabilities:{}});
  await assert.rejects(client.newSession({cwd,mcpServers:[]}),error=>{const message=String((error as {message?:string}).message ?? error);return message.includes('Authentication required')&&message.includes('claude auth login');});
  assert.equal(permissionRequests,0);
 }finally{child.stdin.end();await new Promise<void>(resolve=>child.once('exit',()=>resolve()));await rm(cwd,{recursive:true,force:true});}
});
