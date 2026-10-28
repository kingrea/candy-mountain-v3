import readline from 'node:readline';
const emit = (x) => process.stdout.write(JSON.stringify(x) + '\n');
const args = process.argv.slice(2);
const id = args[args.indexOf(args.includes('--resume') ? '--resume' : '--session-id') + 1];
const mode = process.env.FIXTURE_MODE;
// Account shapes observed from stock CLI 2.1.1 and 2.1.263 initialize control responses.
const accounts = {
 stored:{email:'owner@example.com',organization:'Example',subscriptionType:'Claude Team',apiProvider:'firstParty'},
 token:{tokenSource:'CLAUDE_CODE_OAUTH_TOKEN',apiProvider:'firstParty'},
 'token-legacy':{subscriptionType:'Claude API'},
 none:{tokenSource:'none',apiProvider:'firstParty'},
 'none-legacy':{tokenSource:'none'},
 bedrock:{tokenSource:'none',apiProvider:'bedrock'},
 absent:undefined,
};
const account = accounts[process.env.FIXTURE_ACCOUNT ?? 'stored'];
if (mode === 'exit') process.exit(7);
// What stock CLI 2.1.267 prints, and its exit code, when sandbox.failIfUnavailable meets a host without bubblewrap.
if (mode === 'refuse-start') { process.stderr.write('\nError: sandbox required but unavailable: sandbox is enabled but dependencies are missing: bubblewrap (bwrap) not installed\n  sandbox.failIfUnavailable is set \u2014 refusing to start without a working sandbox.\n\n'); process.exit(1); }
if (mode === 'malformed') process.stdout.write('not-json\n');
const suggestion = (destination) => ({type:'addRules',rules:[{toolName:'Bash',ruleContent:'git status:*'}],behavior:'allow',destination});
// Payload shapes read out of stock CLI 2.1.1 and 2.1.266 can_use_tool control requests.
const permissionFixtures = {
 'permission':{tool_name:'Bash',display_name:'Bash',input:{command:'git status',description:'check the tree'},description:'Run git status',permission_suggestions:[suggestion('localSettings'),suggestion('session')],decision_reason:'Claude requested permissions to use Bash',decision_reason_type:'rule',tool_use_id:'toolu_perm'},
 'permission:plain':{tool_name:'Write',input:{file_path:'notes.md',content:'hi'},tool_use_id:'toolu_plain'},
 'permission:suppressed':{tool_name:'Bash',input:{command:'rm -rf /'},permission_suggestions:[suggestion('localSettings')],suppress_always_allow_rule:true,blocked_path:'/etc',tool_use_id:'toolu_suppressed'},
 'permission:legacy':{tool_name:'Read',input:{file_path:'a.txt'}},
 'question':{tool_name:'AskUserQuestion',input:{questions:[{question:'Which formatter?',header:'Format',options:[{label:'prettier',description:'opinionated'},{label:'dprint',description:'fast'}],multiSelect:false},{question:'Which targets?',header:'Targets',options:[{label:'web',description:'browser'},{label:'node',description:'server'}],multiSelect:true}]},tool_use_id:'toolu_question',requires_user_interaction:true},
 'question:single':{tool_name:'AskUserQuestion',input:{questions:[{question:'Which formatter?',header:'Format',options:[{label:'prettier',description:'opinionated'},{label:'dprint',description:'fast'}],multiSelect:false}]},tool_use_id:'toolu_single',requires_user_interaction:true},
 'question:malformed':{tool_name:'AskUserQuestion',input:{questions:'nope'},tool_use_id:'toolu_bad'},
};
const outstanding = new Map();
let requests = 0;
const lines = readline.createInterface({input:process.stdin});
for await (const line of lines) {
 const value=JSON.parse(line);
 if(value.type === 'control_request') {
  if(mode==='hang') continue;
  const response=value.request.subtype==='initialize'?{commands:[],account}:{};
  emit({type:'control_response',response:{subtype:'success',request_id:value.request_id,response}});
  // The stock CLI aborts its outstanding permission requests when a turn is interrupted.
  if(value.request.subtype==='interrupt') {
   for(const requestId of outstanding.keys()) emit({type:'control_cancel_request',request_id:requestId});
   outstanding.clear();
   emit({type:'result',subtype:'success',session_id:id,result:'interrupted'});
  }
 } else if(value.type==='control_response'&&outstanding.has(value.response?.request_id)) {
  const scenario=outstanding.get(value.response.request_id);outstanding.delete(value.response.request_id);
  emit({type:'result',subtype:'success',session_id:id,result:JSON.stringify({scenario,response:value.response.response})});
 } else if(value.type==='control_cancel_request') {
  outstanding.delete(value.request_id);
 } else if(value.type==='user') {
  const text=value.message.content[0]?.text;
  if(text==='wait') continue;
  if(text==='unsupported-control') {emit({type:'control_request',request_id:`ctl-${++requests}`,request:{subtype:'unknown_subtype'}});emit({type:'result',subtype:'success',session_id:id,result:'unsupported'});continue;}
  if(permissionFixtures[text?.replace(/:abandon$/,'')]) {
   const scenario=text.replace(/:abandon$/,'');const requestId=`perm-${++requests}`;
   outstanding.set(requestId,scenario);
   emit({type:'control_request',request_id:requestId,request:{subtype:'can_use_tool',...permissionFixtures[scenario]}});
   // The stock CLI abandons a permission request when its turn aborts; a late reply must never run the tool.
   if(text.endsWith(':abandon')) {outstanding.delete(requestId);emit({type:'control_cancel_request',request_id:requestId});emit({type:'result',subtype:'success',session_id:id,result:'abandoned'});}
   continue;
  }
  if(text==='unknown-result') {emit({type:'result',subtype:'new_unknown_subtype'});continue;}
  if(text==='expired') {
   emit({type:'assistant',session_id:id,message:{content:[{type:'text',text:'Invalid API key · Please run /login'}]},error:'authentication_failed'});
   emit({type:'result',subtype:'success',is_error:true,session_id:id,result:'Invalid API key · Please run /login'});
   continue;
  }
  if(text==='fragmented') {
   const events=[{type:'stream_event',event:{type:'message_start',message:{id:'m1'}}},{type:'stream_event',event:{type:'content_block_start',index:0,content_block:{type:'text',text:''}}},{type:'stream_event',event:{type:'content_block_delta',index:0,delta:{type:'text_delta',text:'hello 🌏'}}},{type:'future_event'},{type:'assistant',message:{id:'m1',content:[{type:'text',text:'hello 🌏'}]}},{type:'result',subtype:'success',result:'hello 🌏'}];
   const bytes=Buffer.from(events.map(e=>JSON.stringify(e)+'\n').join(''));
   for(let i=0;i<bytes.length;i+=3)process.stdout.write(bytes.subarray(i,i+3));
   continue;
  }

  if(text==='crash') process.exit(4);
  if(text==='bad') {process.stdout.write('oops\n');continue;}
  if(text==='deny') {emit({type:'result',is_error:true,errors:['Not logged in']});continue;}
  // Echoes the launch identity so a wire-level client can prove --session-id/--resume round-tripped, not just that the call succeeded.
  if(text==='session-id') {emit({type:'assistant',session_id:id,message:{content:[{type:'text',text:id}]}});emit({type:'result',subtype:'success',session_id:id,result:id});continue;}
  // Echoes the exact Claude-format blocks it received, so a wire-level client can assert image data survived conversion unchanged.
  if(text==='echo-content') {const payload=JSON.stringify(value.message.content);emit({type:'assistant',session_id:id,message:{content:[{type:'text',text:payload}]}});emit({type:'result',subtype:'success',session_id:id,result:payload});continue;}
  // Echoes what the launcher handed the child, so a wire-level client can check argv and the stripped environment.
  if(text==='launch-env') {const payload=JSON.stringify({args,configDir:process.env.CLAUDE_CONFIG_DIR,oauthToken:process.env.CLAUDE_CODE_OAUTH_TOKEN,authEnv:Object.keys(process.env).filter(name=>/^ANTHROPIC_|^CLAUDE_CODE_(USE_|OAUTH_REFRESH|OAUTH_SCOPES)/.test(name))});emit({type:'assistant',session_id:id,message:{content:[{type:'text',text:payload}]}});emit({type:'result',subtype:'success',session_id:id,result:payload});continue;}
  if(text==='tool-call') {
   emit({type:'stream_event',event:{type:'message_start',message:{id:'m1'}}});
   emit({type:'stream_event',event:{type:'content_block_start',index:0,content_block:{type:'tool_use',id:'toolcall1',name:'Bash',input:{}}}});
   emit({type:'stream_event',event:{type:'content_block_delta',index:0,delta:{type:'input_json_delta',partial_json:'{"command":"ls"}'}}});
   emit({type:'stream_event',event:{type:'content_block_stop',index:0}});
   emit({type:'user',message:{content:[{type:'tool_result',tool_use_id:'toolcall1',content:[{type:'text',text:'file1\nfile2'}]}]}});
   emit({type:'stream_event',event:{type:'content_block_start',index:1,content_block:{type:'text',text:''}}});
   emit({type:'stream_event',event:{type:'content_block_delta',index:1,delta:{type:'text_delta',text:'Done.'}}});
   emit({type:'assistant',session_id:id,message:{id:'m1',content:[{type:'tool_use',id:'toolcall1',name:'Bash',input:{command:'ls'}},{type:'text',text:'Done.'}]}});
   emit({type:'result',subtype:'success',session_id:id,result:'Done.'});
   continue;
  }
  emit({type:'system',subtype:'init',session_id:id,cwd:process.cwd(),args,userContent:value.message.content,configDir:process.env.CLAUDE_CONFIG_DIR,oauthTokenPresent:Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN),apiKeyPresent:Boolean(process.env.ANTHROPIC_API_KEY),authTokenPresent:Boolean(process.env.ANTHROPIC_AUTH_TOKEN),bedrockPresent:Boolean(process.env.CLAUDE_CODE_USE_BEDROCK)});
  emit({type:'assistant',session_id:id,message:{content:[{type:'text',text}]}});
  emit({type:'result',subtype:'success',session_id:id,result:text});
 }
}
